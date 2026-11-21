// The text, the settings and the modules of the game agree (the same check the bundler runs on every game).
import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleRules, checkRulebook, loadGame, parseRulesMd } from "promptocracy/engine/testing";

const { rulesMd, settings, files, modules } = await loadGame(import.meta.url);

test("RULES.md, settings.json and the modules agree", () => {
  assert.deepEqual(checkRulebook({ rulesMd, settings, moduleRules: modules.map((m) => m.rule) }), []);
});
test("each module's file name is its rule number", () => {
  assert.deepEqual(files, modules.map((m) => `${m.rule}.ts`));
});
test("the modules assemble: exactly one spawn rule and one order rule", () => {
  const rules = assembleRules(modules);
  assert.deepEqual(rules.implementers("spawnTile"), [505]);
  assert.deepEqual(rules.implementers("applyOrder"), [107]);
  assert.deepEqual(rules.implementers("onEnacted"), [401]);
  assert.deepEqual(rules.implementers("dayEnd"), [402]);
  assert.deepEqual(rules.implementers("championChange"), [402]);
  assert.deepEqual(rules.implementers("actionAllowed"), [202, 504]);
  assert.deepEqual(rules.implementers("actionType"), [901]);
  assert.deepEqual(rules.implementers("applyAction"), [901]);
});
test("the text still has the rules the modules belong to", () => {
  const nums = parseRulesMd(rulesMd).rules.map((r) => r.number);
  for (const n of [107, 202, 401, 402, 504, 505, 704, 901]) assert.ok(nums.includes(n));
});
test("402 is Eras: reaching the number of points wins an Era, ties by night order, points reset, the Champion names the next Era and has one change (the site enforces it)", () => {
  const flat = rulesMd.replace(/\s+/g, " ");
  assert.ok(flat.includes("### 402 Eras"));
  // the number is a proposal's to change (402.1), so the text is pinned without it
  assert.match(flat, /\*\*402\.1\*\* The game is played in Eras\. The first Era starts on day 1\. The first player to reach \d+ points wins the Era, and the Era ends that night\./);
  assert.match(flat, /If several players pass \d+ on the same night, the first one to be given them wins\./);
  assert.ok(flat.includes("When an Era ends, everyone's points go back to 0, and the next Era starts the next day."));
  assert.ok(flat.includes("The Champion names the next Era."));
  assert.ok(flat.includes("It takes effect unless every other player votes against it. Not voting doesn't count as against."));
  assert.ok(flat.includes("**402.4** Once in each Era, the Champion can make one change of their own, on top of their proposals for the day (103.2)."));
  assert.ok(flat.includes("It can change any rule a proposal can change, one with a unanimous mark included."));
  assert.ok(flat.includes("It goes on the next day's ballot, and the player who makes it doesn't vote on it."));
  assert.ok(flat.includes("If there are no other players, it takes effect. A change that is withdrawn or not applied (107.7) doesn't count."));
  assert.ok(!/the game is over|deliberately dull/i.test(flat));
});
test("103, 104 and 105 name the one exception for the Champion's change (402.4), so 108.1 does not set the core rule against it", () => {
  const flat = rulesMd.replace(/\s+/g, " ");
  assert.ok(flat.includes("The Champion's change (402.4) doesn't count toward the limit."));
  assert.ok(flat.includes("Not voting counts as no, except on the Champion's change (402.4)."));
  assert.ok(flat.includes("The player who makes the Champion's change doesn't vote on it (402.4)."));
  assert.ok(flat.includes("The Champion's change is counted by 402.4 instead, here and in 103.4, 105.3 and 105.4."));
});
