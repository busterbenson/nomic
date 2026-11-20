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
//   2. the night's steps, in order (NIGHT_STEPS): count the ballot (rule 104.5), then wait for the moderator to apply
//      what passed, until 2 am (rule 107.6). A step may say "wait" (the lock stays, nothing is wrong) or throw (the
//      lock stays, the failure is recorded and reported, and the next tick tries again: a failed night never unlocks
//      by itself)
//   3. finalize: day N done (or timed_out, when the deadline ended it), day N+1 open with its electorate and ballot,
//      the game unlocked, in one batch
import { bundleFor } from "../engine/host";
import { getSettings, validTimeZone } from "./settings.js";
import { Env, nowIso } from "./util";

export type DayRow = { game_id: string; n: number; starts_at: string; ends_at: string; status: string; electorate?: number | null; locked_at: string | null; deadline_at?: string | null; last_error: string | null };
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
import { deadlineAfter, nextMidnight } from "./day-gate.js";
import { APPLY_BUDGET, DEADLINE_REASON, resultSentence, returnedBody, tally } from "./votes.js";

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
    electorsSql(env, game.id, 1),
    env.DB.prepare("UPDATE games SET day = 1, phase = 'open' WHERE id = ? AND status = 'playing' AND day = 0 AND EXISTS (SELECT 1 FROM days WHERE game_id = ? AND n = 1)").bind(game.id, game.id),
    env.DB.prepare(
      `INSERT INTO events (game_id, kind, text, created_at, day, phase, template, args)
       SELECT ?, 'day_started', 'Day 1 has begun.', ?, 1, 'day', 'dayStarted', '{"day":1}'
       WHERE NOT EXISTS (SELECT 1 FROM events WHERE game_id = ? AND kind = 'day_started' AND day = 1)
         AND EXISTS (SELECT 1 FROM games WHERE id = ? AND day = 1)`,
    ).bind(game.id, starts, game.id, game.id),
  ]);
}

// ---- the electorate (rule 104.2) -----------------------------------------------------------------------------------
// Who may vote on day n and who counts for what a vote needs: the players when the day starts, written as rows in the
// batch that opens the day (and never again: a later run adds nobody). days.electorate is their count.
/** @rule 104.2 */
function electorsSql(env: Env, gameId: string, n: number) {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO electors (game_id, day, player_id) SELECT ?, ?, p.id FROM players p
     WHERE p.game_id = ? AND EXISTS (SELECT 1 FROM days WHERE game_id = ? AND n = ?)
       AND NOT EXISTS (SELECT 1 FROM electors e WHERE e.game_id = ? AND e.day = ?)`,
  ).bind(gameId, n, gameId, gameId, n, gameId, n);
}
// A day opened without its electorate rows (by the code before migration 0007, in the minutes between the migration and
// the deploy; or a test fixture) gets them the first time they are needed. Players can join only before day 1, so they
// are the same players. Returns the day's elector ids.
/** @rule 104.2 */
export async function electorsOf(env: Env, gameId: string, n: number): Promise<string[]> {
  let rows = (await env.DB.prepare("SELECT player_id FROM electors WHERE game_id = ? AND day = ?").bind(gameId, n).all()).results as any[];
  if (!rows.length) {
    await env.DB.batch([
      electorsSql(env, gameId, n),
      env.DB.prepare("UPDATE days SET electorate = (SELECT COUNT(*) FROM electors e WHERE e.game_id = days.game_id AND e.day = days.n) WHERE game_id = ? AND n = ? AND electorate IS NULL").bind(gameId, n),
    ]);
    rows = (await env.DB.prepare("SELECT player_id FROM electors WHERE game_id = ? AND day = ?").bind(gameId, n).all()).results as any[];
  }
  return rows.map((r) => r.player_id);
}

// ---- midnight ----------------------------------------------------------------------------------------------------------
// A step of the night, between the lock and the unlock. "done": go on; "wait": keep the lock and stop for now (the
// moderator has not finished); "timed_out": go on, and the day ends as timed_out (rule 107.6); throwing: a failure (the
// lock stays and it is reported).
export type StepResult = "done" | "wait" | "timed_out";
export type NightStep = { name: string; run(env: Env, game: any, day: DayRow, nowMs: number): Promise<StepResult> };

// The count (rules 104.1, 104.2, 104.5). Every proposal on day n's ballot is counted from the votes of day n's
// electorate: yes, no, didn't vote, needed, passed or failed, and the result sentence. Votes cannot change any more: the
// lock was set (in its own batch) before this runs, and every vote's write checks it. Each item's write is guarded by
// status = 'on_ballot', so a second run counts nothing twice. If any passed, the day goes to processing with the
// 2 am deadline (rule 107.6); otherwise the night goes straight on to finalize.
/** @rule 104.1, 104.2, 104.5, 107.6 */
export async function countBallot(env: Env, game: any, day: DayRow, nowMs: number): Promise<StepResult> {
  if (day.status !== "locked") return "done"; // counted on an earlier run
  const items = (await env.DB.prepare("SELECT id, number, mark, needed FROM proposals WHERE game_id = ? AND day_ballot = ? AND status = 'on_ballot' ORDER BY number").bind(game.id, day.n).all()).results as any[];
  const electors = await electorsOf(env, game.id, day.n);
  const votes = items.length ? ((await env.DB.prepare("SELECT proposal_id, player_id, vote FROM votes WHERE game_id = ? AND day = ?").bind(game.id, day.n).all()).results as any[]) : [];
  const now = nowIso(nowMs);
  const writes = items.map((q) => {
    const t = tally({ mark: q.mark, electorate: electors.length, electors, votes: votes.filter((v) => v.proposal_id === q.id), needed: q.needed });
    return { q, t };
  });
  const deadline = nowIso(deadlineAfter(timeZoneOf(game), Date.parse(day.ends_at)));
  await env.DB.batch([
    ...writes.map(({ q, t }) => env.DB.prepare(
      `UPDATE proposals SET status = ?, yes = ?, no = ?, absent = ?, needed = ?, electorate = ?, why = ?, decided_at = ?,
         budget_minutes = ?, budget_effort = ?
       WHERE id = ? AND status = 'on_ballot' AND EXISTS (SELECT 1 FROM days WHERE game_id = ? AND n = ? AND status = 'locked')`,
    ).bind(t.passed ? "passed" : "failed", t.yes, t.no, t.absent, t.needed, t.electorate, resultSentence(t), now,
      t.passed ? APPLY_BUDGET.minutes : null, t.passed ? APPLY_BUDGET.effort : null, q.id, game.id, day.n)),
    env.DB.prepare(
      `UPDATE days SET status = 'processing', deadline_at = ? WHERE game_id = ? AND n = ? AND status = 'locked'
         AND EXISTS (SELECT 1 FROM proposals WHERE game_id = ? AND day_ballot = ? AND status = 'passed')`,
    ).bind(deadline, game.id, day.n, game.id, day.n),
  ]);
  // Read back what is stored, not what this run computed: an overlapping run may have counted the ballot first.
  const fresh: any = await env.DB.prepare("SELECT status, deadline_at FROM days WHERE game_id = ? AND n = ?").bind(game.id, day.n).first();
  if (fresh) { day.status = fresh.status; day.deadline_at = fresh.deadline_at; }
  return "done";
}

// The moderator's part of the night (rule 107.6). The moderator itself arrives in step 1 PR 5; until then this waits
// for it. A processing day waits while any passed proposal is still unapplied and the deadline has not passed. At the
// deadline, every passed proposal still unapplied is not applied (rule 107.7): no points, the reason recorded on it,
// and it goes back to its proposer as a notification with the reason and a suggestion. Then play resumes on the rules
// as they were: the lock always ends. Guarded by status, so a second run changes nothing and notifies nobody twice.
// finalizeDay also refuses to close a day that still has a passed proposal waiting.
/** @rule 107.6, 107.7 */
export async function awaitModerator(env: Env, game: any, day: DayRow, nowMs: number): Promise<StepResult> {
  // Decided by what is stored (passed proposals still unapplied), not by this run's copy of the day's status, so a run
  // that overlapped the count still waits.
  const left: any = await env.DB.prepare("SELECT COUNT(*) AS n FROM proposals WHERE game_id = ? AND day_ballot = ? AND status = 'passed'").bind(game.id, day.n).first();
  const timedOut: any = await env.DB.prepare("SELECT COUNT(*) AS n FROM proposals WHERE game_id = ? AND day_ballot = ? AND status = 'not_applied' AND not_applied_reason = ?").bind(game.id, day.n, DEADLINE_REASON).first();
  if (!(left?.n > 0)) return timedOut?.n > 0 ? "timed_out" : "done";
  const deadline = Date.parse(day.deadline_at || "") || deadlineAfter(timeZoneOf(game), Date.parse(day.ends_at));
  if (nowMs < deadline) return "wait";
  const now = nowIso(nowMs);
  const passed = (await env.DB.prepare("SELECT id, number, player_id FROM proposals WHERE game_id = ? AND day_ballot = ? AND status = 'passed' ORDER BY number").bind(game.id, day.n).all()).results as any[];
  await env.DB.batch(passed.flatMap((q) => [
    env.DB.prepare("UPDATE proposals SET status = 'not_applied', not_applied_reason = ?, decided_at = ? WHERE id = ? AND status = 'passed'").bind(DEADLINE_REASON, now, q.id),
    // One notification per proposal, ever: its id is the proposal's.
    env.DB.prepare(
      `INSERT OR IGNORE INTO notifications (id, game_id, player_id, kind, body, link, created_at)
       SELECT ?, ?, ?, 'not_applied', ?, ?, ? WHERE EXISTS (SELECT 1 FROM proposals WHERE id = ? AND status = 'not_applied')`,
    ).bind(`not-applied-${q.id}`, game.id, q.player_id, returnedBody(q.number, DEADLINE_REASON), `/${game.slug}/`, now, q.id),
  ]));
  return "timed_out";
}

export const NIGHT_STEPS: NightStep[] = [
  { name: "the count", run: countBallot },
  { name: "the moderator", run: awaitModerator },
];

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
    let end: "done" | "timed_out" = "done";
    for (const step of NIGHT_STEPS) {
      const r = await step.run(env, game, day, nowMs);
      if (r === "wait") return `waiting on ${step.name}`;
      if (r === "timed_out") end = "timed_out";
    }
    const fail = await devControl(env, "night_fail"); // local tests only: make the night fail
    if (fail) throw new Error(`test failure: ${fail}`);
    await finalizeDay(env, game, day, nowMs, end);
    return end;
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

// Day N done (or timed_out) and day N+1 open, in one batch. Day N+1 starts where day N ended and ends at the next
// midnight after that, or after now when the night ran past a whole day, so a day never ends before it starts. Its
// electorate is the players now (rule 104.2), and the proposals confirmed on day N are its ballot (rule 103.2), each with
// the votes it needs of that electorate, from the mark fixed when it was confirmed (rule 105.4).
/** @rule 103.2, 104.2, 105.4, 107.1, 203.1 */
export async function finalizeDay(env: Env, game: any, day: DayRow, nowMs: number, end: "done" | "timed_out" = "done") {
  const tz = timeZoneOf(game);
  const ended = Date.parse(day.ends_at);
  const next = day.n + 1, now = nowIso(nowMs);
  const ends = nowIso(nextMidnight(tz, Math.max(ended, nowMs)));
  const DONE = "status IN ('done', 'timed_out')";
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE days SET status = ?, processed_at = ?, last_error = NULL WHERE game_id = ? AND n = ? AND status IN ('locked', 'processing')
         AND NOT EXISTS (SELECT 1 FROM proposals WHERE game_id = ? AND day_ballot = ? AND status IN ('on_ballot', 'passed'))`,
    ).bind(end, now, game.id, day.n, game.id, day.n),
    env.DB.prepare(
      `INSERT OR IGNORE INTO days (game_id, n, starts_at, ends_at, status, electorate)
       SELECT ?, ?, ?, ?, 'open', (SELECT COUNT(*) FROM players p WHERE p.game_id = ?)
       WHERE EXISTS (SELECT 1 FROM days WHERE game_id = ? AND n = ? AND ${DONE})`,
    ).bind(game.id, next, day.ends_at, ends, game.id, game.id, day.n),
    electorsSql(env, game.id, next),
    // The day's confirmed proposals go on the next day's ballot (rule 103.2); withdrawing ends with the day (rule 103.3).
    // needed: the same numbers as neededOf in src/lib/proposals.js (unanimous: all; majority: more than half).
    env.DB.prepare(
      `UPDATE proposals SET status = 'on_ballot',
         electorate = (SELECT d.electorate FROM days d WHERE d.game_id = proposals.game_id AND d.n = ?),
         needed = (SELECT CASE WHEN proposals.mark = 'unanimous' THEN d.electorate ELSE d.electorate / 2 + 1 END FROM days d WHERE d.game_id = proposals.game_id AND d.n = ?)
       WHERE game_id = ? AND day_proposed = ? AND status = 'confirmed'
         AND EXISTS (SELECT 1 FROM days WHERE game_id = ? AND n = ? AND ${DONE})
         AND EXISTS (SELECT 1 FROM days WHERE game_id = ? AND n = ?)`,
    ).bind(next, next, game.id, day.n, game.id, day.n, game.id, next),
    env.DB.prepare(`UPDATE games SET day = ?, phase = 'open' WHERE id = ? AND day = ? AND EXISTS (SELECT 1 FROM days WHERE game_id = ? AND n = ? AND status = 'open')`).bind(next, game.id, day.n, game.id, next),
    env.DB.prepare(
      `INSERT INTO events (game_id, kind, text, created_at, day, phase, template, args)
       SELECT ?, 'day_started', ?, ?, ?, 'day', 'dayStarted', json_object('day', ?)
       WHERE NOT EXISTS (SELECT 1 FROM events WHERE game_id = ? AND kind = 'day_started' AND day = ?)
         AND EXISTS (SELECT 1 FROM games WHERE id = ? AND day = ?)`,
    ).bind(game.id, `Day ${next} has begun.`, now, next, next, game.id, next, game.id, next),
  ]);
}
