// PUBLIC. Never include emails, player ids or the join code.
import { Ctx, colorInfo, json } from "../lib/util";

export const get = async ({ env, data }: Ctx) => {
  const g = data.game!;
  const players = (
    await env.DB.prepare(
      "SELECT display_name AS name, color, score, turn_order, is_host FROM players WHERE game_id = ? ORDER BY turn_order",
    ).bind(g.id).all()
  ).results.map((p: any) => ({ ...p, color: colorInfo(p.color), is_host: !!p.is_host }));
  const events = (
    await env.DB.prepare("SELECT kind, text, created_at FROM events WHERE game_id = ? ORDER BY id DESC LIMIT 50")
      .bind(g.id)
      .all()
  ).results;
  // Prompts for the current round are public to the table. No emails or ids.
  const turns = (
    await env.DB.prepare(
      `SELECT p.display_name AS name, t.turn_index, t.prompt, t.status, t.created_at
       FROM turns t JOIN players p ON p.game_id = t.game_id AND p.id = t.player_id
       WHERE t.game_id = ? AND t.round = ? AND t.status != 'withdrawn' ORDER BY t.created_at`,
    ).bind(g.id, g.round).all()
  ).results;
  const current = players.find((p: any) => p.turn_order === g.turn);
  const mine = turns.find((t: any) => t.turn_index === g.turn);
  return json({
    turn_status: g.status === "playing" && current ? (mine ? (mine as any).status : "waiting") : null,
    turns,
    game: {
      slug: g.slug,
      name: g.name,
      repo: g.repo,
      status: g.status,
      turn: g.turn,
      round: g.round,
      winning_score: g.winning_score,
      max_players: g.max_players,
      size: g.size,
    },
    players,
    events,
  });
};
