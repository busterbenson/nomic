// Reading and seeding a game's hex board. Tiles are normally created with the game
// (scripts/create-game.sh); a game that predates the board gets them the first time
// anything needs them, from the seed and settings stored on the game, so it is the
// same board either way.
import { tileInsertSql } from "./geometry.js";
import { getSettings } from "./settings.js";
import { Env, nowIso } from "./util";

export async function ensureTiles(env: Env, game: { id: string; settings: string; seed: number }): Promise<void> {
  const row: any = await env.DB.prepare("SELECT COUNT(*) AS n FROM tiles WHERE game_id = ?").bind(game.id).first();
  if (row?.n > 0) return;
  // INSERT OR IGNORE: two requests seeding at once cannot clash.
  await env.DB.batch(tileInsertSql(game.id, game.seed, getSettings(game.settings), nowIso()).map((sql: string) => env.DB.prepare(sql)));
}

export type TileRow = {
  x: number; y: number; terrain: string; name: string | null; description: string | null;
  owner_player_id: string | null; claimed_at: string | null; props: string;
};

export async function loadTiles(env: Env, gameId: string): Promise<TileRow[]> {
  const r = await env.DB.prepare(
    "SELECT x, y, terrain, name, description, owner_player_id, claimed_at, props FROM tiles WHERE game_id = ? ORDER BY x, y",
  ).bind(gameId).all();
  return r.results as TileRow[];
}
