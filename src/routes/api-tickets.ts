// The Workshop's tickets (rules 801-804): a commission opens a ticket, the requester fills it in by hand, confirming it is one
// of their proposals for the day, and anyone in the game can post in its discussion.
//   GET  /<slug>/api/tickets                 the list: every ticket but other players' drafts; number, title, requester, state,
//                                            estimate, price. PUBLIC, like the rulebook (no emails or ids)
//   POST /<slug>/api/tickets                 "Commission something": your open draft, or a new one (W1, W2...). Your blank draft, or a new one
//   GET  /<slug>/api/tickets/<W3>            the ticket page: every field, its tasks, its log and its discussion
//   POST /<slug>/api/tickets/<W3>/edit       {title?, brief?, makes?, estimate?, running_cost?, tasks?}: your draft, by hand
//   POST /<slug>/api/tickets/<W3>/confirm    your draft becomes your proposal for the day (rule 801.1, the same limit and the same
//                                            confirm as any proposal: P-numbered, on tomorrow's ballot, voted at block 800's mark)
//   POST /<slug>/api/tickets/<W3>/post       {body}: a post in the discussion (rule 804.1)
// Every write that is a move of the day goes through the day's gate (the lock, End turn), in the handler and in the SQL.
// The price is 0 until Gremlin sets it (a later step).
import { getPlayer } from "../lib/auth";
import { clockNow, dayOpenBinds, loadToday } from "../lib/day";
import { COMMISSION_DRAFT_SQL, OPEN_DRAFT_SQL, WORKSHOP_RULE, canPost, confirmProblem, readFields, readPost, ticketNumber } from "../lib/tickets.js";
import { refusalBody, turnBlock } from "../lib/turn";
import { COLS, FROM, ticketView } from "../lib/ticket-view";
import { Ctx, colorOf, json, nowIso, readJson } from "../lib/util";
import { bookFor, confirm as confirmProposal } from "./api-proposals";

type Out = { status: number; body: any };
const out = (body: any, status = 200): Out => ({ status, body });

/** @rule 801.2 */
async function findTicket(env: Ctx["env"], gameId: string, raw: unknown) {
  const n = ticketNumber(raw);
  if (n === null) return null;
  return (await env.DB.prepare(`SELECT ${COLS} ${FROM} WHERE t.game_id = ? AND t.number = ?`).bind(gameId, n).first()) as any;
}
// A draft is its requester's alone to see.
/** @rule 801.2 */
const visible = (r: any, player: any) => r && (r.state !== "Draft" || (!!player && r.player_id === player.id));

// GET /api/tickets
/** @rule 801.2 */
export const get = async (ctx: Ctx) => {
  const { env, request } = ctx;
  const game = ctx.data.game!;
  const player = await getPlayer(env, request, game);
  const rows = (await env.DB.prepare(`SELECT ${COLS} ${FROM} WHERE t.game_id = ? AND (t.state != 'Draft' OR t.player_id = ?) ORDER BY t.number DESC`).bind(game.id, player?.id ?? "").all()).results as any[];
  return json({ tickets: rows.map((r) => ticketView(r, player?.id)) });
};

// POST /api/tickets: "Commission something". Your open draft if you have one, else a new one.
/** @rule 801.1, 801.2 */
export async function open(ctx: Ctx, player: any, nowMs: number): Promise<Out> {
  const { env } = ctx;
  const { game, day, turn } = await loadToday(env, ctx.data.game!, nowMs, player.id);
  const blocked = turnBlock(game, day, turn, player, "propose", nowMs);
  if (blocked) return out(refusalBody(blocked), blocked.status);
  const { book } = await bookFor(game);
  if (!book.byNum[WORKSHOP_RULE]) return out({ error: "This game has no workshop." }, 409);
  // A blank draft is the one "Commission something" opens again; a draft with something in it, or one that came back from
  // the ballot, stays where it is (it is in the list) and a new blank one is opened.
  const blank = "SELECT number FROM tickets WHERE game_id = ? AND player_id = ? AND state = 'Draft' AND title = '' AND brief = '' AND makes = '[]' ORDER BY number DESC LIMIT 1";
  const have: any = await env.DB.prepare(blank).bind(game.id, player.id).first();
  if (have) return out({ ok: true, ticket: `W${have.number}`, existing: true });
  const now = nowIso(nowMs);
  const id = crypto.randomUUID();
  const res = await env.DB.prepare(OPEN_DRAFT_SQL).bind(id, player.id, now, now, game.id, player.id, ...dayOpenBinds(game.day, nowMs, player.id)).run();
  if (res?.meta?.changes > 0) {
    const row: any = await env.DB.prepare("SELECT number FROM tickets WHERE id = ?").bind(id).first();
    return out({ ok: true, ticket: `W${row.number}`, existing: false });
  }
  const again: any = await env.DB.prepare(blank).bind(game.id, player.id).first(); // two clicks raced: the other one's draft
  if (again) return out({ ok: true, ticket: `W${again.number}`, existing: true });
  return out({ error: "The day changed under you. Reload and try again." }, 409);
}

// A ticket page: its fields, tasks, log, discussion, and what the viewer may do with it.
/** @rule 801.2, 804.1 */
async function page(ctx: Ctx, r: any, player: any, nowMs: number) {
  const { env } = ctx;
  const game = ctx.data.game!;
  const [tasks, log, posts] = await Promise.all([
    env.DB.prepare("SELECT text, done, done_day FROM ticket_tasks WHERE ticket_id = ? ORDER BY pos").bind(r.id).all(),
    env.DB.prepare("SELECT day, kind, text, at FROM ticket_log WHERE ticket_id = ? ORDER BY id").bind(r.id).all(),
    env.DB.prepare(
      `SELECT x.id, x.author_kind, x.body, x.at, p.display_name AS name, p.color FROM ticket_posts x LEFT JOIN players p ON p.game_id = x.game_id AND p.id = x.player_id WHERE x.ticket_id = ? ORDER BY x.id`,
    ).bind(r.id).all(),
  ]);
  let edit: { allowed: boolean; reason?: string } = { allowed: false };
  if (player && r.player_id === player.id && r.state === "Draft") {
    const { game: g, day, turn } = await loadToday(env, game, nowMs, player.id);
    const b = turnBlock(g, day, turn, player, "propose", nowMs);
    edit = b ? { allowed: false, reason: b.error } : { allowed: true };
  }
  return {
    ...ticketView(r, player?.id),
    tasks: (tasks.results as any[]).map((t) => ({ text: t.text, done: !!t.done, done_day: t.done_day ?? null })),
    log: (log.results as any[]).map((l) => ({ day: l.day ?? null, kind: l.kind, text: l.text, at: l.at })),
    posts: (posts.results as any[]).map((x) => ({
      id: x.id, at: x.at, body: x.body, author: x.author_kind,
      by: x.author_kind === "player" && x.name ? { name: x.name, color: colorOf(x.color) } : undefined,
    })),
    can: { edit, confirm: edit, post: canPost(player) },
  };
}

// GET /api/tickets/<W3>
/** @rule 801.2, 804.1 */
export const one = async (ctx: Ctx) => {
  const { env, request } = ctx;
  const game = ctx.data.game!;
  const player = await getPlayer(env, request, game);
  const r = await findTicket(env, game.id, ctx.params.n);
  if (!visible(r, player)) return json({ error: "There is no such ticket." }, 404);
  return json({ ticket: await page(ctx, r, player, await clockNow(env)) });
};

// Your draft, for a write: the player's own ticket, still a draft, and the day open for them to propose.
/** @rule 801.1 */
async function mine(ctx: Ctx, player: any, raw: unknown, nowMs: number): Promise<{ t: any; game: any } | Out> {
  const { env } = ctx;
  const { game, day, turn } = await loadToday(env, ctx.data.game!, nowMs, player.id);
  const blocked = turnBlock(game, day, turn, player, "propose", nowMs);
  if (blocked) return out(refusalBody(blocked), blocked.status);
  const t = await findTicket(env, game.id, raw);
  if (!t || t.player_id !== player.id) return out({ error: "There is no such ticket of yours." }, 404);
  if (t.state !== "Draft") return out({ error: `W${t.number} is ${t.state === "Proposed" ? "on the ballot" : t.state.toLowerCase()}, so it can't be changed.` }, 409);
  // A draft that still points at a proposal is a confirm that did not finish (or a withdraw that did not reach it): settle it.
  if (t.proposal_id) {
    const q: any = await env.DB.prepare("SELECT number, status, created_at FROM proposals WHERE id = ?").bind(t.proposal_id).first();
    const now = nowIso(nowMs);
    if (q && (q.status === "confirmed" || q.status === "on_ballot")) {
      await env.DB.batch([
        env.DB.prepare("UPDATE tickets SET state = 'Proposed', proposed_at = COALESCE(proposed_at, ?), updated_at = ? WHERE id = ? AND state = 'Draft' AND proposal_id = ?").bind(now, now, t.id, t.proposal_id),
        env.DB.prepare("INSERT INTO ticket_log (ticket_id, day, kind, text, at) SELECT id, ?, 'proposed', ?, ? FROM tickets WHERE id = ? AND state = 'Proposed' AND proposal_id = ?").bind(game.day, `Put on tomorrow's ballot as P${q.number}.`, now, t.id, t.proposal_id),
      ]);
      return out({ error: `W${t.number} is on the ballot as P${q.number}, so it can't be changed.` }, 409);
    }
    if (q && q.status === "draft" && nowMs - Date.parse(q.created_at) < 60_000) {
      // another confirm of this ticket is in flight right now (a draft left from a minute ago is a confirm that died: settled below)
      return out({ error: `W${t.number} is being put on the ballot. Reload and look again.` }, 409);
    }
    await env.DB.batch([
      env.DB.prepare("UPDATE tickets SET proposal_id = NULL, updated_at = ? WHERE id = ? AND state = 'Draft' AND proposal_id = ?").bind(now, t.id, t.proposal_id),
      env.DB.prepare("DELETE FROM proposals WHERE id = ? AND status = 'draft' AND kind = 'commission'").bind(t.proposal_id),
    ]);
  }
  return { t, game };
}

// POST /api/tickets/<W3>/edit
/** @rule 801.2 */
export async function edit(ctx: Ctx, player: any, raw: unknown, body: any, nowMs: number): Promise<Out> {
  const { env } = ctx;
  const m = await mine(ctx, player, raw, nowMs);
  if ("status" in m) return m;
  const { t, game } = m;
  const r = readFields(body);
  if ("error" in r) return out({ error: r.error }, 400);
  const f = r.fields as any;
  const now = nowIso(nowMs);
  const sets: string[] = [], binds: unknown[] = [];
  for (const k of ["title", "brief", "estimate", "running_cost"]) if (k in f) { sets.push(`${k} = ?`); binds.push(f[k]); }
  if ("makes" in f) { sets.push("makes = ?"); binds.push(JSON.stringify(f.makes)); }
  const guard = `id = ? AND state = 'Draft' AND player_id = ? AND proposal_id IS NULL AND EXISTS (SELECT 1 FROM games g WHERE g.id = tickets.game_id AND ${"g.status = 'playing' AND g.phase = 'open' AND g.day = ?"})`;
  const stmts = [env.DB.prepare(`UPDATE tickets SET ${[...sets, "updated_at = ?"].join(", ")} WHERE ${guard}`).bind(...binds, now, t.id, player.id, game.day)];
  if ("tasks" in f) {
    // the tasks follow the same gate as the fields: your draft, not on a ballot, the day open
    const ok = "EXISTS (SELECT 1 FROM tickets x JOIN games g ON g.id = x.game_id WHERE x.id = ? AND x.state = 'Draft' AND x.player_id = ? AND x.proposal_id IS NULL AND g.status = 'playing' AND g.phase = 'open' AND g.day = ?)";
    stmts.push(env.DB.prepare(`DELETE FROM ticket_tasks WHERE ticket_id = ? AND ${ok}`).bind(t.id, t.id, player.id, game.day));
    f.tasks.forEach((text: string, i: number) => stmts.push(env.DB.prepare(`INSERT INTO ticket_tasks (ticket_id, pos, text) SELECT ?, ?, ? WHERE ${ok}`).bind(t.id, i + 1, text, t.id, player.id, game.day)));
  }
  const res = await env.DB.batch(stmts);
  if (!(res[0]?.meta?.changes > 0)) return out({ error: "The day changed under you. Reload and try again." }, 409);
  const fresh = await findTicket(env, game.id, t.number);
  return out({ ok: true, ticket: await page(ctx, fresh, player, nowMs) });
}

// POST /api/tickets/<W3>/confirm: the commission is one of your proposals for the day (rule 801.1). It goes through the same
// confirm as any proposal, so the day's limit, the number, the mark and the ballot are the proposals' own. A commission that
// names nothing to make is refused (rule 801.3).
/** @rule 801.1, 801.3 */
export async function confirm(ctx: Ctx, player: any, raw: unknown, nowMs: number): Promise<Out> {
  const { env } = ctx;
  const m = await mine(ctx, player, raw, nowMs);
  if ("status" in m) return m;
  const { t, game } = m;
  const { book, sha } = await bookFor(game);
  if (!book.byNum[WORKSHOP_RULE]) return out({ error: "This game has no workshop." }, 409);
  const now = nowIso(nowMs);
  const problem = confirmProblem(t);
  if (problem) {
    if (!problem.refuse) return out({ error: problem.error }, 400);
    await env.DB.batch([
      env.DB.prepare("UPDATE tickets SET state = 'Refused', decided_at = ?, updated_at = ? WHERE id = ? AND state = 'Draft' AND proposal_id IS NULL").bind(now, now, t.id),
      env.DB.prepare("INSERT OR IGNORE INTO ticket_log (ticket_id, day, kind, text, at) SELECT id, ?, 'refused', ?, ? FROM tickets WHERE id = ? AND state = 'Refused'").bind(game.day, problem.error, now, t.id),
    ]);
    return out({ error: problem.error, state: "Refused" }, 422);
  }
  // The commission's own proposal row, then the shared confirm. The ticket points at it first, so the count always finds it.
  const pid = crypto.randomUUID();
  const ins = await env.DB.prepare(COMMISSION_DRAFT_SQL).bind(pid, player.id, t.brief, t.title, `Commission W${t.number}: ${t.title}`, sha, now, game.id, ...dayOpenBinds(game.day, nowMs, player.id)).run();
  if (!(ins?.meta?.changes > 0)) return out({ error: "The day changed under you. Reload and try again." }, 409);
  const undo = () => env.DB.batch([
    env.DB.prepare("UPDATE tickets SET proposal_id = NULL WHERE id = ? AND proposal_id = ? AND state = 'Draft'").bind(t.id, pid),
    env.DB.prepare("DELETE FROM proposals WHERE id = ? AND status = 'draft' AND kind = 'commission'").bind(pid),
  ]);
  const link = await env.DB.prepare("UPDATE tickets SET proposal_id = ?, updated_at = ? WHERE id = ? AND state = 'Draft' AND proposal_id IS NULL").bind(pid, now, t.id).run();
  if (!(link?.meta?.changes > 0)) {   // another confirm of this ticket got there first: one ticket, one proposal
    await env.DB.prepare("DELETE FROM proposals WHERE id = ? AND status = 'draft' AND kind = 'commission'").bind(pid).run();
    return out({ error: `W${t.number} is being put on the ballot. Reload and look again.` }, 409);
  }
  let res: Out;
  try { res = await confirmProposal(ctx, player, pid, nowMs); } catch (e) { await undo(); throw e; }   // a draft proposal is undone; a confirmed one is settled by mine() next time
  if (res.status >= 400) { await undo(); return res; }
  const number = res.body?.proposal?.number;
  await env.DB.batch([
    env.DB.prepare("UPDATE tickets SET state = 'Proposed', proposed_at = ?, updated_at = ? WHERE id = ? AND state = 'Draft' AND proposal_id = ? AND EXISTS (SELECT 1 FROM proposals WHERE id = ? AND status = 'confirmed')").bind(now, now, t.id, pid, pid),
    env.DB.prepare("INSERT INTO ticket_log (ticket_id, day, kind, text, at) SELECT id, ?, 'proposed', ?, ? FROM tickets WHERE id = ? AND state = 'Proposed' AND proposal_id = ?").bind(game.day, `Put on tomorrow's ballot as P${number}.`, now, t.id, pid),
  ]);
  const fresh = await findTicket(env, game.id, t.number);
  return out({ ok: true, ticket: await page(ctx, fresh, player, nowMs), message: `W${t.number} is P${number} on tomorrow's ballot.` });
}

// POST /api/tickets/<W3>/post: anyone in the game (rule 804.1).
/** @rule 804.1 */
export async function addPost(ctx: Ctx, player: any, raw: unknown, body: any, nowMs: number): Promise<Out> {
  const { env } = ctx;
  const game = ctx.data.game!;
  const can = canPost(player);
  if (!can.allowed) return out({ error: can.reason }, 401);
  const t = await findTicket(env, game.id, raw);
  if (!visible(t, player)) return out({ error: "There is no such ticket." }, 404);
  const r = readPost(body);
  if ("error" in r) return out({ error: r.error }, 400);
  await env.DB.prepare("INSERT INTO ticket_posts (ticket_id, game_id, author_kind, player_id, body, at) VALUES (?, ?, 'player', ?, ?, ?)").bind(t.id, game.id, player.id, r.body, nowIso(nowMs)).run();
  return out({ ok: true, ticket: await page(ctx, t, player, nowMs) });
}

/** @rule 801.1 */
const send = (o: Out) => json(o.body, o.status);
const need = (ctx: Ctx) => getPlayer(ctx.env, ctx.request, ctx.data.game!);

// POST /api/tickets
/** @rule 801.1, 801.2 */
export const post = async (ctx: Ctx) => {
  const player = await need(ctx);
  if (!player) return json({ error: "Log in to commission something." }, 401);
  await readJson(ctx.request);
  return send(await open(ctx, player, await clockNow(ctx.env)));
};

// POST /api/tickets/<W3>/(edit|confirm|post)
/** @rule 801.1, 801.2, 804.1 */
export const action = (what: "edit" | "confirm" | "post") => async (ctx: Ctx) => {
  const player = await need(ctx);
  if (!player) return json({ error: what === "post" ? "Log in to post." : "Log in to commission something." }, 401);
  const body = await readJson(ctx.request);
  const nowMs = await clockNow(ctx.env);
  const n = ctx.params.n;
  return send(await (what === "edit" ? edit(ctx, player, n, body, nowMs) : what === "post" ? addPost(ctx, player, n, body, nowMs) : confirm(ctx, player, n, nowMs)));
};
