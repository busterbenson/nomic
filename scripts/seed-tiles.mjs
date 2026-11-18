// Prints the SQL that creates one game's tiles (its starting island), from the game's seed and settings.
// Used by create-game.sh:   node scripts/seed-tiles.mjs <game_id> <seed> '<settings json>'
import { tileInsertSql } from "../src/lib/geometry.js";
import { getSettings, validateSettings } from "../src/lib/settings.js";

const [id, seedArg, settingsArg] = process.argv.slice(2);
const seed = Number(seedArg);
let stored = {};
try { stored = JSON.parse(settingsArg || "{}"); } catch { /* reported below */ }
const settings = getSettings(stored);
if (!id || !/^[0-9a-f-]{36}$/.test(id) || !Number.isInteger(seed) || validateSettings(settings).length) {
  console.error("usage: seed-tiles.mjs <game_id uuid> <seed integer> '<settings json>'");
  process.exit(2);
}
console.log(tileInsertSql(id, seed, settings, new Date().toISOString()).join("\n"));
