// GET /<slug>/api/board: the hex map and the pieces on it. PUBLIC: no emails, no ids.
import { ensureTiles, loadTiles } from "../lib/board";
import { coordLabel } from "../lib/geometry.js";
import { getSettings } from "../lib/settings.js";
import { Ctx, colorOf, json } from "../lib/util";

const parseProps = (s: string) => {
  try { const v = JSON.parse(s); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; }
};

export const get = async ({ env, data }: Ctx) => {
  const g = data.game!;
  await ensureTiles(env, g);
  const players = (
    await env.DB.prepare("SELECT id, display_name, color, score, turn_order FROM players WHERE game_id = ? ORDER BY turn_order").bind(g.id).all()
  ).results as any[];
  const tiles = await loadTiles(env, g.id);
  const byId = new Map(players.map((p) => [p.id, p]));
  // A piece stands on the tile its player claimed most recently.
  const last = new Map<string, any>();
  const counts = new Map<string, number>();
  for (const t of tiles) {
    if (!t.owner_player_id) continue;
    counts.set(t.owner_player_id, (counts.get(t.owner_player_id) ?? 0) + 1);
    const prev = last.get(t.owner_player_id);
    if (!prev || String(t.claimed_at) > String(prev.claimed_at)) last.set(t.owner_player_id, t);
  }
  return json({
    // The starting island occupies x 0..width-1, y 0..height-1 on an endless grid; only land has a row.
    settings: getSettings(g.settings), // the board's rules as data: public, like the rules text
    width: getSettings(g.settings)["board.island"].width, height: getSettings(g.settings)["board.island"].height,
    game: { slug: g.slug, status: g.status, turn: g.turn, round: g.round },
    tiles: tiles.map((t) => {
      const o = t.owner_player_id ? byId.get(t.owner_player_id) : null;
      return {
        x: t.x, y: t.y, label: coordLabel(t.x, t.y), terrain: t.terrain, name: t.name, description: t.description,
        owner: o ? { name: o.display_name, color: colorOf(o.color) } : null,
        props: parseProps(t.props),
      };
    }),
    pieces: players.map((p) => ({
      name: p.display_name, color: colorOf(p.color), score: p.score, turn_order: p.turn_order,
      tiles: counts.get(p.id) ?? 0,
      at: last.has(p.id) ? { x: last.get(p.id).x, y: last.get(p.id).y, label: coordLabel(last.get(p.id).x, last.get(p.id).y) } : null,
    })),
  });
};
