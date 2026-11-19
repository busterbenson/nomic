// GET / : the front page and the list of games. Public. Names, status, seats and the seated players' colors only:
// no emails, no join codes.
import { SITE_NAME, page } from "../lib/pages";
import { Ctx, colorOf, esc } from "../lib/util";

const STATUS: Record<string, string> = { setup: "Setting up", playing: "In play", over: "Finished" };
// A tile, small, for the game cards.
const TILE = `<svg viewBox="-30 -22 60 50" width="56" aria-hidden="true"><polygon points="-28,0 0,18 0,27 -28,9" style="fill:var(--ink)"/><polygon points="0,18 28,0 28,9 0,27" style="fill:var(--ink-muted)"/><polygon points="-28,0 0,-18 28,0 0,18" style="fill:var(--land);stroke:var(--outline);stroke-width:1.5;stroke-linejoin:round"/></svg>`;

export const get = async ({ env }: Ctx) => {
  const games = (
    await env.DB.prepare(
      `SELECT g.slug, g.name, g.status, COALESCE(json_extract(g.settings, '$.max_players'), 8) AS max_players,
              (SELECT COUNT(*) FROM players p WHERE p.game_id = g.id) AS players,
              (SELECT group_concat(color, ',') FROM (SELECT color FROM players p WHERE p.game_id = g.id ORDER BY turn_order)) AS colors
       FROM games g ORDER BY g.created_at DESC, g.rowid DESC`,
    ).all()
  ).results as { slug: string; name: string; status: string; max_players: number; players: number; colors: string | null }[];
  const cards = games
    .map((g) => {
      const seated = (g.colors ? g.colors.split(",") : []).map((k) => `<span class="dot" style="background:${esc(colorOf(k).hex)}" title="${esc(colorOf(k).name)}"></span>`);
      const open = Array.from({ length: Math.max(0, g.max_players - g.players) }, () => `<span class="dot open"></span>`);
      return `<li><a class="gcard" href="/${esc(g.slug)}/"><span class="gtile">${TILE}</span><span class="gtext"><span class="gname">${esc(g.name)}</span>
<span class="gmeta"><span>/${esc(g.slug)}</span><span>${g.players} of ${g.max_players} seats</span><span>${esc(STATUS[g.status] ?? g.status)}</span></span>
<span class="gseats" aria-hidden="true">${seated.join("")}${open.join("")}</span></span><span class="go">Open the game →</span></a></li>`;
    })
    .join("");
  return page(
    SITE_NAME,
    `<section class="hero"><div><p class="eyebrow">After Peter Suber's Nomic, 1982</p><h1>A game of <span class="nb">self-amendment</span></h1></div>
<svg class="hero-board" id="hero-board" viewBox="0 0 600 340" aria-hidden="true"></svg></section>
<section class="games-sec"><h2>Games on promptocracy.us</h2>${games.length ? `<ul class="games">${cards}</ul>` : ""}</section>
<script type="module" src="/js/landing.js"></script>`,
    200,
    { wide: true },
  );
};
