// POST /api/turn {prompt}: the player whose turn it is submits their prompt.
// This only RECORDS the turn. It does not advance games.turn: that happens when
// the referee and the vote are built.
import { getUser } from "../_lib/auth";
import { notify } from "../_lib/notify";
import { Ctx, currentGame, json, nowIso, readJson, siteUrl } from "../_lib/util";

export const onRequestPost = async (ctx: Ctx) => {
  const { env, request } = ctx;
  const user = await getUser(env, request);
  if (!user) return json({ error: "Log in to play a turn." }, 401);
  const body = await readJson(request);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt || [...prompt].length > 2000) return json({ error: "Your prompt needs 1 to 2000 characters." }, 400);

  const game = await currentGame(env);
  if (!game) return json({ error: "There is no game yet." }, 404);
  if (game.status !== "playing") return json({ error: "The game has not started, so there are no turns yet." }, 409);
  const player: any = await env.DB.prepare("SELECT marker, turn_order FROM players WHERE game_id = ? AND user_id = ?")
    .bind(game.id, user.id).first();
  if (!player) return json({ error: "You are not a player in this game." }, 403);
  if (player.turn_order !== game.turn) return json({ error: "It is not your turn." }, 403);

  const now = nowIso();
  try {
    await env.DB.prepare(
      "INSERT INTO turns (id, game_id, user_id, round, turn_index, prompt, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?, ?)",
    ).bind(crypto.randomUUID(), game.id, user.id, game.round, game.turn, prompt, now, now).run();
  } catch {
    return json({ error: "You already took your turn this round." }, 409);
  }
  const name = user.display_name;
  await env.DB.prepare("INSERT INTO events (game_id, kind, text, created_at) VALUES (?, 'turn_submitted', ?, ?)")
    .bind(game.id, `${player.marker} ${name} took their turn.`, now).run();
  try {
    await notify(env, ctx, game.id, {
      kind: "turn_submitted", body: `${player.marker} ${name} took their turn.`, link: "/",
      email: true, exceptUserId: user.id, baseUrl: siteUrl(env, request),
    });
  } catch (e: any) {
    console.error("notify failed after turn:", e?.message || e);
  }
  return json({ ok: true, status: "submitted", message: "Turn recorded. Waiting for the referee." });
};
