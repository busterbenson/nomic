import { getPlayer } from "../../../_lib/auth";
import { Ctx, json } from "../../../_lib/util";

export const onRequestGet = async ({ env, request, data }: Ctx) => {
  const game = data.game!;
  const p = await getPlayer(env, request, game);
  if (!p) return json({ error: "Not logged in." }, 401);
  const rows = (
    await env.DB.prepare(
      "SELECT id, kind, body, link, created_at, read_at FROM notifications WHERE game_id = ? AND player_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 50",
    ).bind(game.id, p.id).all()
  ).results;
  const unread = await env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE game_id = ? AND player_id = ? AND read_at IS NULL")
    .bind(game.id, p.id).first();
  return json({ notifications: rows, unread: unread?.n ?? 0 });
};
