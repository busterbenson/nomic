// The magic link lands here. The token is hashed, single use, and expires after
// 15 minutes. A join is only completed now, by whoever controls the inbox.
import { createSession } from "../_lib/auth";
import { notify } from "../_lib/notify";
import { Ctx, MARKERS, nowIso, sha256Hex, siteUrl } from "../_lib/util";

const back = (notice: string, cookie?: string) => {
  const h = new Headers({ location: `/?notice=${notice}`, "cache-control": "no-store" });
  if (cookie) h.append("set-cookie", cookie);
  return new Response(null, { status: 303, headers: h });
};

export const onRequestGet = async (ctx: Ctx) => {
  const { env, request } = ctx;
  const token = new URL(request.url).searchParams.get("token") || "";
  const hash = await sha256Hex(token);
  const now = nowIso();

  // Claim the token atomically: two clicks cannot both succeed.
  const t: any = await env.DB.prepare(
    "UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING *",
  ).bind(now, hash, now).first();
  if (!t) return back("link-invalid");

  // Housekeeping: old tokens and sessions do not need to live forever.
  ctx.waitUntil(
    env.DB.batch([
      env.DB.prepare("DELETE FROM login_tokens WHERE expires_at < ?").bind(nowIso(Date.now() - 24 * 3600 * 1000)),
      env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    ]),
  );

  if (t.purpose === "login") {
    const user: any = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(t.email).first();
    if (!user) return back("link-invalid");
    return back("welcome-back", await createSession(env, user.id));
  }

  // purpose === "join"
  const game: any = await env.DB.prepare("SELECT * FROM games WHERE id = ?").bind(t.game_id).first();
  const color = MARKERS.find((m) => m.marker === t.marker)?.color;
  if (!game || !color) return back("join-failed");

  await env.DB.prepare("INSERT OR IGNORE INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), t.email, t.display_name, now).run();
  const user: any = await env.DB.prepare("SELECT id, display_name FROM users WHERE email = ?").bind(t.email).first();

  const existing = await env.DB.prepare("SELECT 1 AS x FROM players WHERE game_id = ? AND user_id = ?").bind(game.id, user.id).first();
  if (existing) return back("welcome-back", await createSession(env, user.id));

  // One statement checks "setup", "not full" and picks the next turn_order, so
  // two people verifying at once cannot take the same seat or overfill the game.
  let joined = false;
  try {
    const r = await env.DB.prepare(
      `INSERT INTO players (game_id, user_id, marker, color, score, turn_order, is_host, joined_at)
       SELECT g.id, ?, ?, ?, 0,
              (SELECT COUNT(*) FROM players WHERE game_id = g.id),
              (SELECT COUNT(*) = 0 FROM players WHERE game_id = g.id), ?
       FROM games g
       WHERE g.id = ? AND g.status = 'setup' AND (SELECT COUNT(*) FROM players WHERE game_id = g.id) < g.max_players`,
    ).bind(user.id, t.marker, color, now, game.id).run();
    joined = (r.meta?.changes ?? 0) > 0;
  } catch {
    joined = false; // marker taken in the meantime (UNIQUE constraint)
  }
  if (!joined) return back("join-failed");

  const name = user.display_name; // stored raw, escaped when drawn
  await env.DB.prepare("INSERT INTO events (game_id, kind, text, created_at) VALUES (?, 'player_joined', ?, ?)")
    .bind(game.id, `${t.marker} ${name} took a seat.`, now).run();
  // The seat is already taken: a notification problem must not cost them the session.
  try {
    await notify(env, ctx, game.id, {
      kind: "player_joined", body: `${t.marker} ${name} joined the game.`, link: "/",
      email: true, exceptUserId: user.id, baseUrl: siteUrl(env, request),
    });
  } catch (e: any) {
    console.error("notify failed after join:", e?.message || e);
  }
  return back("joined", await createSession(env, user.id));
};
