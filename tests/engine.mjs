// The rule-module engine and the game bundler, no server and no network. Run: node tests/engine.mjs
// Covers hook composition, effect validation, the module lint, RULES.md/settings/module agreement, the starter
// pack's own tests, and scripts/bundle-games.mjs (fixtures, a local git remote with day-N tags, failure cases,
// and that game code runs with a scrubbed environment).
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pjoin } from "node:path";
import { ROOT } from "./lib.mjs";
import { ACTION_KINDS, HOOKS, RuleError, RuleSetError, assembleRules, deepFreeze, defineRule, makeContext, makeTiles, refuse, seededRng, validateEffect } from "../src/engine/hooks.js";
import { lintModule } from "../src/engine/lint.js";
import { checkRulebook, parseRulesMd } from "../src/engine/rulesmd.js";
import { DEFAULT_SETTINGS, validateSettings } from "../src/lib/settings.js";
import { BundleError, bundleGames, latestDayTag } from "../scripts/bundle-games.mjs";
import * as api from "../src/engine/api.js";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name}${detail ? "  -> " + detail : ""}`); }
};
const J = JSON.stringify;
const throws = (f) => { try { f(); return null; } catch (e) { return e; } };
const ctx = makeContext({ now: "t", settings: DEFAULT_SETTINGS, players: [{ ref: "a", x: 0, y: 0 }], tiles: makeTiles([{ x: 0, y: 0, z: 0 }]), rng: seededRng("k") });
const A = { ref: "a" };

console.log("hook composition");
const m = (rule, hooks) => defineRule({ rule, ...hooks });
const one = m(505, { spawnTile: (c, cand) => cand[0] ?? null });
check("actionAllowed: modules run in RULE order, not list order, and the first refusal wins", (() => {
  const calls = [];
  const r = assembleRules([
    m(504, { actionAllowed: () => { calls.push(504); return refuse("late", 409); } }),
    m(202, { actionAllowed: () => { calls.push(202); return refuse("early", 403); } }),
    one,
  ]).actionAllowed(ctx, A, { kind: "move" });
  return J(calls) === "[202]" && r.error === "early" && r.status === 403 && r.rule === 202;
})());
check("actionAllowed: a null (or undefined) from every module is null; a refusal defaults to status 400", (() => {
  const rs = assembleRules([m(202, { actionAllowed: () => null }), m(204, { actionAllowed: () => undefined }), one]);
  const rs2 = assembleRules([m(202, { actionAllowed: () => ({ error: "no" }) }), one]);
  return rs.actionAllowed(ctx, A, { kind: "move" }) === null && rs2.actionAllowed(ctx, A, { kind: "move" }).status === 400;
})());
check("actionAllowed: a malformed answer (a string, a bad status) is a RuleError naming the rule, never a quiet pass", (() => {
  const bad = (v) => throws(() => assembleRules([m(202, { actionAllowed: () => v }), one]).actionAllowed(ctx, A, { kind: "move" }));
  const e = bad("nope");
  return e instanceof RuleError && e.rule === 202 && bad({ error: "x", status: 200 }) instanceof RuleError && bad({ error: "" }) instanceof RuleError;
})());
check("a module that throws becomes a RuleError with its rule and hook", (() => {
  const e = throws(() => assembleRules([m(202, { actionAllowed: () => { throw new Error("boom"); } }), one]).actionAllowed(ctx, A, { kind: "move" }));
  return e instanceof RuleError && e.rule === 202 && e.hook === "actionAllowed" && /boom/.test(e.message);
})());
check("afterAction: effects of every module are joined in rule order", (() => {
  const rs = assembleRules([
    m(504, { afterAction: () => [api.effects.chart([{ x: 1, y: 1 }])] }),
    m(402, { afterAction: () => [api.effects.points("a", 10, "why")] }),
    one,
  ]);
  const out = rs.afterAction(ctx, A, { kind: "move" });
  return out.length === 2 && out[0].type === "points" && out[1].type === "chart" && out[1].tiles[0].z === 0;
})());
check("afterAction: an invalid effect from a module is a RuleError", throws(() => assembleRules([m(504, { afterAction: () => [{ type: "chart", tiles: [{ x: 0.5, y: 0 }] }] }), one]).afterAction(ctx, A, { kind: "move" })) instanceof RuleError);
check("afterAction: no implementers is an empty list", J(assembleRules([one]).afterAction(ctx, A, { kind: "move" })) === "[]");
check("spawnTile: exactly one module; zero or two fail when the rules are assembled, naming the hook", (() => {
  const none = throws(() => assembleRules([m(202, {})]));
  const two = throws(() => assembleRules([one, m(506, { spawnTile: () => null })]));
  return none instanceof RuleSetError && /spawnTile needs exactly one rule to implement it, found 0/.test(none.message) &&
    two instanceof RuleSetError && /found 2 \(505, 506\)/.test(two.message);
})());
check("spawnTile: returns one of the candidates (a copy), null for no room, and refuses a tile that is not a candidate", (() => {
  const cand = [{ x: 1, y: 2, z: 0 }, { x: 3, y: 4, z: 0 }];
  const ok = assembleRules([m(505, { spawnTile: (c, cs) => cs[1] })]).spawnTile(ctx, cand);
  const none = assembleRules([m(505, { spawnTile: () => null })]).spawnTile(ctx, cand);
  const off = throws(() => assembleRules([m(505, { spawnTile: () => ({ x: 9, y: 9, z: 0 }) })]).spawnTile(ctx, cand));
  return J(ok) === '{"x":3,"y":4,"z":0}' && none === null && off instanceof RuleError;
})());
check("hooks not wired yet (voteMark, tally ...) are accepted, never called, and need no implementer yet", (() => {
  let called = false;
  const rs = assembleRules([m(202, { tally: () => { called = true; }, dayEnd: () => [] }), one]);
  rs.actionAllowed(ctx, A, { kind: "move" }); rs.afterAction(ctx, A, { kind: "move" });
  return !called && Object.values(HOOKS).filter((h) => !h.wired).length === 6;
})());
check("a bad module is refused: unknown hook, non-function hook, rule number missing or out of range, the same rule twice", (() => {
  const p = (mods) => throws(() => assembleRules(mods))?.problems ?? [];
  return p([{ rule: 202, dance: () => 1 }, one]).some((x) => /unknown hook dance/.test(x)) &&
    p([{ rule: 202, actionAllowed: "yes" }, one]).some((x) => /must be a function/.test(x)) &&
    p([{ actionAllowed: () => null }, one]).some((x) => /whole number from 100/.test(x)) &&
    p([{ rule: 5, actionAllowed: () => null }, one]).length > 0 &&
    p([m(202, {}), m(202, {}), one]).some((x) => /two modules/.test(x)) &&
    throws(() => defineRule({ rule: 202, nope: () => 1 })) instanceof RuleSetError;
})());
check("ctx is deep-frozen plain data: a hook cannot change the players, the settings or the turn", (() => {
  const c = makeContext({ now: "t", settings: structuredClone(DEFAULT_SETTINGS), players: [{ ref: "a", x: 0, y: 0 }] });
  return Object.isFrozen(c) && Object.isFrozen(c.players) && Object.isFrozen(c.players[0]) && Object.isFrozen(c.settings["board.island"]) && Object.isFrozen(c.turn) &&
    throws(() => { "use strict"; c.players[0].x = 5; }) instanceof TypeError && throws(() => { "use strict"; c.settings.max_players = 1; }) instanceof TypeError;
})());
check("ctx.tiles answers has/get/list, with z defaulting to the ground; ctx.rng is a float in [0,1)", (() => {
  const t = makeTiles([{ x: 1, y: 2, z: 0 }, { x: 3, y: 4, z: 1 }]);
  const r = seededRng("s");
  const vals = Array.from({ length: 1000 }, () => r());
  return t.has(1, 2) && !t.has(1, 2, 1) && t.has(3, 4, 1) && t.get(3, 4, 1).z === 1 && t.list().length === 2 && vals.every((v) => v >= 0 && v < 1) && new Set(vals).size > 990;
})());
check("seededRng: same seed, same numbers; different seed, different numbers", (() => {
  const a = seededRng("g:1"), b = seededRng("g:1"), c = seededRng("g:2");
  const x = [a(), a(), a()], y = [b(), b(), b()], z = [c(), c(), c()];
  return J(x) === J(y) && J(x) !== J(z);
})());
check("the action kinds are move, propose, vote, end_turn; and deepFreeze is idempotent", J(ACTION_KINDS) === '["move","propose","vote","end_turn"]' && deepFreeze(deepFreeze({ a: { b: 1 } })).a.b === 1);

console.log("effects");
check("a chart effect needs integer tiles inside the world, at most 500", validateEffect({ type: "chart", tiles: [{ x: 1, y: 2, z: 0 }] }) === null && validateEffect({ type: "chart", tiles: [{ x: 1.5, y: 0 }] }) !== null && validateEffect({ type: "chart", tiles: [{ x: 2e6, y: 0 }] }) !== null && validateEffect({ type: "chart", tiles: Array.from({ length: 501 }, () => ({ x: 0, y: 0 })) }) !== null && validateEffect({ type: "chart" }) !== null);
check("points, log and win effects have their own shapes; an unknown type fails", validateEffect({ type: "points", player: "a", delta: 10, reason: "r" }) === null && validateEffect({ type: "points", player: "a", delta: 1.5, reason: "r" }) !== null && validateEffect({ type: "log", template: "t", args: {} }) === null && validateEffect({ type: "log", template: "t", args: [] }) !== null && validateEffect({ type: "win", player: "a", reason: "r" }) === null && validateEffect({ type: "spawn" }) !== null && validateEffect(null) !== null);

console.log("the engine API a game imports");
check("promptocracy/engine exports exactly the promised names", J(Object.keys(api).sort()) === J(["ACTION_KINDS", "DIAGONAL_MOVES", "ENGINE_VERSION", "HOOKS", "SHARED_TILES", "chartOffsets", "chartedAround", "defineRule", "effects", "refuse", "tileLabel", "validCoord", "withinSteps"]), J(Object.keys(api).sort()));
check("package.json exports ./engine (+ types) and ./engine/testing, nothing else of src", (() => {
  const e = JSON.parse(readFileSync(pjoin(ROOT, "package.json"), "utf8")).exports;
  return e["./engine"].default === "./src/engine/api.js" && e["./engine"].types === "./src/engine/api.d.ts" && e["./engine/testing"] === "./src/engine/testing.js" && Object.keys(e).length === 3;
})());
check("a module resolves promptocracy/engine through the package's own name (what a game's tests do)", (await import("promptocracy/engine")).defineRule === defineRule);
check("wrangler.toml aliases promptocracy/engine to the same file and runs the bundler as the build", (() => {
  const t = readFileSync(pjoin(ROOT, "wrangler.toml"), "utf8");
  return /\[build\]\s*\ncommand = "node scripts\/bundle-games\.mjs"/.test(t) && /\[alias\]\s*\n"promptocracy\/engine" = "\.\/src\/engine\/api\.js"/.test(t);
})());

console.log("the module lint");
const L = (src) => lintModule(src, "m");
const GOOD = `import { defineRule, refuse } from "promptocracy/engine";\nexport default defineRule({ rule: 202, actionAllowed(ctx) { return ctx.turn.moved ? refuse("no") : null; } });`;
check("a module that imports only promptocracy/engine passes (single or double quotes, several lines)", L(GOOD).length === 0 && L(`import {\n  defineRule,\n  refuse,\n} from 'promptocracy/engine'\n`).length === 0);
check("the starter pack and the fixture game pass the lint", ["templates/rules/202.ts", "templates/rules/504.ts", "templates/rules/505.ts", "tests/fixtures/games/bundled/rules/202.ts"].every((f) => L(readFileSync(pjoin(ROOT, f), "utf8")).length === 0));
check("fetch is refused, as a call, as a bare name and in a template expression", L(`export default { rule: 1, a() { return fetch("https://x"); } }`).length > 0 && L("const a = `${fetch}`").length > 0);
for (const bad of ["globalThis", "self", "window", "eval", "Function", "process", "env", "caches", "require", "crypto", "constructor", "__proto__", "Reflect", "Proxy", "XMLHttpRequest", "WebSocket", "WebAssembly", "setTimeout", "setInterval", "prototype"]) {
  check(`${bad} is refused`, L(`const x = ${bad};`).some((p) => p.includes(`"${bad}"`)), J(L(`const x = ${bad};`)));
}
check("an import of anything else is refused: node:fs, a relative file, a package, a url", ["node:fs", "./helper.ts", "zod", "https://evil.example/x.js", "promptocracy/engine/testing", "promptocracy"].every((s) => L(`import x from "${s}";`).length > 0));
check("a type-only import, a re-export and export * from another module are refused too", L(`import type { T } from "zod";`).length > 0 && L(`export { a } from "./a.ts";`).length > 0 && L(`export * from "./a.ts";`).length > 0);
check("dynamic import(), import.meta and a bare import are refused", L(`await import("node:fs");`).length > 0 && L(`const u = import.meta.url;`).length > 0 && L(`import "node:fs";`).length > 0 && L(`await import ('x')`).length > 0);
check("the scan reads raw text: a banned word hidden in a comment or after a regex literal with a quote is still caught", L(`// fetch\nconst a = 1;`).length > 0 && L(`const r = /'/; fetch(u); const s = '';`).length > 0);
check("a word that merely contains a banned one (environment, fetched, selfie, processing, newFunction) is fine", L(`const environment = 1, fetched = 2, selfie = 3, processing = 4, newFunction = 5; const s = "Chalant is processing";`).length === 0);
check("a lint problem names the line", L(`\n\nfetch(1)`)[0].includes("line 3"));

console.log("RULES.md, settings and modules agree");
const R = "# Rules\n\n## 100. A [majority]\n\n### 101 One\nText [setting: max_players]\n\n### 102 Two\nMore.\n<!-- ### 999 Hidden [setting: nope] -->\n";
check("parseRulesMd reads rules and setting tags, ignoring HTML comments", J(parseRulesMd(R)) === J({ rules: [{ number: 101, title: "One" }, { number: 102, title: "Two" }], settingTags: ["max_players"] }), J(parseRulesMd(R)));
check("the starter RULES.md, settings.json and modules agree", checkRulebook({ rulesMd: readFileSync(pjoin(ROOT, "templates/RULES.md"), "utf8"), settings: JSON.parse(readFileSync(pjoin(ROOT, "templates/settings.json"), "utf8")), moduleRules: [202, 504, 505] }).length === 0);
check("templates/settings.json is exactly the default settings, and valid", J(JSON.parse(readFileSync(pjoin(ROOT, "templates/settings.json"), "utf8"))) === J(DEFAULT_SETTINGS) && validateSettings(DEFAULT_SETTINGS).length === 0);
check("a [setting] with no key, a key with no [setting], a module for a missing rule, a repeated rule number and an empty rulebook are all reported", (() => {
  const s = { ...DEFAULT_SETTINGS };
  const out = checkRulebook({ rulesMd: R, settings: s, moduleRules: [101, 777] });
  const dup = checkRulebook({ rulesMd: R + "\n### 101 Again\nx\n", settings: s, moduleRules: [] });
  const none = checkRulebook({ rulesMd: "nothing", settings: s, moduleRules: [] });
  return out.some((p) => /rules\/777\.ts is a module for rule 777/.test(p)) && out.some((p) => /settings\.json has board\.island but no rule/.test(p)) &&
    checkRulebook({ rulesMd: R.replace("max_players", "board.nope"), settings: s, moduleRules: [] }).some((p) => /names \[setting: board\.nope\] but settings\.json has no/.test(p)) &&
    dup.some((p) => /numbers rule 101 twice/.test(p)) && none.some((p) => /has no rules/.test(p));
})());

console.log("the starter pack's own tests");
{
  const out = execFileSync(process.execPath, ["--test", ...["202", "504", "505", "rulebook"].map((n) => `templates/rules/${n}.test.ts`)], { cwd: ROOT, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  const n = (k) => Number((new RegExp(`# ${k} (\\d+)`).exec(out) ?? [])[1]);
  check("node --test templates/rules: every test passes", n("fail") === 0 && n("pass") >= 22, `pass ${n("pass")} fail ${n("fail")}`);
}

console.log("the bundler");
const work = mkdtempSync(pjoin(tmpdir(), "engine-test-"));
const FIX = pjoin(ROOT, "tests/fixtures/games/bundled");
const bundle = (env) => { try { bundleGames({ BUNDLE_OUT: pjoin(work, "out-" + Math.random().toString(36).slice(2)), ...env }); return null; } catch (e) { return e; } };
const quiet = (f) => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };
let seq = 0;
const tree = (name, mutate) => { const src = pjoin(work, `src-${name}-${seq++}`); cpSync(FIX, pjoin(src, name), { recursive: true }); mutate?.(pjoin(src, name)); return src; };
const put = (dir, rel, text) => { mkdirSync(pjoin(dir, rel, ".."), { recursive: true }); writeFileSync(pjoin(dir, rel), text); };

{
  const out = pjoin(work, "out-ok");
  const e = quiet(() => bundle({ BUNDLE_OUT: out, GAMES_SOURCE: "tests/fixtures/games" }));
  const gen = existsSync(pjoin(out, "games.ts")) ? readFileSync(pjoin(out, "games.ts"), "utf8") : "";
  check("the fixture game bundles: its tests run and pass, and games.ts holds its text, settings and modules plus the starter pack", e === null && /"bundled": \{ slug: "bundled"/.test(gen) && /export const STARTER/.test(gen) && /modules: \[m0, m1, m2\]/.test(gen) && /fixture game/.test(gen), String(e));
  check("the game's modules are copied next to games.ts, where the Worker bundler follows the imports", ["games/bundled/rules/202.ts", "games/bundled/rules/504.ts", "starter/rules/505.ts"].every((f) => existsSync(pjoin(out, f))));
}
const must = (name, env, re) => { const e = quiet(() => bundle(env)); check(name, e instanceof BundleError && re.test(e.message), String(e?.message ?? "no error").slice(0, 300)); };
must("a module that calls fetch fails the build, with the file and line", { GAMES_SOURCE: tree("bad", (d) => put(d, "rules/202.ts", `import { defineRule } from "promptocracy/engine";\nexport default defineRule({ rule: 202, actionAllowed() { return fetch("https://x"); } });`)) }, /lint failed[\s\S]*bad[\s\S]*rules\/202\.ts[\s\S]*line 2 uses "fetch"/);
must("a module that imports a foreign package fails the build", { GAMES_SOURCE: tree("bad", (d) => put(d, "rules/504.ts", `import fs from "node:fs";\n` + readFileSync(pjoin(FIX, "rules/504.ts"), "utf8"))) }, /imports "node:fs"/);
must("game.json that lists a module rules/ does not hold (or holds one it does not list) fails the build", { GAMES_SOURCE: tree("bad", (d) => put(d, "game.json", `{ "engine": 1, "modules": [202, 504] }`)) }, /lists modules \[202,504\] but rules\/ holds \[202,504,505\]/);
must("a game that needs another engine version fails the build", { GAMES_SOURCE: tree("bad", (d) => put(d, "game.json", `{ "engine": 2, "modules": [202, 504, 505] }`)) }, /engine 2, this platform runs engine 1/);
must("a game with no game.json fails the build", { GAMES_SOURCE: tree("bad", (d) => execFileSync("mv", [pjoin(d, "game.json"), pjoin(work, "moved-" + seq++)])) }, /game\.json is missing/);
must("two spawn rules (or none) fail the build", { GAMES_SOURCE: tree("bad", (d) => put(d, "rules/504.ts", readFileSync(pjoin(FIX, "rules/504.ts"), "utf8").replace("afterAction(", "spawnTile() { return null; },\n  afterAction("))) }, /spawnTile needs exactly one rule to implement it, found 2/);
must("text, settings and modules out of step fail the build (a [setting] the file lacks)", { GAMES_SOURCE: tree("bad", (d) => put(d, "RULES.md", readFileSync(pjoin(FIX, "RULES.md"), "utf8").replace("[setting: max_players]", "[setting: max_players] [setting: board.nope]"))) }, /names \[setting: board\.nope\]/);
must("a module file named for another rule than it implements fails the build", { GAMES_SOURCE: tree("bad", (d) => put(d, "rules/202.ts", readFileSync(pjoin(FIX, "rules/202.ts"), "utf8").replace("rule: 202", "rule: 203"))) }, /rules\/202\.ts must default-export defineRule\(\{ rule: 202/);
must("a game whose own tests fail does not bundle, and the failing output is in the message", { GAMES_SOURCE: tree("bad", (d) => put(d, "rules/202.test.ts", `import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("fails on purpose", () => assert.equal(1, 2));\n`)) }, /tests fail against this engine[\s\S]*fails on purpose/);
must("a game with no tests does not bundle", { GAMES_SOURCE: tree("bad", (d) => { for (const f of ["202.test.ts", "rulebook.test.ts"]) execFileSync("mv", [pjoin(d, "rules", f), pjoin(work, "moved-" + seq++)]); }) }, /no tests/);
must("a settings.json that is not valid fails the build", { GAMES_SOURCE: tree("bad", (d) => put(d, "settings.json", J({ ...DEFAULT_SETTINGS, "board.chart_radius": 99 }))) }, /board\.chart_radius/);
check("BUNDLE_SKIP_TESTS=1 skips the game's tests (and only the tests: the lint and the checks still run)", quiet(() => bundle({ BUNDLE_SKIP_TESTS: "1", GAMES_SOURCE: tree("bad", (d) => put(d, "rules/202.test.ts", `import { test } from "node:test";\ntest("x", () => { throw new Error("no"); });\n`)) })) === null);
{
  process.env.PROMPTOCRACY_TEST_SECRET = "hunter2";
  const src = tree("bad", (d) => put(d, "rules/202.test.ts", `import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("sees no secrets", () => { assert.equal(process.env.PROMPTOCRACY_TEST_SECRET, undefined); assert.equal(process.env.CLOUDFLARE_API_TOKEN, undefined); });\n`));
  const e = quiet(() => bundle({ GAMES_SOURCE: src }));
  delete process.env.PROMPTOCRACY_TEST_SECRET;
  check("a game's tests run with a scrubbed environment: no secret of the build reaches game code", e === null, String(e?.message).slice(0, 300));
}

console.log("fetching a game: the latest day-N tag of a git remote");
{
  const base = pjoin(work, "remote"), repo = pjoin(base, "owner", "game");
  mkdirSync(repo, { recursive: true });
  const g = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...a], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  g("init", "-q", "-b", "main");
  cpSync(FIX, repo, { recursive: true });
  const sha = {};
  const commit = (msg) => { g("add", "-A"); g("commit", "-q", "-m", msg); return g("rev-parse", "HEAD").trim(); };
  sha.d0 = commit("day 0"); g("tag", "day-0");
  put(repo, "RULES.md", readFileSync(pjoin(repo, "RULES.md"), "utf8") + "\nAdded on day 2.\n"); sha.d2 = commit("day 2"); g("tag", "-a", "-m", "day 2", "day-2");
  put(repo, "RULES.md", readFileSync(pjoin(repo, "RULES.md"), "utf8") + "\nAdded on day 10.\n"); sha.d10 = commit("day 10"); g("tag", "day-10");
  g("tag", "day-x"); g("tag", "not-a-day");
  put(repo, "RULES.md", readFileSync(pjoin(repo, "RULES.md"), "utf8") + "\nUntagged work on main.\n"); commit("after day 10");
  const manifest = pjoin(work, "manifest.json");
  writeFileSync(manifest, J({ engine: 1, games: { "rickshaw-1": { repo: "owner/game" } } }));
  check("latestDayTag picks the highest NUMBER (day-10 beats day-2), ignores day-x and other tags", latestDayTag(`file://${repo}`).tag === "day-10" && latestDayTag(`file://${repo}`).day === 10);
  const out = pjoin(work, "out-git");
  const e = quiet(() => bundle({ BUNDLE_OUT: out, GAMES_MANIFEST: manifest, GAMES_GIT_BASE: `file://${base}` }));
  const gen = existsSync(pjoin(out, "games.ts")) ? readFileSync(pjoin(out, "games.ts"), "utf8") : "";
  check("the manifest game is fetched at day-10, not at main: day 10, that tag's commit, its text without the untagged work", e === null && /"rickshaw-1": \{ slug: "rickshaw-1", repo: "owner\/game", tag: "day-10", day: 10, sha: "[0-9a-f]{40}"/.test(gen) && gen.includes(sha.d10) && gen.includes("Added on day 10") && !gen.includes("Untagged work"), String(e));
  check("the bundle never carries the .git folder of the fetched repo", !existsSync(pjoin(out, "games", "rickshaw-1", ".git")));
  writeFileSync(manifest, J({ engine: 1, games: { "rickshaw-1": { repo: "owner/missing" } } }));
  must("a game whose repo cannot be reached fails the build (no half bundle, no silent fallback)", { GAMES_MANIFEST: manifest, GAMES_GIT_BASE: `file://${base}` }, /could not list the tags/);
  const bare = pjoin(base, "owner", "untagged"); mkdirSync(bare, { recursive: true }); execFileSync("git", ["init", "-q", bare]);
  writeFileSync(manifest, J({ engine: 1, games: { "rickshaw-1": { repo: "owner/untagged" } } }));
  must("a game with no day-N tag yet fails the build and says to tag it first", { GAMES_MANIFEST: manifest, GAMES_GIT_BASE: `file://${base}` }, /no day-N tag yet\. Tag the game's main/);
  writeFileSync(manifest, J({ engine: 1, games: { "Bad Slug": { repo: "owner/game" } } }));
  must("a manifest slug or repo that is malformed fails the build", { GAMES_MANIFEST: manifest, GAMES_GIT_BASE: `file://${base}` }, /slug .* is not valid/);
  writeFileSync(manifest, J({ engine: 1, games: { ok: { repo: "../etc/passwd" } } }));
  must("a manifest repo with .. in it fails the build", { GAMES_MANIFEST: manifest, GAMES_GIT_BASE: `file://${base}` }, /must look like owner\/name/);
  writeFileSync(manifest, J({ engine: 2, games: {} }));
  must("a manifest for another engine version fails the build", { GAMES_MANIFEST: manifest }, /engine 2/);
}
check("the real manifest lists Rickshaw Game 1 at busterbenson/promptocracy-rickshaw", (() => {
  const mf = JSON.parse(readFileSync(pjoin(ROOT, "games.manifest.json"), "utf8"));
  return mf.engine === 1 && J(mf.games) === J({ "rickshaw-1": { repo: "busterbenson/promptocracy-rickshaw" } });
})());
check("src/generated is gitignored (it is built, never committed)", /^src\/generated\/$/m.test(readFileSync(pjoin(ROOT, ".gitignore"), "utf8")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
