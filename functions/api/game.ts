// PUBLIC. Never include emails, user ids or the join code.
import { Ctx, currentGame, json } from "../_lib/util";

export const onRequestGet = async ({ env }: Ctx) => {
  const g = await currentGame(env);
  if (!g) return json({ game: null }, 404);
  const players = (
    await env.DB.prepare(
      "SELECT u.display_name AS name, p.marker, p.color, p.score, p.turn_order, p.is_host FROM players p JOIN users u ON u.id = p.user_id WHERE p.game_id = ? ORDER BY p.turn_order",
    ).bind(g.id).all()
  ).results.map((p: any) => ({ ...p, is_host: !!p.is_host }));
  const events = (
    await env.DB.prepare("SELECT kind, text, created_at FROM events WHERE game_id = ? ORDER BY id DESC LIMIT 50")
      .bind(g.id)
      .all()
  ).results;
  return json({
    game: {
      name: g.name,
      status: g.status,
      turn: g.turn,
      round: g.round,
      winning_score: g.winning_score,
      max_players: g.max_players,
    },
    players,
    events,
  });
};
