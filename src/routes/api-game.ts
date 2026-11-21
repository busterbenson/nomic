// PUBLIC. Never include emails, player ids or the join code.
import { getPlayer } from "../lib/auth";
import { eraView } from "../lib/eras";
import { Ctx, colorOf, json, seatLimit } from "../lib/util";

/** @rule 102, 402.1 */
export const get = async ({ env, data, request }: Ctx) => {
  const g = data.game!;
  const viewer = await getPlayer(env, request, g);
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
    era: await eraView(env, g.id, viewer?.id),
    players,
    events,
  });
};
