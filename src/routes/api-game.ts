// PUBLIC. Never include emails, player ids or the join code.
import { Ctx, colorOf, json, seatLimit } from "../lib/util";

/** @rule 102 */
export const get = async ({ env, data }: Ctx) => {
  const g = data.game!;
  const players = (
    await env.DB.prepare(
      "SELECT display_name AS name, color, shape, score, turn_order, is_host FROM players WHERE game_id = ? ORDER BY turn_order",
    ).bind(g.id).all()
  ).results.map((p: any) => ({ ...p, color: colorOf(p.color), is_host: !!p.is_host }));
  const events = (
    await env.DB.prepare("SELECT kind, text, created_at FROM events WHERE game_id = ? ORDER BY id DESC LIMIT 50")
      .bind(g.id)
      .all()
  ).results;
  // The day and the lock (and what each player has done today) are in /api/day.
  return json({
    game: {
      slug: g.slug,
      name: g.name,
      repo: g.repo,
      status: g.status,
      day: g.day,
      winning_score: g.winning_score,
      max_players: seatLimit(g),
    },
    players,
    events,
  });
};
