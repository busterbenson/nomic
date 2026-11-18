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
  // Prompts for the current round are public to the table. No emails or ids.
  const turns = (
    await env.DB.prepare(
      `SELECT u.display_name AS name, p.marker, t.turn_index, t.prompt, t.status, t.created_at
       FROM turns t JOIN users u ON u.id = t.user_id
       JOIN players p ON p.game_id = t.game_id AND p.user_id = t.user_id
       WHERE t.game_id = ? AND t.round = ? AND t.status != 'withdrawn' ORDER BY t.created_at`,
    ).bind(g.id, g.round).all()
  ).results;
  const current = players.find((p: any) => p.turn_order === g.turn);
  const mine = turns.find((t: any) => t.turn_index === g.turn);
  return json({
    turn_status: g.status === "playing" && current ? (mine ? (mine as any).status : "waiting") : null,
    turns,
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
