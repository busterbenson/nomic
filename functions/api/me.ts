import { getUser } from "../_lib/auth";
import { Ctx, currentGame, json } from "../_lib/util";

export const onRequestGet = async ({ env, request }: Ctx) => {
  const user = await getUser(env, request);
  if (!user) return json({ error: "Not logged in." }, 401);
  const g = await currentGame(env);
  const player = g
    ? await env.DB.prepare(
        "SELECT marker, color, score, turn_order, is_host FROM players WHERE game_id = ? AND user_id = ?",
      ).bind(g.id, user.id).first()
    : null;
  return json({
    user: { email: user.email, name: user.display_name },
    player: player ? { ...player, is_host: !!player.is_host } : null,
  });
};
