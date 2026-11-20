// THE DAY. Days run midnight to midnight in the game's time zone (rule 203.1); from midnight until the day that just
// ended is processed, the game is locked (rule 107.1); End turn is final for the rest of the day (rule 202.4).
//
// ONE gate, dayGate, is what every write route (move, propose, End turn; vote and the rest as they arrive) asks first,
// and what the MCP server's my_state reports. It checks the CLOCK itself (now >= the day's ends_at), not only the
// flag the midnight run sets, so the lock starts at midnight exactly even when the cron is late. Each write's own
// D1 batch repeats the check in SQL (dayOpenSql), so a write that races the midnight run cannot land after it.
//
// The midnight run (runMidnight, the Worker's cron, every 5 minutes) is idempotent: every write is guarded by the state
// it expects, so running it twice, or late, changes nothing more. For each playing game:
//   0. a playing game with no day yet gets day 1 (game start)
//   1. freeze: day N past its end -> locked, the game locked
//   2. the night's steps, in order (NIGHT_STEPS: counting votes and the moderator slot in here); a step may say
//      "wait" (the lock stays, nothing is wrong) or throw (the lock stays, the failure is recorded and reported,
//      and the next tick tries again: a failed night never unlocks by itself)
//   3. finalize: day N done, day N+1 open, the game unlocked, in one batch
import { bundleFor } from "../engine/host";
import { getSettings, validTimeZone } from "./settings.js";
import { Env, nowIso } from "./util";

export type DayRow = { game_id: string; n: number; starts_at: string; ends_at: string; status: string; locked_at: string | null; last_error: string | null };
export type DayTurn = { moved_at: string | null; ended_at: string | null } | null;
export type GateRefusal = { status: number; error: string; processing_day?: number };

// ---- the clock ---------------------------------------------------------------------------------------------------
// The current time. Local tests set it in a dev_controls row (key "clock", an ISO time); that table is not part of the
// schema (no migration makes it), and it is read ONLY when DEV_MODE is "1", so production always uses the real clock.
/** @rule 203.1 */
export async function devControl(env: Env, key: string): Promise<string | null> {
  if (env.DEV_MODE !== "1") return null;
  try {
    const r: any = await env.DB.prepare("SELECT value FROM dev_controls WHERE key = ?").bind(key).first();
    return r ? String(r.value) : null;
  } catch { return null; } // no such table: the real clock
}
/** @rule 203.1 */
export async function clockNow(env: Env): Promise<number> {
  const v = await devControl(env, "clock");
  const t = v === null ? NaN : Date.parse(v);
  return Number.isFinite(t) ? t : Date.now();
}

// ---- midnights, the gate, its SQL: src/lib/day-gate.js (plain JS, shared with the tests) ---------------------------------
export { addDays, dayGate, dayOpenBinds, dayOpenSql, isLocked, localDate, lockMessage, nextMidnight, startOfDate } from "./day-gate.js";
import { nextMidnight } from "./day-gate.js";

// The game's time zone: the bundled rules' setting when the game has a bundle that sets one, else the game's own.
/** @rule 203.1 */
export function timeZoneOf(game: { slug: string; settings: string }): string {
  const { bundle, bundled } = bundleFor(game);
  const own = bundled ? bundle.settings?.["game.timezone"] : undefined;
  return validTimeZone(own) ? own : getSettings(game.settings)["game.timezone"];
}

// ---- reading today ---------------------------------------------------------------------------------------------------
// The game's current day and this player's turn on it. A playing game with no day yet gets day 1 first (game start),
// and the game row is re-read, so callers always use the returned `game`.
/** @rule 202.1, 203.1 */
export async function loadToday(env: Env, gameIn: any, nowMs: number, playerId?: string): Promise<{ game: any; day: DayRow | null; turn: DayTurn }> {
  let game = gameIn;
  if (game.status === "playing" && !game.day) {
    await startDayOne(env, game, nowMs);
    game = (await env.DB.prepare("SELECT * FROM games WHERE id = ?").bind(game.id).first()) ?? game;
  }
  if (!game.day) return { game, day: null, turn: null };
  const [day, turn] = await Promise.all([
    env.DB.prepare("SELECT * FROM days WHERE game_id = ? AND n = ?").bind(game.id, game.day).first(),
    playerId ? env.DB.prepare("SELECT moved_at, ended_at FROM day_turns WHERE game_id = ? AND day = ? AND player_id = ?").bind(game.id, game.day, playerId).first() : null,
  ]);
  return { game, day: (day as DayRow) ?? null, turn: (turn as DayTurn) ?? null };
}

// Game start: a playing game with no day gets day 1, from now to the next midnight. Guarded, so it happens once.
/** @rule 203.1 */
export async function startDayOne(env: Env, game: any, nowMs: number) {
  const tz = timeZoneOf(game);
  const starts = nowIso(nowMs), ends = nowIso(nextMidnight(tz, nowMs));
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO days (game_id, n, starts_at, ends_at, status, electorate)
       SELECT g.id, 1, ?, ?, 'open', (SELECT COUNT(*) FROM players p WHERE p.game_id = g.id) FROM games g
       WHERE g.id = ? AND g.status = 'playing' AND g.day = 0`,
    ).bind(starts, ends, game.id),
    env.DB.prepare("UPDATE games SET day = 1, phase = 'open' WHERE id = ? AND status = 'playing' AND day = 0 AND EXISTS (SELECT 1 FROM days WHERE game_id = ? AND n = 1)").bind(game.id, game.id),
    env.DB.prepare(
      `INSERT INTO events (game_id, kind, text, created_at, day, phase, template, args)
       SELECT ?, 'day_started', 'Day 1 has begun.', ?, 1, 'day', 'dayStarted', '{"day":1}'
       WHERE NOT EXISTS (SELECT 1 FROM events WHERE game_id = ? AND kind = 'day_started' AND day = 1)
         AND EXISTS (SELECT 1 FROM games WHERE id = ? AND day = 1)`,
    ).bind(game.id, starts, game.id, game.id),
  ]);
}

// ---- midnight ----------------------------------------------------------------------------------------------------------
// A step of the night, between the lock and the unlock. "done": go on; "wait": keep the lock and stop for now (the
// moderator has not finished); throwing: a failure (the lock stays and it is reported). Counting votes (PR 4) and the
// moderator (PR 5) are added here, in this order.
export type NightStep = { name: string; run(env: Env, game: any, day: DayRow, nowMs: number): Promise<"done" | "wait"> };
export const NIGHT_STEPS: NightStep[] = [];

// The cron: every playing game, one at a time, each in its own try so one bad game cannot stop the others.
/** @rule 107.1, 203.1 */
export async function runMidnight(env: Env, nowMs: number) {
  const games = (await env.DB.prepare("SELECT * FROM games WHERE status = 'playing'").all()).results as any[];
  const out: { slug: string; result: string }[] = [];
  for (const g of games) {
    try { out.push({ slug: g.slug, result: await tickGame(env, g, nowMs) }); }
    catch (e: any) { console.error(`midnight ${g.slug}:`, e?.message || e); out.push({ slug: g.slug, result: "error" }); }
  }
  return out;
}

/** @rule 107.1, 203.1 */
export async function tickGame(env: Env, gameIn: any, nowMs: number): Promise<string> {
  const { game, day } = await loadToday(env, gameIn, nowMs);
  if (!day) return "no day";
  if (day.status === "open") {
    if (nowMs < Date.parse(day.ends_at)) return "open";
    await env.DB.batch([
      env.DB.prepare("UPDATE days SET status = 'locked', locked_at = ? WHERE game_id = ? AND n = ? AND status = 'open'").bind(nowIso(nowMs), game.id, day.n),
      env.DB.prepare("UPDATE games SET phase = 'locked' WHERE id = ? AND day = ?").bind(game.id, day.n),
    ]);
    day.status = "locked";
  }
  if (day.status !== "locked" && day.status !== "processing") return day.status;
  return processDay(env, game, day, nowMs);
}

// Runs the night's steps for a locked day, then finalizes it. A failure keeps the lock: it is written to the day
// (last_error), logged, and put in the game's log once (not on every retry), and the next tick tries again.
/** @rule 107.1 */
export async function processDay(env: Env, game: any, day: DayRow, nowMs: number): Promise<string> {
  try {
    for (const step of NIGHT_STEPS) if ((await step.run(env, game, day, nowMs)) === "wait") return `waiting on ${step.name}`;
    const fail = await devControl(env, "night_fail"); // local tests only: make the night fail
    if (fail) throw new Error(`test failure: ${fail}`);
    await finalizeDay(env, game, day, nowMs);
    return "done";
  } catch (e: any) {
    const why = String(e?.message || e).slice(0, 500);
    console.error(`midnight ${game.slug} day ${day.n} failed (the lock stays on):`, why);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO events (game_id, kind, text, created_at, day, phase, template, args)
         SELECT ?, 'night_failed', ?, ?, ?, 'night', 'nightFailed', json_object('day', ?)
         WHERE EXISTS (SELECT 1 FROM days WHERE game_id = ? AND n = ? AND last_error IS NULL AND status IN ('locked', 'processing'))`,
      ).bind(game.id, `Chalant could not finish processing day ${day.n}. The game stays locked until it does.`, nowIso(nowMs), day.n, day.n, game.id, day.n),
      env.DB.prepare("UPDATE days SET last_error = ? WHERE game_id = ? AND n = ? AND status IN ('locked', 'processing')").bind(why, game.id, day.n),
    ]);
    return "failed";
  }
}

// Day N done and day N+1 open, in one batch. Day N+1 starts where day N ended and ends at the next midnight after
// that, or after now when the night ran past a whole day, so a day never ends before it starts.
/** @rule 107.1, 203.1 */
export async function finalizeDay(env: Env, game: any, day: DayRow, nowMs: number) {
  const tz = timeZoneOf(game);
  const ended = Date.parse(day.ends_at);
  const next = day.n + 1, now = nowIso(nowMs);
  const ends = nowIso(nextMidnight(tz, Math.max(ended, nowMs)));
  await env.DB.batch([
    env.DB.prepare("UPDATE days SET status = 'done', processed_at = ?, last_error = NULL WHERE game_id = ? AND n = ? AND status IN ('locked', 'processing')").bind(now, game.id, day.n),
    env.DB.prepare(
      `INSERT OR IGNORE INTO days (game_id, n, starts_at, ends_at, status, electorate)
       SELECT ?, ?, ?, ?, 'open', (SELECT COUNT(*) FROM players p WHERE p.game_id = ?)
       WHERE EXISTS (SELECT 1 FROM days WHERE game_id = ? AND n = ? AND status = 'done')`,
    ).bind(game.id, next, day.ends_at, ends, game.id, game.id, day.n),
    env.DB.prepare("UPDATE games SET day = ?, phase = 'open' WHERE id = ? AND day = ? AND EXISTS (SELECT 1 FROM days WHERE game_id = ? AND n = ? AND status = 'open')").bind(next, game.id, day.n, game.id, next),
    env.DB.prepare(
      `INSERT INTO events (game_id, kind, text, created_at, day, phase, template, args)
       SELECT ?, 'day_started', ?, ?, ?, 'day', 'dayStarted', json_object('day', ?)
       WHERE NOT EXISTS (SELECT 1 FROM events WHERE game_id = ? AND kind = 'day_started' AND day = ?)
         AND EXISTS (SELECT 1 FROM games WHERE id = ? AND day = ?)`,
    ).bind(game.id, `Day ${next} has begun.`, now, next, next, game.id, next, game.id, next),
  ]);
}
