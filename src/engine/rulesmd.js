// RULES.md, read for the checks the engine cares about: which rules exist and which settings the text names.
// (public/js/rulebook.js draws the rulebook; this only checks that text, settings and modules agree.)
// Format: "## 100. Title [unanimous]" is a block, "### 101 Title" a rule, "[setting: board.island]" names a setting.
import { validateSettings } from "../lib/settings.js";

/** @rule 101 */
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, "");

/** @rule 101 */
export function parseRulesMd(text) {
  const t = stripComments(String(text ?? ""));
  const rules = [...t.matchAll(/^###\s+(\d+)\s+(.+?)\s*$/gm)].map((m) => ({ number: Number(m[1]), title: m[2] }));
  const tags = [...t.matchAll(/\[setting:\s*([A-Za-z0-9_.]+)\s*\]/g)].map((m) => m[1]);
  return { rules, settingTags: [...new Set(tags)] };
}

// Problems (an empty list is fine) with a game's text, settings.json and rule modules taken together:
//   - RULES.md has at least one rule and no rule number twice
//   - the [setting: x] tags in the text are exactly the keys of settings.json, and settings.json is a complete valid set
//   - every rule module's number is a rule that exists in the text
/** @rule 101 */
export function checkRulebook({ rulesMd, settings, moduleRules }) {
  const out = [];
  const { rules, settingTags } = parseRulesMd(rulesMd);
  if (!rules.length) out.push("RULES.md has no rules (### 101 Title)");
  const seen = new Set();
  for (const r of rules) { if (seen.has(r.number)) out.push(`RULES.md numbers rule ${r.number} twice`); seen.add(r.number); }
  const keys = Object.keys(settings ?? {});
  for (const k of settingTags) if (!keys.includes(k)) out.push(`RULES.md names [setting: ${k}] but settings.json has no ${k}`);
  for (const k of keys) if (!settingTags.includes(k)) out.push(`settings.json has ${k} but no rule in RULES.md names it as [setting: ${k}]`);
  out.push(...validateSettings(settings).map((p) => `settings.json: ${p}`));
  for (const n of moduleRules ?? []) if (!seen.has(n)) out.push(`rules/${n}.ts is a module for rule ${n}, which RULES.md does not have`);
  return out;
}
