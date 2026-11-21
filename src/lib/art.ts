// Generated art on the Worker's side (rules 701.1, 801.2, 106.7): the database and bucket work around the pure parts in src/lib/art.js.
// A drawing is made by the image model in ctx.waitUntil, stored once under tmp/<sha256> (src/lib/art.js says why the key is the hash), and tied
// to the entry that asked for it by an art_refs row. The player may then SAVE it (copied to art/<sha256>) and pick which saved one the entry
// shows (the default). All of it is the player's own draft's: the same gate as their own edit (EDIT_GUARD), checked in the SQL.
// Nothing here writes a ticket's `makes`: the page lays these rows over each entry on the way out (overlay), so a drawing that lands while
// the player is typing can never be lost by, or lose, their edit.
import { MAX_SAVED, DRAWING_STALE_MS, DRAW_TIMEOUT_MS, IMAGE_MODEL, artKey, runImage, sha256Hex, sizeFor, stubImage, stylePrompt, tmpKey } from "./art.js";
import { logCall } from "./agent";
import { dayOpenBinds } from "./day";
import { EDIT_GUARD } from "./tickets.js";
import { Ctx, Env, nowIso } from "./util";

export type Draw = { game: any; player: any; ticket: any; name: string; prompt: string; kind: string | null; attrs: any; tz: string; drawId: number; mode: "new" | "redraw" };

/** The entries of a ticket's `makes` that a drawing can be asked for. @rule 801.2 */
export const entriesOf = (makes: any[]) =>
  (Array.isArray(makes) ? makes : []).filter((m) => m && m.kind === "entry" && typeof m.name === "string")
    .map((m) => ({ name: m.name as string, kind: (m.catalogKind ?? null) as string | null, attrs: m.attrs ?? {}, prompt: String(m.art?.prompt ?? "") }));

/** The model's id: IMAGE_MODEL when set, else the default. @rule 801.2 */
export const modelOf = (env: Env) => (env.IMAGE_MODEL && /^@cf\/[\w./-]+$/.test(env.IMAGE_MODEL) ? env.IMAGE_MODEL : IMAGE_MODEL);

// ---- what the page shows ------------------------------------------------------------------------------------------------------------
/**
 * Lays each entry's drawings over its view: {prompt, shown (the hash the card shows), drawings [{hash, saved, default}], state}. `owner`:
 * the viewer is the ticket's requester, who sees every drawing made; anyone else sees the saved ones (or the latest, so a card is not
 * blank). state: drawing (a call is out, fresh), failed (the last call failed or died), ready, none. @rule 801.2
 */
export async function overlay(env: Env, ticketId: string, makes: any[], views: any[], owner: boolean, nowMs: number) {
  const entries = (Array.isArray(makes) ? makes : []).filter((m) => m && m.kind === "entry");
  const refs = ((await env.DB.prepare("SELECT hash, entry_name, prompt, saved, is_default, id FROM art_refs WHERE ticket_id = ? ORDER BY id").bind(ticketId).all()).results ?? []) as any[];
  const draws = ((await env.DB.prepare("SELECT entry_name, state, started_at, id FROM art_draws WHERE ticket_id = ? ORDER BY id").bind(ticketId).all()).results ?? []) as any[];
  return views.map((v, i) => {
    const m = entries[i], name = String(m?.name ?? v.name ?? "").toLowerCase();
    const mine = refs.filter((r) => r.entry_name.toLowerCase() === name);
    const saved = mine.filter((r) => r.saved);
    const seen = owner ? mine : saved.length ? saved : mine.slice(-1);
    const dflt = saved.find((r) => r.is_default) ?? saved[saved.length - 1] ?? null;
    const shown = (dflt ?? mine[mine.length - 1] ?? null)?.hash ?? null;
    const last = draws.filter((d) => d.entry_name.toLowerCase() === name).pop();
    let state = shown ? "ready" : "none";
    if (last?.state === "pending") state = nowMs - Date.parse(last.started_at) < DRAWING_STALE_MS ? "drawing" : "failed";
    else if (last?.state === "failed") state = "failed";
    return { ...v, art: { prompt: String(m?.art?.prompt ?? mine[mine.length - 1]?.prompt ?? ""), shown, state, drawings: seen.map((r) => ({ hash: r.hash, saved: !!r.saved, default: !!r.is_default })) } };
  });
}

// ---- making a drawing ------------------------------------------------------------------------------------------------------------------
/** Marks a draw that died before it finished (a Worker that was stopped) failed, so Redraw is possible again. @rule 801.2 */
async function expireStale(env: Env, ticketId: string, name: string, nowMs: number) {
  await env.DB.prepare("UPDATE art_draws SET state = 'failed', reason = 'timeout', ended_at = ? WHERE ticket_id = ? AND lower(entry_name) = lower(?) AND state = 'pending' AND started_at < ?")
    .bind(nowIso(nowMs), ticketId, name, nowIso(nowMs - DRAWING_STALE_MS)).run();
}

/** Reserves a draw for one entry: false when one is already out. @rule 801.2 */
export async function reserve(env: Env, game: any, ticket: any, name: string, prompt: string, nowMs: number): Promise<number | null> {
  await expireStale(env, ticket.id, name, nowMs);
  const r = await env.DB.prepare("INSERT OR IGNORE INTO art_draws (game_id, ticket_id, entry_name, prompt, state, started_at) VALUES (?, ?, ?, ?, 'pending', ?)").bind(game.id, ticket.id, name, prompt, nowIso(nowMs)).run();
  return (r as any)?.meta?.changes > 0 ? Number((r as any).meta.last_row_id) : null;
}
/** Gives a reservation back (the Redraw's message was refused). @rule 106.7 */
export async function release(env: Env, drawId: number) { await env.DB.prepare("DELETE FROM art_draws WHERE id = ? AND state = 'pending'").bind(drawId).run(); }

/**
 * The first drawings of a turn (rule 801.2): each entry that carries an art prompt Gremlin has not drawn yet (no draw and no drawing for that
 * exact prompt) gets one. They cost no message: they are part of the turn that wrote the prompt. Runs in ctx.waitUntil.
 */
export async function queueNew(ctx: Ctx, game: any, player: any, ticket: any, makes: any[], tz: string, nowMs: number) {
  const jobs: Draw[] = [];
  for (const e of entriesOf(makes).slice(0, 6)) {
    if (!e.prompt) continue;
    const had: any = await ctx.env.DB.prepare("SELECT 1 AS x FROM art_draws WHERE ticket_id = ? AND lower(entry_name) = lower(?) AND prompt = ? UNION ALL SELECT 1 FROM art_refs WHERE ticket_id = ? AND lower(entry_name) = lower(?) AND prompt = ? LIMIT 1")
      .bind(ticket.id, e.name, e.prompt, ticket.id, e.name, e.prompt).first();
    if (had) continue;
    const drawId = await reserve(ctx.env, game, ticket, e.name, e.prompt, nowMs);
    if (drawId) jobs.push({ game, player, ticket, name: e.name, prompt: e.prompt, kind: e.kind, attrs: e.attrs, tz, drawId, mode: "new" });
  }
  if (jobs.length) ctx.waitUntil((async () => { for (const j of jobs) await draw(ctx.env, j); })());
  return jobs.length;
}

/** One drawing: the model, the bytes' hash, the picture under tmp/, the rows. Never throws; a failure is a failed draw. @rule 801.2 */
export async function draw(env: Env, j: Draw): Promise<void> {
  const t0 = Date.now(), model = modelOf(env);
  const seed = crypto.getRandomValues(new Uint32Array(1))[0] % 2147483647;
  const fail = async (reason: string) => {
    await env.DB.prepare("UPDATE art_draws SET state = 'failed', reason = ?, ended_at = ? WHERE id = ? AND state = 'pending'").bind(reason.slice(0, 120), nowIso(Date.now()), j.drawId).run().catch(() => {});
    await logCall(env, j.game, j.tz, Date.now(), { player_id: j.player.id, agent: "gremlin", purpose: "art", model, outcome: "failed", ms: Date.now() - t0, reason });
  };
  try {
    const size = sizeFor(j.kind, j.attrs);
    const prompt = stylePrompt(j.kind, j.attrs, j.prompt);
    const made = await Promise.race([
      env.ART_STUB ? stubImage(env.ART_STUB, { seed }) : runImage(env.AI, model, { prompt, ...size, seed }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), DRAW_TIMEOUT_MS)),
    ]);
    const hash = await sha256Hex(made.bytes);
    await env.ART.put(tmpKey(hash), made.bytes, { httpMetadata: { contentType: made.type } });
    const now = nowIso(Date.now());
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO art_objects (hash, size_bytes, content_type, model, created_at) VALUES (?, ?, ?, ?, ?)").bind(hash, made.bytes.length, made.type, env.ART_STUB ? `stub:${env.ART_STUB}` : model, now),
      env.DB.prepare("INSERT OR IGNORE INTO art_refs (hash, game_id, ticket_id, entry_name, prompt, saved, is_default, created_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?)").bind(hash, j.game.id, j.ticket.id, j.name, j.prompt, now),
      env.DB.prepare("UPDATE art_draws SET state = 'done', ended_at = ? WHERE id = ? AND state = 'pending'").bind(now, j.drawId),
    ]);
    await logCall(env, j.game, j.tz, Date.now(), { player_id: j.player.id, agent: "gremlin", purpose: "art", model, outcome: "ok", ms: Date.now() - t0 });
  } catch (e: any) {
    console.error("art: a drawing failed:", e?.message || "error");
    await fail(String(e?.message || "error"));
  }
}

// ---- saving, and the default ---------------------------------------------------------------------------------------------------------
// The player's own gate, in the SQL: their draft, not tied to a proposal, the day open for them (EDIT_GUARD).
const gateOf = (game: any, player: any, ticket: any, nowMs: number) => ({ sql: `ticket_id IN (SELECT id FROM tickets WHERE ${EDIT_GUARD})`, binds: [ticket.id, player.id, ...dayOpenBinds(game.day, nowMs, player.id)] });

export type Done = { status: number; body: any };

/**
 * Saves a drawing to the entry: the art_refs row first (saved = 1; the first one saved becomes the default), then the copy to art/<sha256>.
 * A second save of the same drawing changes nothing. A drawing whose tmp/ copy has expired is gone unless the same bytes are already saved.
 * @rule 801.2
 */
export async function save(env: Env, game: any, player: any, ticket: any, name: string, hash: string, nowMs: number): Promise<Done> {
  const ref: any = await env.DB.prepare("SELECT id, saved FROM art_refs WHERE ticket_id = ? AND lower(entry_name) = lower(?) AND hash = ?").bind(ticket.id, name, hash).first();
  if (!ref) return { status: 404, body: { error: "That is not one of this entry's drawings." } };
  if (ref.saved) return { status: 200, body: { ok: true, copied: false } };
  const n: any = await env.DB.prepare("SELECT COUNT(*) AS n FROM art_refs WHERE ticket_id = ? AND lower(entry_name) = lower(?) AND saved = 1").bind(ticket.id, name).first();
  if ((n?.n ?? 0) >= MAX_SAVED) return { status: 409, body: { error: `An entry keeps at most ${MAX_SAVED} drawings.` } };
  const has: any = await env.DB.prepare("SELECT 1 AS x FROM art_refs WHERE ticket_id = ? AND lower(entry_name) = lower(?) AND is_default = 1").bind(ticket.id, name).first();
  const g = gateOf(game, player, ticket, nowMs);
  let up: any;
  try { up = await env.DB.prepare(`UPDATE art_refs SET saved = 1, is_default = ? WHERE id = ? AND saved = 0 AND ${g.sql}`).bind(has ? 0 : 1, ref.id, ...g.binds).run(); }
  catch { up = null; }   // two saves raced for the default: the other one has it
  if (!(up?.meta?.changes > 0)) {
    const again: any = await env.DB.prepare("SELECT saved FROM art_refs WHERE id = ?").bind(ref.id).first();
    return again?.saved ? { status: 200, body: { ok: true, copied: false } } : { status: 409, body: { error: "The day changed under you. Reload and try again." } };
  }
  const src = await env.ART.get(tmpKey(hash));
  if (src) await env.ART.put(artKey(hash), await src.arrayBuffer(), { httpMetadata: { contentType: src.httpMetadata?.contentType } });
  else if (!(await env.ART.head(artKey(hash)))) {
    await env.DB.prepare("UPDATE art_refs SET saved = 0, is_default = 0 WHERE id = ?").bind(ref.id).run();
    return { status: 409, body: { error: "That drawing is gone. Draw it again." } };
  }
  return { status: 200, body: { ok: true, copied: !!src } };
}

/** Picks the drawing the entry shows: it must be one the player saved. @rule 801.2 */
export async function setDefault(env: Env, game: any, player: any, ticket: any, name: string, hash: string, nowMs: number): Promise<Done> {
  const ref: any = await env.DB.prepare("SELECT id, saved, is_default FROM art_refs WHERE ticket_id = ? AND lower(entry_name) = lower(?) AND hash = ?").bind(ticket.id, name, hash).first();
  if (!ref) return { status: 404, body: { error: "That is not one of this entry's drawings." } };
  if (!ref.saved) return { status: 409, body: { error: "Save a drawing before you pick it." } };
  if (ref.is_default) return { status: 200, body: { ok: true } };
  const g = gateOf(game, player, ticket, nowMs);
  const res = await env.DB.batch([
    env.DB.prepare(`UPDATE art_refs SET is_default = 0 WHERE ticket_id = ? AND lower(entry_name) = lower(?) AND is_default = 1 AND ${g.sql}`).bind(ticket.id, name, ...g.binds),
    env.DB.prepare(`UPDATE art_refs SET is_default = 1 WHERE id = ? AND saved = 1 AND ${g.sql}`).bind(ref.id, ...g.binds),
  ]);
  return (res as any)[1]?.meta?.changes > 0 ? { status: 200, body: { ok: true } } : { status: 409, body: { error: "The day changed under you. Reload and try again." } };
}
