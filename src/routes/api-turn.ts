// POST /<slug>/api/turn {prompt}: the player whose turn it is submits their prompt.
// This only RECORDS the turn. It does not advance games.turn: that happens when
// the referee and the vote are built.
import { getPlayer } from "../lib/auth";
import { notify } from "../lib/notify";
import { Ctx, json, nowIso, readJson, siteUrl, who } from "../lib/util";

export const post = async (ctx: Ctx) => {
  const { env, request } = ctx;
  const game = ctx.data.game!;
  const player = await getPlayer(env, request, game);
  if (!player) return json({ error: "Log in to play a turn." }, 401);
  const body = await readJson(request);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt || [...prompt].length > 2000) return json({ error: "Your prompt needs 1 to 2000 characters." }, 400);

  if (game.status !== "playing") return json({ error: "The game has not started, so there are no turns yet." }, 409);
  if (player.turn_order !== game.turn) return json({ error: "It is not your turn." }, 403);
  if (game.moves > 0) return json({ error: "You already moved on the board this turn." }, 409);

  const now = nowIso();
  const name = player.display_name;
  // The turn and its log line land together or not at all.
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO turns (id, game_id, player_id, round, turn_index, prompt, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?, ?)",
      ).bind(crypto.randomUUID(), game.id, player.id, game.round, game.turn, prompt, now, now),
      env.DB.prepare("INSERT INTO events (game_id, kind, text, created_at) VALUES (?, 'turn_submitted', ?, ?)")
        .bind(game.id, `${who(name, player.color)} took their turn.`, now),
    ]);
  } catch (e: any) {
    // Only the one-live-turn-per-round index means "already took it"; anything else is a real failure.
    if (/UNIQUE constraint failed/i.test(String(e?.message || e) + String(e?.cause?.message || ""))) {
      return json({ error: "You already took your turn this round." }, 409);
    }
    console.error("turn insert failed:", e?.message || e);
    return json({ error: "Could not record your turn. Try again." }, 500);
  }
  try {
    await notify(env, ctx, game, {
      kind: "turn_submitted", body: `${who(name, player.color)} took their turn.`,
      email: true, exceptPlayerId: player.id, baseUrl: siteUrl(env, request),
    });
  } catch (e: any) {
    console.error("notify failed after turn:", e?.message || e);
  }
  return json({ ok: true, status: "submitted", message: "Turn recorded. Waiting for Chalant (the referee)." });
};
