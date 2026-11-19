// The magic link lands here, on the game it was issued for.
//  GET  /<slug>/auth/verify?token=  shows a "Continue" page and consumes NOTHING. Mail
//       scanners and link previews GET links; if GET spent the token the real
//       person would find it expired.
//  POST /<slug>/auth/verify (form field "token", in the body, not the query) is what
//       hashes, checks and uses the token, creates the session and completes a
//       join. Single use, 15 minutes, only for this game. Because it is a plain
//       browser form post (not JSON), it is guarded by an Origin check: the Origin
//       header must match SITE_URL (or the request's own origin when SITE_URL is unset).
import { createSession } from "../lib/auth";
import { ensureTiles, spawnBinds, spawnWhere } from "../lib/board";
import { SHARED_TILES } from "../lib/board-rules.js";
import { notify } from "../lib/notify";
import { isConsentPath } from "../lib/oauth";
import { expiredPage, page } from "../lib/pages";
import { Ctx, colorInfo, esc, nowIso, seatLimit, sha256Hex, siteUrl, who } from "../lib/util";

const back = (slug: string, notice: string, cookie?: string) => {
  const h = new Headers({ location: `/${slug}/?notice=${notice}`, "cache-control": "no-store" });
  if (cookie) h.append("set-cookie", cookie);
  return new Response(null, { status: 303, headers: h });
};

// A look at the token that does not use it.
export const get = async ({ env, request, data }: Ctx) => {
  const game = data.game!;
  const token = new URL(request.url).searchParams.get("token") || "";
  const t: any = token
    ? await env.DB.prepare(
        "SELECT purpose FROM login_tokens WHERE token_hash = ? AND game_id = ? AND used_at IS NULL AND expires_at > ?",
      ).bind(await sha256Hex(token), game.id, nowIso()).first()
    : null;
  if (!t) return expiredPage(game);
  const heading = t.purpose === "join" ? `Finish joining ${game.name}` : `Log in to ${game.name}`;
  return page(
    heading,
    `<h1>${esc(game.name)}</h1><div class="now">${esc(heading)}. Press Continue to finish.</div>
<form method="POST" action="/${esc(game.slug)}/auth/verify" class="stack" style="margin-top:16px">
  <input type="hidden" name="token" value="${esc(token)}">
  <button class="primary" type="submit">Continue</button>
</form>`,
  );
};

export const post = async (ctx: Ctx) => {
  const { env, request } = ctx;
  const game = ctx.data.game!;
  // CSRF: a cross-site page can make a browser POST here, but cannot make it send our Origin.
  const expected = new URL(siteUrl(env, request)).origin;
  if (request.headers.get("origin") !== expected) {
    return new Response("Forbidden: this form must be submitted from the site itself.", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  let token = "";
  try {
    const form = await request.formData();
    token = String(form.get("token") ?? "");
  } catch {
    return expiredPage(game);
  }
  if (!token) return expiredPage(game);
  const hash = await sha256Hex(token);
  const now = nowIso();

  // Claim the token atomically: two submits cannot both succeed. A token issued for
  // another game does not match, so it is neither spent nor honoured here.
  const t: any = await env.DB.prepare(
    "UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND game_id = ? AND used_at IS NULL AND expires_at > ? RETURNING *",
  ).bind(now, hash, game.id, now).first();
  if (!t) return expiredPage(game);

  // Housekeeping: old tokens and sessions do not need to live forever.
  ctx.waitUntil(
    env.DB.batch([
      env.DB.prepare("DELETE FROM login_tokens WHERE expires_at < ?").bind(nowIso(Date.now() - 24 * 3600 * 1000)),
      env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    ]),
  );

  if (t.purpose === "login") {
    const player: any = await env.DB.prepare("SELECT id FROM players WHERE game_id = ? AND email = ?").bind(game.id, t.email).first();
    if (!player) return expiredPage(game); // decoy token for an address with no seat here
    // A log-in that began at the MCP consent page goes back there (its own page only; checked again here).
    if (t.next && isConsentPath(game.slug, t.next)) {
      return new Response(null, { status: 303, headers: { location: t.next, "cache-control": "no-store", "set-cookie": await createSession(env, game, player.id) } });
    }
    return back(game.slug, "welcome-back", await createSession(env, game, player.id));
  }

  // purpose === "join"
  const color = colorInfo(t.color)?.key;
  if (!color) return back(game.slug, "join-failed");

  const existing: any = await env.DB.prepare("SELECT id FROM players WHERE game_id = ? AND email = ?").bind(game.id, t.email).first();
  if (existing) return back(game.slug, "welcome-back", await createSession(env, game, existing.id));

  // The board has to exist before anyone can be placed on it.
  await ensureTiles(env, game);
  // One statement checks "setup", "not full", picks the next turn_order AND picks the piece's tile: a random
  // charted tile nobody stands on whose whole chart shape is already charted (spawnWhere). Two people verifying
  // at once cannot take the same seat or the same tile, or overfill the game. Spawning charts nothing.
  const playerId = crypto.randomUUID();
  let joined = false;
  try {
    const r = await env.DB.prepare(
      `INSERT INTO players (id, game_id, email, display_name, color, score, turn_order, is_host, joined_at, x, y, z)
       SELECT ?, g.id, ?, ?, ?, 0,
              (SELECT COUNT(*) FROM players WHERE game_id = g.id),
              (SELECT COUNT(*) = 0 FROM players WHERE game_id = g.id), ?, t.x, t.y, t.z
       FROM games g JOIN tiles t ON t.game_id = g.id AND t.z = 0
       WHERE g.id = ? AND g.status = 'setup' AND (SELECT COUNT(*) FROM players WHERE game_id = g.id) < ?
         ${spawnWhere("t")}
       ORDER BY random() LIMIT 1`,
    ).bind(playerId, t.email, t.display_name, color, now, game.id, seatLimit(game), ...spawnBinds(game, SHARED_TILES)).run();
    joined = (r.meta?.changes ?? 0) > 0;
  } catch {
    joined = false; // color taken in the meantime (UNIQUE constraint)
  }
  if (!joined) {
    // A seat that is open but has no qualifying tile to stand on is its own, clearer, failure.
    const free: any = await env.DB.prepare(
      `SELECT 1 AS ok FROM tiles t WHERE t.game_id = ? AND t.z = 0 ${spawnWhere("t")} LIMIT 1`,
    ).bind(game.id, ...spawnBinds(game, SHARED_TILES)).first();
    return back(game.slug, free ? "join-failed" : "no-room");
  }

  const name = t.display_name; // stored raw, escaped when drawn
  await env.DB.prepare("INSERT INTO events (game_id, kind, text, created_at) VALUES (?, 'player_joined', ?, ?)")
    .bind(game.id, `${who(name, color)} took a seat.`, now).run();
  // The seat is already taken: a notification problem must not cost them the session.
  try {
    await notify(env, ctx, game, {
      kind: "player_joined", body: `${who(name, color)} joined the game.`,
      email: true, exceptPlayerId: playerId, baseUrl: siteUrl(env, request),
    });
  } catch (e: any) {
    console.error("notify failed after join:", e?.message || e);
  }
  return back(game.slug, "joined", await createSession(env, game, playerId));
};
