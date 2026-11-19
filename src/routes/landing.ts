// GET / : the list of games. Public. Names, status and player counts only: no
// emails, no join codes.
import { SITE_NAME, page } from "../lib/pages";
import { Ctx, esc } from "../lib/util";

const STATUS: Record<string, string> = { setup: "Setting up", playing: "In play", over: "Finished" };

export const get = async ({ env }: Ctx) => {
  const games = (
    await env.DB.prepare(
      `SELECT g.slug, g.name, g.status, COALESCE(json_extract(g.settings, '$.max_players'), 8) AS max_players,
              (SELECT COUNT(*) FROM players p WHERE p.game_id = g.id) AS players
       FROM games g ORDER BY g.created_at DESC, g.rowid DESC`,
    ).all()
  ).results as { slug: string; name: string; status: string; max_players: number; players: number }[];
  const items = games.length
    ? `<ul class="games">${games
        .map(
          (g) => `<li><a href="/${esc(g.slug)}/"><strong>${esc(g.name)}</strong></a>
<span class="sub">${esc(STATUS[g.status] ?? g.status)} · ${g.players} of ${g.max_players} players</span></li>`,
        )
        .join("")}</ul>`
    : `<p class="sub">No games yet.</p>`;
  return page(
    SITE_NAME,
    `<h1>${SITE_NAME}</h1><p class="sub">Games where changing the rules is a move. Each game has its own players and its own rules, kept in its own repo.</p>
<h2>Games</h2>${items}
<footer>Joining takes a join code: ask whoever invited you for the link.</footer>`,
  );
};
