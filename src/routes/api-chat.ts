// The chat window's routes (rules 106.3, 106.7, 107.1): a player's private chat with Gremlin, the workshop's helper.
//   GET  /<slug>/api/chat/gremlin[?before=<id>]   YOUR history with him, 50 rows at a time (oldest first within a page; `next` is the
//                                                 cursor of the page before it), and the window's state: the day's cap, what is left,
//                                                 and a reason when the composer is closed (the lock, the cap). Signed-in players only.
//   POST /<slug>/api/chat/gremlin                 {ticket?: "W3", body}: one turn. The message is stored (under the cap, in the same
//                                                 statement), the model answers as JSON, the platform validates it and writes ONLY that draft
//                                                 ticket's fields, and the reply is stored. At the cap he gives his one improvised excuse of
//                                                 the day (then canned ones); during the lock the chat is closed; no key, or over the monthly
//                                                 budget, he is out (a canned line, nothing stored, nothing counted).
// A player reads only their own rows: every query here selects on the signed-in player's id and nothing else. Chat text is private; the
// moderator's night read (api-moderator.ts) gets counts, outcomes and reasons, never text.
import { Player, getPlayer } from "../lib/auth";
import { EXCUSE_SQL, HISTORY_FOR_MODEL, PLAYER_MESSAGE_SQL, historyPage, rowView, usedToday } from "../lib/chat.js";
import { agentsReady, callModel, logCall, monthSpend } from "../lib/agent";
import { clockNow, isLocked, loadToday, lockMessage, settingsOf, timeZoneOf } from "../lib/day";
import { lockOpenBinds, localDate } from "../lib/day-gate.js";
import {
  CANNED_LINES, CHAT_TIMEOUT_MS, EXCUSE_INPUT_CAP_TOKENS, EXCUSE_MODEL, EXCUSE_OUTPUT_CAP_TOKENS, EXCUSE_TIMEOUT_MS, MESSAGE_MAX, MODEL,
  OUTPUT_CAP_TOKENS, answerSchema, cannedExcuse, estimateTokens, excuseRequest, gremlinRequest, moodOf, patchSummary, readExcuse, readGremlinAnswer, systemStatic,
} from "../lib/gremlin.js";
import { refusalBody, turnBlock } from "../lib/turn";
import { Ctx, json, nowIso, readJson } from "../lib/util";
import { bookFor } from "./api-proposals";
import { gremlinWrite, pageOf } from "./api-tickets";

type Out = { status: number; body: any };
/** @rule 106.3 */
const out = (body: any, status = 200): Out => ({ status, body });
const AGENT = "gremlin";
/** @rule 106.3 */
const send = (o: Out) => json(o.body, o.status);

/** The zone's short name for "back at midnight PST". @rule 106.7 */
function zoneAbbr(tz: string, ms: number): string {
  try { return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(ms)).find((x) => x.type === "timeZoneName")?.value ?? tz; } catch { return tz; }
}
/** Is the game locked right now (rule 107.1)? The lock alone: End turn and "before day 1" leave the chat open. @rule 107.1 */
const lockedNow = (game: any, day: any, nowMs: number) => game.status === "playing" && !!day && isLocked(game, day, nowMs);

// The window's state: today's cap and what is left, and why the composer is closed (a reason beside a disabled control, rule 106.7, 107.1).
/** @rule 106.7, 107.1 */
async function stateOf(ctx: Ctx, game: any, day: any, player: Player, nowMs: number) {
  const { env } = ctx;
  const tz = timeZoneOf(game), date = localDate(tz, nowMs);
  const cap: number = settingsOf(game)["gremlin.messages_per_day"];
  const used = await usedToday(env.DB, game.id, player.id, AGENT, date);
  let closed: { kind: string; text: string } | null = null;
  if (lockedNow(game, day, nowMs)) closed = { kind: "lock", text: lockMessage(day.n) };
  // At the cap the composer is closed with the count beside it; his excuse is a line in the log (rule 106.7)
  else if (used >= cap) closed = { kind: "cap", text: `${used} of ${cap} messages today` };
  return { agent: AGENT, date, cap, used, left: Math.max(0, cap - used), closed, ready: agentsReady(env) };
}

// GET /api/chat/gremlin
/** @rule 106.7 */
export const get = async (ctx: Ctx) => {
  const { env, request } = ctx;
  const player = await getPlayer(env, request, ctx.data.game!);
  if (!player) return json({ error: "Log in to talk to Gremlin." }, 401);
  const nowMs = await clockNow(env);
  const { game, day } = await loadToday(env, ctx.data.game!, nowMs, player.id);
  const raw = new URL(request.url).searchParams.get("before");
  const before = raw === null ? undefined : Number(raw);
  if (raw !== null && !(Number.isInteger(before) && before! > 0)) return json({ error: "That is not a place in the history." }, 400);
  const h = await historyPage(env.DB, game.id, player.id, AGENT, before);
  return json({ messages: h.rows, next: h.next, state: await stateOf(ctx, game, day, player, nowMs) });
};

// One stored line, as the client reads it (the same whitelist the history uses).
/** @rule 106.7 */
const viewOf = (id: number, role: string, body: string, date: string, day: number | null, at: string, ticketNumber: number | null, meta: Record<string, unknown> = {}) =>
  rowView({ id, role, body, local_date: date, day, at, ticket_number: ticketNumber, meta: JSON.stringify(meta) });

// The one improvised excuse of the day (rule 106.7). Only the request whose INSERT lands calls the model; the canned excuse is already
// stored when it does, so a failed call leaves the canned one in place. Anyone else at the cap gets a canned one, stored nowhere.
/** @rule 106.7, 107.1 */
async function excuse(ctx: Ctx, game: any, day: any, player: Player, nowMs: number, date: string, cap: number): Promise<string> {
  const { env } = ctx;
  const tz = timeZoneOf(game);
  const canned = cannedExcuse();
  const ins = await env.DB.prepare(EXCUSE_SQL).bind(game.id, player.id, AGENT, date, game.day || null, canned, nowIso(nowMs), game.id, player.id, AGENT, date, cap, game.id, ...lockOpenBinds(nowMs)).run();
  if (!(ins?.meta?.changes > 0)) return cannedExcuse();
  if (!agentsReady(env) || (await monthSpend(env, game, tz, nowMs)).over) return canned;
  const rows = ((await env.DB.prepare("SELECT role, body FROM chat_messages WHERE game_id = ? AND player_id = ? AND agent = ? AND local_date = ? AND role IN ('player', 'agent') ORDER BY id DESC LIMIT 6").bind(game.id, player.id, AGENT, date).all()).results as any[]).reverse();
  const req = excuseRequest({ lines: rows, backAt: `midnight ${zoneAbbr(tz, nowMs)}` });
  if (estimateTokens(req.system + JSON.stringify(req.messages)) > EXCUSE_INPUT_CAP_TOKENS) return canned;
  const r = await callModel(env, { model: EXCUSE_MODEL, system: req.system, messages: req.messages, maxTokens: EXCUSE_OUTPUT_CAP_TOKENS, timeoutMs: EXCUSE_TIMEOUT_MS });
  const text = r.ok ? readExcuse(r.text) : null;
  await logCall(env, game, tz, nowMs, { player_id: player.id, agent: AGENT, purpose: "excuse", model: EXCUSE_MODEL, outcome: r.ok ? (text ? "ok" : "invalid") : r.code, usage: r.usage, ms: r.ms, reason: r.ok ? (text ? null : "unusable") : r.reason });
  if (!text) return canned;
  await env.DB.prepare("UPDATE chat_messages SET body = ? WHERE game_id = ? AND player_id = ? AND agent = ? AND local_date = ? AND role = 'excuse'").bind(text, game.id, player.id, AGENT, date).run();
  return text;
}

// POST /api/chat/gremlin: one turn.
/** @rule 106.3, 106.7, 801.2, 801.4 */
export async function turn(ctx: Ctx, player: Player, body: any, nowMs: number): Promise<Out> {
  const { env } = ctx;
  const text = String(body?.body ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return out({ error: "Write something to say." }, 400);
  if (text.length > MESSAGE_MAX) return out({ error: `A message is at most ${MESSAGE_MAX} characters.` }, 400);
  const { game, day, turn: playerTurn } = await loadToday(env, ctx.data.game!, nowMs, player.id);
  const tz = timeZoneOf(game), date = localDate(tz, nowMs);
  const cap: number = settingsOf(game)["gremlin.messages_per_day"];
  /** @rule 106.7 */
  const state = () => stateOf(ctx, game, day, player, nowMs);

  // During the lock the chat is closed (rule 107.1): read first, alone, so the cap's excuse is never spent on a locked chat.
  if (lockedNow(game, day, nowMs)) return out(refusalBody({ status: 423, error: lockMessage(day.n), processing_day: day.n }), 423);

  // No key, or the game is over its month's budget: he is out. A canned line, nothing stored, and the message is not counted.
  if (!agentsReady(env)) return out({ ok: true, out: "unavailable", messages: [viewOf(0, "event", CANNED_LINES.unavailable, date, game.day || null, nowIso(nowMs), null)], state: await state() });
  const spend = await monthSpend(env, game, tz, nowMs);
  if (spend.over) {
    // one row a player a day is enough for the night's read (repeated sends while over budget must not grow the table without bound)
    const seen = await env.DB.prepare("SELECT 1 AS x FROM agent_calls WHERE game_id = ? AND player_id = ? AND outcome = 'over_budget' AND local_date = ? LIMIT 1").bind(game.id, player.id, date).first();
    if (!seen) await logCall(env, game, tz, nowMs, { player_id: player.id, agent: AGENT, purpose: "chat", model: MODEL, outcome: "over_budget", reason: "month budget" });
    return out({ ok: true, out: "over_budget", messages: [viewOf(0, "event", CANNED_LINES.over_budget, date, game.day || null, nowIso(nowMs), null)], state: await state() });
  }

  // the ticket this turn is about: yours, or nothing
  let ticket: any = null;
  if (body?.ticket !== undefined && body?.ticket !== null && body?.ticket !== "") {
    const n = /^\s*[wW]?(\d{1,6})\s*$/.exec(String(body.ticket));
    ticket = n ? await env.DB.prepare("SELECT * FROM tickets WHERE game_id = ? AND number = ? AND player_id = ?").bind(game.id, Number(n[1]), player.id).first() : null;
    if (!ticket) return out({ error: "There is no such ticket of yours." }, 404);
  }

  // the message goes in only under the cap and outside the lock, in one statement
  const at = nowIso(nowMs);
  const ins = await env.DB.prepare(PLAYER_MESSAGE_SQL).bind(game.id, player.id, AGENT, date, game.day || null, text, ticket?.id ?? null, at, game.id, player.id, AGENT, date, cap, game.id, ...lockOpenBinds(nowMs)).run();
  if (!(ins?.meta?.changes > 0)) {
    // not stored: the lock came down since the read above, or it is the cap
    const again = await loadToday(env, ctx.data.game!, nowMs, player.id);
    if (lockedNow(again.game, again.day, nowMs)) return out(refusalBody({ status: 423, error: lockMessage(again.day.n), processing_day: again.day.n }), 423);
    const said = await excuse(ctx, game, day, player, nowMs, date, cap);
    return out({ ok: true, out: "cap", messages: [viewOf(0, "excuse", said, date, game.day || null, at, null)], state: await state() });
  }
  const myId = Number(ins.meta.last_row_id);
  const mine = viewOf(myId, "player", text, date, game.day || null, at, ticket?.number ?? null);

  // ---- what he is told ----
  const { md: rulesMd } = await bookFor(game);
  const ceiling: number = settingsOf(game)["workshop.price_ceiling"];
  const hist = ((await env.DB.prepare("SELECT role, body FROM chat_messages WHERE game_id = ? AND player_id = ? AND agent = ? AND id < ? ORDER BY id DESC LIMIT ?").bind(game.id, player.id, AGENT, myId, HISTORY_FOR_MODEL).all()).results as any[]).reverse();
  const tasks = ticket ? ((await env.DB.prepare("SELECT text FROM ticket_tasks WHERE ticket_id = ? ORDER BY pos").bind(ticket.id).all()).results as any[]).map((r) => r.text) : [];
  const posts = ticket ? ((await env.DB.prepare("SELECT x.body, x.author_kind, p.display_name FROM ticket_posts x LEFT JOIN players p ON p.game_id = x.game_id AND p.id = x.player_id WHERE x.ticket_id = ? ORDER BY x.id DESC LIMIT 20").bind(ticket.id).all()).results as any[]).reverse().map((r) => ({ by: r.author_kind === "player" ? r.display_name : r.author_kind, author: r.author_kind, body: r.body })) : [];
  const queue: any = await env.DB.prepare("SELECT COUNT(*) AS n FROM tickets WHERE game_id = ? AND queue_pos IS NOT NULL AND state IN ('Approved', 'Building')").bind(game.id).first();
  const last: any = ticket ? await env.DB.prepare("SELECT meta FROM chat_messages WHERE game_id = ? AND player_id = ? AND agent = ? AND ticket_id = ? AND role = 'agent' AND id < ? ORDER BY id DESC LIMIT 1").bind(game.id, player.id, AGENT, ticket.id, myId).first() : null;
  let rejected: string[] = [];
  try { rejected = last ? JSON.parse(last.meta || "{}").rejected || [] : []; } catch { rejected = []; }
  // what he can write this turn: the same gate the player's own edit meets, so he tells them when nothing will land
  let noWrite: string | null = null;
  if (!ticket) noWrite = "no ticket is open";
  else if (ticket.state !== "Draft") noWrite = `W${ticket.number} is ${ticket.state === "Proposed" ? "on the ballot" : ticket.state.toLowerCase()}`;
  else { const b = turnBlock(game, day, playerTurn, player, "propose", nowMs); if (b) noWrite = b.error; }
  const { system, messages } = gremlinRequest({
    ceiling, rulesMd, mood: moodOf(game.id, date), localDate: date, history: hist,
    ticket: ticket ? { number: ticket.number, title: ticket.title, brief: ticket.brief, makes: JSON.parse(ticket.makes || "[]"), estimate: ticket.estimate, running_cost: ticket.running_cost, tasks, price: ticket.price, price_reason: ticket.price_reason } : null,
    posts, queueDepth: queue?.n ?? 0, rejected, label: player.display_name, message: text, noWrite,
  });

  const r = await callModel(env, { model: MODEL, system, messages, maxTokens: OUTPUT_CAP_TOKENS, timeoutMs: CHAT_TIMEOUT_MS, schema: answerSchema(), effort: "low" });

  // ---- what he said, validated ----
  /** @rule 106.3 */
  const reply = async (role: string, bodyText: string, meta: Record<string, unknown>, outcome: string, reason: string | null) => {
    await logCall(env, game, tz, nowMs, { player_id: player.id, agent: AGENT, purpose: "chat", model: MODEL, outcome, usage: r.usage, ms: r.ms, reason });   // first: the budget counts the call whatever happens to the row
    const res = await env.DB.prepare("INSERT INTO chat_messages (game_id, player_id, agent, local_date, day, role, body, ticket_id, meta, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(game.id, player.id, AGENT, date, game.day || null, role, bodyText, ticket?.id ?? null, JSON.stringify(meta), nowIso(nowMs)).run();
    return viewOf(Number(res.meta.last_row_id), role, bodyText, date, game.day || null, nowIso(nowMs), ticket?.number ?? null, meta);
  };
  /** @rule 106.3 */
  const canned = async (code: "unavailable" | "failed" | "malformed" | "refused", outcome: string, reason: string | null) => {
    const line = CANNED_LINES[code === "unavailable" ? "unavailable" : code];
    return out({ ok: true, out: code, messages: [mine, await reply("agent", line, { canned: code }, outcome, reason)], state: await state() });
  };
  if (!r.ok) return canned(r.code, r.code, r.reason);
  const a = readGremlinAnswer(r.text, { ceiling, systemText: systemStatic({ ceiling }) });
  if (!a.ok) return canned(a.code === "invalid" ? "malformed" : a.code, a.code, a.reason);

  // The model can take 30 seconds: the write and its gate use the clock NOW, not the one this request began with, so an answer that lands
  // after midnight is a write during the lock (rule 107.1) and is refused by the guard in the SQL.
  const later = await clockNow(env);
  const lines: any[] = [mine];
  const patch = a.refusal ? {} : a.patch;
  const wrote = Object.keys(patch);
  let saved = true;
  if (wrote.length) {
    saved = ticket && ticket.state === "Draft" ? await gremlinWrite(env, game, player, ticket, patch, later) : false;
  }
  const meta: Record<string, unknown> = {};
  if (saved && wrote.length) { meta.patch = patchSummary(patch); if ("price" in patch) meta.price = patch.price; }
  if (a.rejected.length) meta.rejected = a.rejected;
  if (a.refusal) meta.refusal = a.refusal;
  lines.push(await reply("agent", a.say, meta, "ok", [a.clamped ? "price clamped" : "", a.unbuiltPrice ? "price without a build" : ""].filter(Boolean).join("; ") || null));
  if (wrote.length && !saved) {
    const fresh: any = ticket ? await env.DB.prepare("SELECT state FROM tickets WHERE id = ?").bind(ticket.id).first() : null;
    const again = await loadToday(env, ctx.data.game!, later, player.id);
    const why = !ticket ? "no ticket is open." : fresh?.state !== "Draft" ? `W${ticket.number} is ${fresh?.state === "Proposed" ? "on the ballot" : String(fresh?.state ?? "closed").toLowerCase()}, so it can't be changed.`
      : turnBlock(again.game, again.day, again.turn, player, "propose", later)?.error ?? "the day changed under you.";
    const res = await env.DB.prepare("INSERT INTO chat_messages (game_id, player_id, agent, local_date, day, role, body, ticket_id, meta, at) VALUES (?, ?, ?, ?, ?, 'event', ?, ?, '{}', ?)")
      .bind(game.id, player.id, AGENT, date, game.day || null, `Nothing was saved: ${why}`, ticket?.id ?? null, nowIso(nowMs)).run();
    lines.push(viewOf(Number(res.meta.last_row_id), "event", `Nothing was saved: ${why}`, date, game.day || null, nowIso(nowMs), ticket?.number ?? null));
  }
  return out({ ok: true, out: "ok", messages: lines, ticket: ticket ? await pageOf(ctx, ticket.number, player, nowMs) : null, state: await state() });
}

// POST /api/chat/gremlin
/** @rule 106.7 */
export const post = async (ctx: Ctx) => {
  const player = await getPlayer(ctx.env, ctx.request, ctx.data.game!);
  if (!player) return json({ error: "Log in to talk to Gremlin." }, 401);
  const body = await readJson(ctx.request);
  return send(await turn(ctx, player, body, await clockNow(ctx.env)));
};
