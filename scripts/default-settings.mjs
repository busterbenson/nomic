// Prints a new game's settings as JSON: every default, written out in full so the game's row shows
// exactly what it runs on. Used by create-game.sh:   node scripts/default-settings.mjs [island size]
import { settingsForSize, validateSettings } from "../src/lib/settings.js";

const size = process.argv[2] === undefined ? 8 : Number(process.argv[2]);
const s = settingsForSize(size);
const problems = validateSettings(s);
if (problems.length) { console.error("default-settings: " + problems.join("; ")); process.exit(2); }
console.log(JSON.stringify(s));
