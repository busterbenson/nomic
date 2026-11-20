// Run by scripts/bundle-games.mjs in a CHILD process with a scrubbed environment (no tokens, no secrets), because it
// imports the game's own modules and that is code the build must not run with the deploy token in reach.
//   node scripts/check-game.mjs <game dir> [--starter]
// Prints one JSON line: {problems: [...]}. Checks that the modules load, that each file is named for the rule it
// implements, that the hooks assemble (exactly one spawn rule ...), and that RULES.md, settings.json and the modules agree.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { assembleRules, checkRulebook } from "../src/engine/testing.js";

const dir = process.argv[2];
const rulesDir = join(dir, "rules");
const problems = [];
try {
  const rulesMd = readFileSync(join(dir, "RULES.md"), "utf8");
  const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
  const files = readdirSync(rulesDir).filter((f) => /^\d+\.ts$/.test(f)).sort();
  const mods = [];
  for (const f of files) {
    const mod = (await import(pathToFileURL(join(rulesDir, f)).href)).default;
    if (!mod || mod.rule !== Number(f.slice(0, -3))) problems.push(`rules/${f} must default-export defineRule({ rule: ${Number(f.slice(0, -3))}, ... })`);
    else mods.push(mod);
  }
  problems.push(...checkRulebook({ rulesMd, settings, moduleRules: mods.map((m) => m.rule) }));
  try { assembleRules(mods, { label: "rules" }); } catch (e) { problems.push(...(e.problems ?? [String(e.message)])); }
} catch (e) {
  problems.push(`could not load the game: ${e.message}`);
}
console.log(JSON.stringify({ problems }));
