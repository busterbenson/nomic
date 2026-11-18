// Prints the SQL that creates one game's tiles (its starting island). Used by create-game.sh:
//   node scripts/seed-tiles.mjs <game_id> <size> <seed>
import { tileInsertSql, validSize } from "../src/lib/geometry.js";

const [id, sizeArg, seedArg] = process.argv.slice(2);
const size = Number(sizeArg), seed = Number(seedArg);
if (!id || !/^[0-9a-f-]{36}$/.test(id) || !validSize(size) || !Number.isInteger(seed)) {
  console.error("usage: seed-tiles.mjs <game_id uuid> <size 4-16> <seed integer>");
  process.exit(2);
}
console.log(tileInsertSql(id, size, seed, new Date().toISOString()).join("\n"));
