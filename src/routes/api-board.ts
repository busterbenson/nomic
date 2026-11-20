// GET /<slug>/api/board: the charted tiles and the pieces on them. PUBLIC: no emails, no ids.
import { ensureTiles, loadTiles } from "../lib/board";
import { DIAGONAL_MOVES, SHARED_TILES } from "../lib/board-rules.js";
import { tileLabel } from "../lib/geometry.js";
import { getSettings } from "../lib/settings.js";
import { Ctx, colorOf, json } from "../lib/util";

/** @rule 501 */
export const get = async ({ env, data }: Ctx) => {
  const g = data.game!;
  await ensureTiles(env, g);
  const players = (
    await env.DB.prepare("SELECT display_name, color, shape, mirrored, score, turn_order, x, y, z FROM players WHERE game_id = ? ORDER BY turn_order").bind(g.id).all()
  ).results as any[];
  const tiles = await loadTiles(env, g.id);
  const S = getSettings(g.settings);
  return json({
    settings: S, // the board's rules as data: public, like the rules text
    // What a move may be, for the page to offer only legal ones (the server checks them all again).
    rules: { move_distance: S["turn.move_distance"], moves_per_turn: 1, diagonal_moves: DIAGONAL_MOVES, shared_tiles: SHARED_TILES },
    // The day, the lock and what each player has done today are in /api/day.
    game: { slug: g.slug, status: g.status, day: g.day },
    // x, y, z are plain integers; `label` is the compass name ("3N 2E 1U"), which skips zero in all three.
    tiles: tiles.map((t) => ({ x: t.x, y: t.y, z: t.z, label: tileLabel(t.x, t.y, t.z) })),
    pieces: players.map((p) => ({
      name: p.display_name, color: colorOf(p.color), shape: p.shape, mirrored: !!p.mirrored, score: p.score, turn_order: p.turn_order,
      at: { x: p.x, y: p.y, z: p.z, label: tileLabel(p.x, p.y, p.z) },
    })),
  });
};
