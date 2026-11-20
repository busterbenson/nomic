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

// The night takes effect (the deployed rules are the claimed commit): each applied proposal is enacted in the order
// they were applied, its points given (rule 401, onEnacted), then the end of the night (rule 402, dayEnd: a win ends
// the game). Returns the statements for ONE batch. Every one is guarded by "this proposal is still passed" (points,
// enacted) or "a proposal of this day is still passed" (the win, rules_day), and the points and the win come BEFORE
// the status changes in the batch, so a second run (or an overlapping one) gives nothing twice.
/** @rule 107.2, 401, 402 */
export async function enactStatements(env: Env, game: any, n: number, nowMs: number) {
  const rows = (await env.DB.prepare("SELECT id, number, player_id, target, kind FROM proposals WHERE game_id = ? AND day_ballot = ? AND status = 'passed' AND commit_sha IS NOT NULL ORDER BY number").bind(game.id, n).all()).results as any[];
  if (!rows.length) return [];
  const now = nowIso(nowMs);
  const ordered = await orderPassed(env, game, rows, nowMs);
  const ctx = await nightContext(env, game, nowMs);
  const rules = rulesFor(game);
  const before: Record<string, number> = Object.fromEntries(ctx.players.map((p: any) => [p.ref, p.score]));
  const known = new Set(Object.keys(before));
  const given: { player: string; delta: number; reason: string; number: number }[] = [];
  const stmts: any[] = [];
  const stillPassed = "EXISTS (SELECT 1 FROM proposals WHERE id = ? AND status = 'passed')";
  for (const q of ordered) {
    for (const e of rules.onEnacted(ctx, { number: q.number, player: q.player_id, target: q.target, kind: q.kind })) {
      if (e.type !== "points" || !known.has(e.player)) continue;
      given.push({ player: e.player, delta: e.delta, reason: e.reason, number: q.number });
      stmts.push(env.DB.prepare(`UPDATE players SET score = score + ? WHERE game_id = ? AND id = ? AND ${stillPassed}`).bind(e.delta, game.id, e.player, q.id));
      stmts.push(env.DB.prepare(
        `INSERT INTO events (game_id, kind, text, created_at, day, phase, template, args, player_id)
         SELECT ?, 'points', ?, ?, ?, 'night', 'points', json_object('proposal', ?, 'delta', ?, 'rule', ?), ? WHERE ${stillPassed}`,
      ).bind(game.id, `+${e.delta}: ${e.reason}`, now, n, q.number, e.delta, e.rule, e.player, q.id));
    }
  }
  const win = rules.dayEnd(ctx, { before, given: given.map(({ player, delta }) => ({ player, delta })), enacted: ordered.map((q) => q.number) }).find((e: any) => e.type === "win" && known.has(e.player));
  const anyPassed = `EXISTS (SELECT 1 FROM proposals WHERE game_id = ? AND day_ballot = ? AND status = 'passed')`;
  if (win) {
    stmts.push(env.DB.prepare(
      `INSERT INTO events (game_id, kind, text, created_at, day, phase, template, args, player_id)
       SELECT ?, 'won', ?, ?, ?, 'night', 'won', json_object('rule', ?, 'reason', ?), ? WHERE ${anyPassed}`,
    ).bind(game.id, `Won: ${win.reason}`, now, n, win.rule, win.reason, win.player, game.id, n));
    stmts.push(env.DB.prepare(`UPDATE games SET status = 'over' WHERE id = ? AND status = 'playing' AND ${anyPassed}`).bind(game.id, game.id, n));
  }
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
