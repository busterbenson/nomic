// The moderator's routes (rules 106, 107.2-107.8): what the night has to apply, and the claim that it is applied.
// Called by moderator/process-day.mjs on the Mac mini, never by a browser. Bearer token per game:
// `Authorization: Bearer <token>`, checked against games.moderator_token_hash (SHA-256 hex). No hash, no header or a
// wrong token: 401 with no detail.
//   GET  /<slug>/api/moderator/pending           the night in progress (processing or deploying), its passed proposals in
//                                                the order the game's rules apply them (107.2), and every not-applied
//                                                proposal (for the moderator to reconcile the repo with, 107.7)
//   POST /<slug>/api/moderator/days/:n/claim      {sha, outcomes: [{number, seq, applied: true, commit} | {number, seq,
//                                                applied: false, reason}], notes?: [{number, body}]}: accepted only while
//                                                day n is processing and before its deadline (107.6); the day goes to
//                                                deploying. seq is the order the moderator applied them in (1..n, each
//                                                once); the enactment follows it (107.2).
import { monthSpend } from "../lib/agent";
import { clockNow, deployDeadline, notAppliedStatements } from "../lib/day";
import { orderPassed } from "../engine/host";
import { Ctx, json, nowIso, readJson, sha256Hex } from "../lib/util";

const SHA = /^[0-9a-f]{40}$/;
const MAX_REASON = 400, MAX_NOTE = 600;

// The game whose token this is, or null. Compares the hashes in constant time.
/** @rule 106.1 */
async function authorized(ctx: Ctx): Promise<boolean> {
  const game = ctx.data.game!;
  const h = ctx.request.headers.get("authorization") || "";
  const m = /^Bearer ([A-Za-z0-9._~+/=-]{20,200})$/.exec(h);
  if (!m || !game.moderator_token_hash) return false;
  const got = await sha256Hex(m[1]);
  const want = String(game.moderator_token_hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}
const unauthorized = () => json({ error: "Not authorized." }, 401);

/** @rule 107.2, 107.7 */
export const pending = async (ctx: Ctx) => {
  if (!(await authorized(ctx))) return unauthorized();
  const { env } = ctx;
  const game = ctx.data.game!;
  const nowMs = await clockNow(env);
  const day: any = game.day ? await env.DB.prepare("SELECT * FROM days WHERE game_id = ? AND n = ? AND status IN ('processing', 'deploying')").bind(game.id, game.day).first() : null;
  let job: any = null;
  if (day) {
    const rows = (await env.DB.prepare(
      `SELECT q.number, q.title, q.kind, q.scope, q.target, q.new_num, q.to_block, q.words, q.draft_head, q.before_text, q.after_text,
              q.settings, q.conflicts, q.mark, q.yes, q.no, q.needed, q.budget_minutes, q.budget_effort, q.base_sha, q.commit_sha,
              q.day_proposed, p.display_name AS player
       FROM proposals q JOIN players p ON p.id = q.player_id AND p.game_id = q.game_id
       WHERE q.game_id = ? AND q.day_ballot = ? AND q.status = 'passed' AND q.kind != 'commission' ORDER BY q.number`,
    ).bind(game.id, day.n).all()).results as any[];
    const passed = (await orderPassed(env, game, rows, nowMs)).map((r) => ({ ...r, settings: JSON.parse(r.settings || "{}"), conflicts: JSON.parse(r.conflicts || "[]"), player: { name: r.player } }));
    const deadline = Date.parse(day.deadline_at);
    job = { day: day.n, status: day.status, locked_at: day.locked_at, deadline_at: day.deadline_at, deploy_deadline_at: Number.isFinite(deadline) ? nowIso(deployDeadline(deadline)) : null, commit_sha: day.commit_sha, tag: day.tag, passed };
  }
  const notApplied = (await env.DB.prepare("SELECT number, day_ballot AS day, not_applied_reason AS reason FROM proposals WHERE game_id = ? AND status = 'not_applied' ORDER BY number").bind(game.id).all()).results;
  const processed = (await env.DB.prepare("SELECT n, status, commit_sha, tag FROM days WHERE game_id = ? AND status IN ('done', 'timed_out') ORDER BY n DESC LIMIT 3").bind(game.id).all()).results;
  return json({ game: { slug: game.slug, repo: game.repo, status: game.status, day: game.day, rules_day: game.rules_day }, now: nowIso(nowMs), job, not_applied: notApplied, processed });
};

// GET /api/moderator/agents[?day=N]: the night's read of the agents (rules 106.3, 106.7): what the model calls did that day, what the game has
// spent this month against its budget, the reasons of everything that was refused or invalid, and who hit the cap. Counts, outcomes and short
// reasons only: no prompt and no chat text (a player's chat is private to them).
/** @rule 106.3, 106.7 */
export const agents = async (ctx: Ctx) => {
  if (!(await authorized(ctx))) return unauthorized();
  const { env } = ctx;
  const game = ctx.data.game!;
  const raw = new URL(ctx.request.url).searchParams.get("day");
  const n = raw === null ? game.day : Number(raw);
  if (!Number.isInteger(n) || n < 1) return json({ error: "Bad day." }, 400);
  const day: any = await env.DB.prepare("SELECT starts_at, ends_at FROM days WHERE game_id = ? AND n = ?").bind(game.id, n).first();
  if (!day) return json({ error: "No such day." }, 404);
  const win = [game.id, day.starts_at, day.ends_at];
  const [calls, reasons, capped] = await Promise.all([
    env.DB.prepare(`SELECT agent, purpose, outcome, COUNT(*) AS calls, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(cache_read), 0) AS cache_read, COALESCE(SUM(cache_write), 0) AS cache_write,
        COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(cost_micro), 0) AS cost_micro FROM agent_calls WHERE game_id = ? AND at >= ? AND at < ? GROUP BY agent, purpose, outcome ORDER BY agent, purpose, outcome`).bind(...win).all(),
    env.DB.prepare(`SELECT outcome, reason, COUNT(*) AS n FROM agent_calls WHERE game_id = ? AND at >= ? AND at < ? AND outcome NOT IN ('ok', 'pending') AND reason IS NOT NULL GROUP BY outcome, reason ORDER BY n DESC LIMIT 50`).bind(...win).all(),
    env.DB.prepare(`SELECT COUNT(DISTINCT player_id) AS n FROM chat_messages WHERE game_id = ? AND at >= ? AND at < ? AND role = 'excuse'`).bind(...win).first(),
  ]);
  const spend = await monthSpend(env, game, await clockNow(env));
  return json({ day: n, calls: calls.results, reasons: reasons.results, players_at_cap: (capped as any)?.n ?? 0, month: { spent_micro: spend.spent, budget_micro: spend.budget, over: spend.over } });
};

/** @rule 107.6, 107.7, 107.8 */
export const claim = async (ctx: Ctx) => {
  if (!(await authorized(ctx))) return unauthorized();
  const { env } = ctx;
  const game = ctx.data.game!;
  const n = Number(ctx.params.n);
  const body = await readJson(ctx.request);
  if (!Number.isInteger(n) || n < 1) return json({ error: "Bad day." }, 400);
  if (!body || typeof body.sha !== "string" || !SHA.test(body.sha) || !Array.isArray(body.outcomes)) return json({ error: "Send {sha, outcomes}." }, 400);
  const nowMs = await clockNow(env);
  const day: any = await env.DB.prepare("SELECT * FROM days WHERE game_id = ? AND n = ?").bind(game.id, n).first();
  if (!day) return json({ error: "No such day." }, 404);
  // The same claim again (the moderator restarted after its claim landed): already accepted.
  if (day.status === "deploying" && day.commit_sha === body.sha) return json({ status: "deploying", deploy_deadline_at: nowIso(deployDeadline(Date.parse(day.deadline_at))), repeat: true });
  if (day.status !== "processing") return json({ error: `Day ${n} is not waiting for the moderator (it is ${day.status}).` }, 409);
  if (!(nowMs < Date.parse(day.deadline_at))) return json({ error: `Too late: the deadline for day ${n} has passed (rule 107.6).` }, 409);

  const passed = (await env.DB.prepare("SELECT id, number, player_id FROM proposals WHERE game_id = ? AND day_ballot = ? AND status = 'passed' AND kind != 'commission'").bind(game.id, n).all()).results as any[];
  const byNum = new Map(passed.map((q) => [q.number, q]));
  const seen = new Set<number>(), seqs = new Set<number>();
  for (const o of body.outcomes) {
    if (!o || !byNum.has(o.number) || seen.has(o.number)) return json({ error: "The outcomes must name each passed proposal once." }, 400);
    seen.add(o.number);
    if (!Number.isInteger(o.seq) || o.seq < 1 || o.seq > body.outcomes.length || seqs.has(o.seq)) return json({ error: `P${o.number}: each outcome needs its place in the order applied (seq 1 to ${body.outcomes.length}, each once).` }, 400);
    seqs.add(o.seq);
    if (o.applied === true) { if (typeof o.commit !== "string" || !SHA.test(o.commit)) return json({ error: `P${o.number}: an applied outcome needs its commit.` }, 400); }
    else if (o.applied === false) { if (typeof o.reason !== "string" || !o.reason.trim() || o.reason.length > MAX_REASON) return json({ error: `P${o.number}: a not-applied outcome needs a reason (at most ${MAX_REASON} characters).` }, 400); }
    else return json({ error: `P${o.number}: applied must be true or false.` }, 400);
  }
  if (seen.size !== passed.length) return json({ error: "The outcomes must name each passed proposal once." }, 400);
  const notes = Array.isArray(body.notes) ? body.notes : [];
  for (const x of notes) if (!x || !byNum.has(x.number) || typeof x.body !== "string" || !x.body.trim() || x.body.length > MAX_NOTE) return json({ error: `A note needs a passed proposal's number and a body of at most ${MAX_NOTE} characters.` }, 400);

  const now = nowIso(nowMs);
  // Every write lands only if THIS claim moved the day to deploying (status and sha), so a late or a second claim
  // with another sha writes nothing.
  const mine = " AND EXISTS (SELECT 1 FROM days WHERE game_id = ? AND n = ? AND status = 'deploying' AND commit_sha = ?)";
  const stmts: any[] = [
    env.DB.prepare("UPDATE days SET status = 'deploying', commit_sha = ?, tag = ? WHERE game_id = ? AND n = ? AND status = 'processing' AND deadline_at > ?").bind(body.sha, `day-${n}`, game.id, n, now),
  ];
  for (const o of body.outcomes) {
    const q = byNum.get(o.number);
    if (o.applied) stmts.push(env.DB.prepare(`UPDATE proposals SET commit_sha = ?, apply_seq = ? WHERE id = ? AND status = 'passed'${mine}`).bind(o.commit, o.seq, q.id, game.id, n, body.sha));
    else {
      stmts.push(...notAppliedStatements(env, game, q, o.reason.trim().replace(/[.\s]+$/, ""), now, mine, [game.id, n, body.sha]));
    }
  }
  for (const x of notes) {
    const q = byNum.get(x.number);
    stmts.push(env.DB.prepare(
      `INSERT OR IGNORE INTO notifications (id, game_id, player_id, kind, body, link, created_at)
       SELECT ?, ?, ?, 'moderator_note', ?, ?, ? WHERE EXISTS (SELECT 1 FROM days WHERE game_id = ? AND n = ? AND status = 'deploying' AND commit_sha = ?)`,
    ).bind(`audit-${q.id}`, game.id, q.player_id, x.body.trim(), `/${game.slug}/`, now, game.id, n, body.sha));
  }
  await env.DB.batch(stmts);
  const after: any = await env.DB.prepare("SELECT status, commit_sha, deadline_at FROM days WHERE game_id = ? AND n = ?").bind(game.id, n).first();
  if (after?.status !== "deploying" || after.commit_sha !== body.sha) return json({ error: `Day ${n} was not claimed (the deadline passed or another claim landed first).` }, 409);
  return json({ status: "deploying", deploy_deadline_at: nowIso(deployDeadline(Date.parse(after.deadline_at))) });
};
