// The Worker's side of the rule-module engine: which bundle a game runs on, the data hooks are given, and how
// what they answer is applied to D1. The pure parts (hook composition, effect validation) are in hooks.js.
//
// A game with a bundle (src/generated/games.ts, written at build time by scripts/bundle-games.mjs from the game's
// repo at its latest day-N tag) runs on that game's modules. Every other game (the demo, the tests) runs on the
// starter pack from templates/rules/.
import { GAMES, STARTER } from "../generated/games";
import { chartTile, loadTiles } from "../lib/board";
import { getSettings } from "../lib/settings.js";
import { Env, nowIso } from "../lib/util";
import { APPLIED_EFFECTS, RuleError, assembleRules, cryptoRng, makeContext, makeTiles } from "./hooks.js";

export { RuleError };
type Bundle = { slug?: string; day?: number; sha?: string; rulesMd: string; settings: any; modules: any[] };
type Refusal = { error: string; status: number; rule?: number };

const assembled = new WeakMap<Bundle, ReturnType<typeof assembleRules>>();

// The bundle a game runs on, and whether it is the game's own (bundled) or the starter pack.
/** @rule 101 */
export function bundleFor(game: { slug: string }): { bundle: Bundle; bundled: boolean } {
  const own = Object.hasOwn(GAMES, game.slug) ? (GAMES as Record<string, Bundle>)[game.slug] : null;
  return { bundle: own ?? (STARTER as Bundle), bundled: !!own };
}

/** @rule 101 */
export function rulesFor(game: { slug: string }) {
  const { bundle } = bundleFor(game);
  let r = assembled.get(bundle);
  if (!r) {
    // The build already checked this; if it fails here anyway it is a RuleError like any other broken rule.
    try { r = assembleRules(bundle.modules, { label: bundle.slug ?? "starter" }); } catch (e: any) { throw new RuleError(0, "assemble", e); }
    assembled.set(bundle, r);
  }
  return r;
}

type PlayerRow = { id: string; color: string; score: number; x: number; y: number; z: number };
/** @rule 102 */
const playersOf = (rows: PlayerRow[]) => rows.map((p) => ({ ref: p.id, color: p.color, score: p.score, x: p.x, y: p.y, z: p.z }));
// The acting player's turn today (rule 202.1: one turn a day each). `turn.moved` is whether they have moved in it; the
// legacy round/turn numbers stay in ctx for the modules written against them (the engine is additive only).
type Today = { moved?: boolean } | null | undefined;
/** @rule 202.1, 202.2 */
const turnOf = (game: any, today: Today) => ({ round: game.round, turn: game.turn, moved: !!today?.moved });

// A context with no board in it: enough for the questions the turn guard asks (may this player move at all?).
/** @rule 202.2 */
export function lightContext(game: any, today?: Today) {
  return makeContext({ day: game.day || null, now: nowIso(), settings: getSettings(game.settings), turn: turnOf(game, today) });
}

// The full context for a move or a spawn: the settings, every piece and every charted tile.
/** @rule 501 */
export async function boardContext(env: Env, game: any, today?: Today) {
  const [tiles, pieces] = await Promise.all([
    loadTiles(env, game.id),
    env.DB.prepare("SELECT id, color, score, x, y, z FROM players WHERE game_id = ?").bind(game.id).all(),
  ]);
  return makeContext({
    day: game.day || null, now: nowIso(), settings: getSettings(game.settings), players: playersOf(pieces.results as PlayerRow[]),
    tiles: makeTiles(tiles), turn: turnOf(game, today), rng: cryptoRng(),
  });
}

// Runs the game's actionAllowed hooks (a veto hook: any rule may refuse, the first in rule order wins). null, or the
// refusal the route sends. A rule that throws is answered as a 500 refusal, so every caller handles it the same way.
/** @rule 202.2, 504.3 */
export function checkAction(game: any, ctx: any, actor: { ref: string }, action: any): Refusal | null {
  try {
    const r = rulesFor(game).actionAllowed(ctx, actor, action);
    return r && { error: r.error, status: r.status, rule: r.rule };
  } catch (e) {
    if (!(e instanceof RuleError)) throw e;
    console.error(e.message);
    return { error: "A rule could not be checked. Try again later.", status: 500, rule: e.rule };
  }
}

// Runs the game's championChange hook: may the Champion draft their change (rule 402.4)? null, or the refusal the route sends. A
// game whose rules have no module for it answers a refusal, so the capability goes with the rule that carries it.
/** @rule 402.4 */
export function checkChampionChange(game: any, ctx: any, champion: { ref: string }): Refusal | null {
  try {
    const r = rulesFor(game).championChange(ctx, champion);
    return r && { error: r.error, status: r.status, rule: r.rule };
  } catch (e) {
    if (!(e instanceof RuleError)) throw e;
    console.error(e.message);
    return { error: "A rule could not be checked. Try again later.", status: 500, rule: e.rule };
  }
}

// Runs the game's afterAction hooks and turns the effects into D1 statements for the action's own batch.
/** @rule 504 */
export function afterActionStatements(env: Env, game: any, ctx: any, actor: { ref: string }, action: any, now = nowIso()) {
  const stmts: any[] = [];
  for (const e of rulesFor(game).afterAction(ctx, actor, action)) {
    if (!APPLIED_EFFECTS.includes(e.type)) throw new RuleError(0, "afterAction", new Error(`the ${e.type} effect is not applied yet`));
    for (const t of e.tiles) stmts.push(chartTile(env, game.id, t.x, t.y, t.z, now));
  }
  return stmts;
}

// Where a new piece starts, by the game's spawn rule (null: no room). Also returns how many pieces already stand on
// the tile, so the insert can refuse if the board changed under the choice.
/** @rule 505 */
export async function chooseSpawn(env: Env, game: any) {
  const ctx = await boardContext(env, game);
  const candidates = ctx.tiles.list().filter((t: any) => t.z === 0);
  const tile = rulesFor(game).spawnTile(ctx, candidates);
  if (!tile) return null;
  return { tile, occupants: ctx.players.filter((p: any) => p.x === tile.x && p.y === tile.y && p.z === tile.z).length };
}

// ---- the night (rules 107.2, 401, 402) -----------------------------------------------------------------------------
// The players as the night's hooks see them (scores included).
/** @rule 401, 402 */
async function nightContext(env: Env, game: any, nowMs: number) {
  const pieces = await env.DB.prepare("SELECT id, color, score, x, y, z FROM players WHERE game_id = ?").bind(game.id).all();
  const { bundle, bundled } = bundleFor(game);
  return makeContext({ day: game.day || null, now: nowIso(nowMs), settings: getSettings(bundled ? bundle.settings : game.settings), players: playersOf(pieces.results as PlayerRow[]) });
}

// The order the passed proposals are applied in (rule 107.2), by the game's own rule for it (the applyOrder hook).
// `passed` rows carry `number`; the answer is the same rows, reordered.
/** @rule 107.2 */
export async function orderPassed<T extends { number: number }>(env: Env, game: any, passed: T[], nowMs: number): Promise<T[]> {
  const ctx = await nightContext(env, game, nowMs);
  const plain = passed.map((p: any) => ({ number: p.number, target: p.target ?? null, kind: p.kind ?? null }));
  const order = rulesFor(game).applyOrder(ctx, plain).map((p: any) => p.number);
  return order.map((n: number) => passed.find((p) => p.number === n)!);
}

// The next place in day n's night sequence (events.night_seq): 1 + the highest so far. Every event the night writes
// takes one, so the night reads back in execution order whichever batch wrote it. Binds (game_id, day).
/** @rule 107.2 */
export const NEXT_NIGHT_SEQ = "(SELECT COALESCE(MAX(night_seq), 0) + 1 FROM events WHERE game_id = ? AND day = ?)";

// The Era ends (rule 402.3): the winner is crowned Champion, the Era's final scores are kept, everyone's points go back to
// 0, the next Era opens the next day, and History says so. The statements for the night's batch, in this order (each one
// guarded by "a proposal of this night is still passed", like the points before it, and the later ones by "this Era ended
// by this run", so a second run writes nothing twice): make sure the open Era has a row (a game that began before
// migration 0011), end it, write the event, reset the points, open the next Era.
/** @rule 402.3 */
async function eraEndStatements(env: Env, game: any, n: number, now: string, champ: { player: string; reason: string; rule: number }, before: Record<string, number>, given: { player: string; delta: number }[], anyPassed: string) {
  const scores: Record<string, number> = { ...before };
  for (const g of given) scores[g.player] = (scores[g.player] ?? 0) + g.delta;
  const names = new Map(((await env.DB.prepare("SELECT id, display_name FROM players WHERE game_id = ?").bind(game.id).all()).results as any[]).map((p) => [p.id, p.display_name as string]));
  const open: any = await env.DB.prepare("SELECT n, name FROM eras WHERE game_id = ? AND ended_day IS NULL").bind(game.id).first();
  const era = open?.n ?? 1;
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([id, pts]) => `${names.get(id) ?? "?"} ${pts}`).join(", ");
  const label = open?.name ? `Era ${era}, ${open.name},` : `Era ${era}`;
  const text = `${label} ended. ${names.get(champ.player) ?? "A player"} ${champ.reason} and is the Champion. Final scores: ${ranked}.`;
  const thisRun = `EXISTS (SELECT 1 FROM eras WHERE game_id = ? AND n = ? AND ended_day = ? AND champion_id = ?) AND ${anyPassed}`;
  return [
    env.DB.prepare(`INSERT OR IGNORE INTO eras (game_id, n, started_day) SELECT ?, 1, 1 WHERE NOT EXISTS (SELECT 1 FROM eras WHERE game_id = ?) AND ${anyPassed}`).bind(game.id, game.id, game.id, n),
    env.DB.prepare(`UPDATE eras SET ended_day = ?, champion_id = ?, final_scores = ? WHERE game_id = ? AND n = ? AND ended_day IS NULL AND ${anyPassed}`)
      .bind(n, champ.player, JSON.stringify(scores), game.id, era, game.id, n),
    env.DB.prepare(
      `INSERT INTO events (game_id, kind, text, created_at, day, phase, template, args, player_id, night_seq)
       SELECT ?, 'era_ended', ?, ?, ?, 'night', 'eraEnded', json_object('era', ?, 'rule', ?, 'reason', ?, 'scores', json(?)), ?, ${NEXT_NIGHT_SEQ} WHERE ${thisRun}`,
    ).bind(game.id, text, now, n, era, champ.rule, champ.reason, JSON.stringify(scores), champ.player, game.id, n, game.id, era, n, champ.player, game.id, n),
    env.DB.prepare(`UPDATE players SET score = 0 WHERE game_id = ? AND ${thisRun}`).bind(game.id, game.id, era, n, champ.player, game.id, n),
    env.DB.prepare(
      `INSERT OR IGNORE INTO eras (game_id, n, started_day) SELECT game_id, n + 1, ended_day + 1 FROM eras WHERE game_id = ? AND n = ? AND ended_day = ? AND champion_id = ?`,
    ).bind(game.id, era, n, champ.player),
  ];
}

// The night takes effect (the deployed rules are the claimed commit): each applied proposal is enacted in the order
// the moderator applied and committed them (apply_seq, from its claim; NOT the live rule 107's order, which the night
// may itself have changed), its points given (rule 401, onEnacted), then the end of the night (rule 402, dayEnd: a win ends
// the Era). Returns the statements for ONE batch. Every one is guarded by "this proposal is still passed" (points,
// enacted) or "a proposal of this day is still passed" (the Era's end, rules_day), and the points and the Era's end come BEFORE
// the status changes in the batch, so a second run (or an overlapping one) gives nothing twice.
/** @rule 107.2, 401, 402 */
export async function enactStatements(env: Env, game: any, n: number, nowMs: number) {
  // A proposal claimed before apply_seq existed (NULL) goes in P-number order, after any that have one.
  const ordered = (await env.DB.prepare("SELECT id, number, player_id, target, kind FROM proposals WHERE game_id = ? AND day_ballot = ? AND status = 'passed' AND commit_sha IS NOT NULL ORDER BY apply_seq IS NULL, apply_seq, number").bind(game.id, n).all()).results as any[];
  if (!ordered.length) return [];
  const now = nowIso(nowMs);
  const ctx = await nightContext(env, game, nowMs);
  const rules = rulesFor(game);
  const before: Record<string, number> = Object.fromEntries(ctx.players.map((p: any) => [p.ref, p.score]));
  const known = new Set(Object.keys(before));
  const given: { player: string; delta: number; reason: string; number: number }[] = [];
  const stmts: any[] = [];
  const stillPassed = "EXISTS (SELECT 1 FROM proposals WHERE id = ? AND status = 'passed')";
  for (const q of ordered) {
    for (const e of rules.onEnacted(ctx, { number: q.number, player: q.player_id, target: q.target, kind: q.kind })) {
      if (!known.has(e.player)) continue; // onEnacted can only return points (hooks.js refuses anything else)
      given.push({ player: e.player, delta: e.delta, reason: e.reason, number: q.number });
      stmts.push(env.DB.prepare(`UPDATE players SET score = score + ? WHERE game_id = ? AND id = ? AND ${stillPassed}`).bind(e.delta, game.id, e.player, q.id));
      stmts.push(env.DB.prepare(
        `INSERT INTO events (game_id, kind, text, created_at, day, phase, template, args, player_id, night_seq)
         SELECT ?, 'points', ?, ?, ?, 'night', 'points', json_object('proposal', ?, 'delta', ?, 'rule', ?), ?, ${NEXT_NIGHT_SEQ} WHERE ${stillPassed}`,
      ).bind(game.id, `+${e.delta}: ${e.reason}`, now, n, q.number, e.delta, e.rule, e.player, game.id, n, q.id));
    }
  }
  const champ = rules.dayEnd(ctx, { before, given: given.map(({ player, delta }) => ({ player, delta })), enacted: ordered.map((q) => q.number) }).find((e: any) => known.has(e.player)); // dayEnd can only return a champion
  const anyPassed = `EXISTS (SELECT 1 FROM proposals WHERE game_id = ? AND day_ballot = ? AND status = 'passed')`;
  if (champ) stmts.push(...(await eraEndStatements(env, game, n, now, champ, before, given, anyPassed)));
  stmts.push(env.DB.prepare(`UPDATE games SET rules_day = ? WHERE id = ? AND rules_day < ? AND ${anyPassed}`).bind(n, game.id, n, game.id, n));
  // Each enacted proposal raises its rule's revision by one (rule 107.2): 1 + the proposals enacted on it before, counted
  // by the rule they change (a clause, 402.1, is rule 402; an added rule is its new number).
  for (const q of ordered) {
    stmts.push(env.DB.prepare(
      `UPDATE proposals SET status = 'enacted', decided_at = ?,
         rev = 1 + (SELECT COUNT(*) FROM proposals e WHERE e.game_id = proposals.game_id AND e.status = 'enacted'
           AND CAST(CASE WHEN e.kind = 'add' THEN e.new_num ELSE e.target END AS INTEGER) = CAST(CASE WHEN proposals.kind = 'add' THEN proposals.new_num ELSE proposals.target END AS INTEGER))
       WHERE id = ? AND status = 'passed'`,
    ).bind(now, q.id));
  }
  return stmts;
}
