// Bundles every game's rules for the Worker. Runs as wrangler's [build] command, so it runs on every
// `wrangler dev`, `wrangler deploy` and Workers Builds build. It writes src/generated/ (gitignored):
//   games.ts                          GAMES[slug] = { day, sha, tag, repo, rulesMd, settings, modules }, and STARTER
//   games/<slug>/rules/<n>.ts         each game's rule modules, copied (the Worker bundler follows the imports)
//   starter/rules/<n>.ts              the starter pack (templates/rules/), for games with no bundle
//
// For each game in games.manifest.json it finds the highest day-N tag of the game's PUBLIC repo
// (`git ls-remote --tags`, no token), fetches that tag (`git clone --depth 1`), and refuses to bundle it unless:
//   * game.json says engine 1 and lists exactly the modules in rules/
//   * every module passes the lint (src/engine/lint.js): it imports only "promptocracy/engine" and uses no
//     network, global or process names
//   * the modules load and assemble (exactly one spawn rule), and RULES.md, settings.json and the modules agree
//     (the same check as the game's own rulebook test)
//   * the game's own tests (node --test rules/*.test.ts) pass against THIS engine
// Game code is only ever run in child processes with a scrubbed environment (no deploy token in reach).
// Any failure stops the build, so a bad game never ships and the previous deploy keeps running.
//
// Environment (all optional):
//   GAMES_SOURCE=dir      read games from dir/<slug>/ instead of GitHub (tests/fixtures/games; nothing is fetched)
//   GAMES_GIT_BASE=url    where repos live (default https://github.com); tests point it at a local folder of bare repos
//   GAMES_MANIFEST=file   the manifest (default games.manifest.json)
//   BUNDLE_OUT=dir        where to write (default src/generated)
//   BUNDLE_SKIP_TESTS=1   skip running the tests (the wrangler dev of the test suite; the tests run them once, directly)
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ENGINE_VERSION } from "../src/engine/api.js";
import { lintModule } from "../src/engine/lint.js";
import { checkRulebook } from "../src/engine/rulesmd.js";
import { validateSettings } from "../src/lib/settings.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_RULES_BYTES = 200_000;
const SLUG = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export class BundleError extends Error {}
const fail = (m) => { throw new BundleError(m); };

// ---- running game code safely ------------------------------------------------------
const scrubbedEnv = (home) => ({ PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, NODE_ENV: "test", LANG: "C.UTF-8", NO_COLOR: "1" });
const stripFlags = () => (process.features?.typescript ? [] : ["--experimental-strip-types", "--no-warnings"]);

function runNode(args, cwd, label, { timeout = 120_000 } = {}) {
  const home = mkdtempSync(join(tmpdir(), "bundle-home-"));
  try {
    const r = spawnSync(process.execPath, [...stripFlags(), ...args], { cwd, env: scrubbedEnv(home), encoding: "utf8", timeout, maxBuffer: 20 * 1024 * 1024 });
    return { ok: r.status === 0, out: (r.stdout ?? "") + (r.stderr ?? ""), stdout: r.stdout ?? "", label };
  } finally { rmSync(home, { recursive: true, force: true }); }
}

// ---- fetching ---------------------------------------------------------------------------------
const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo", GCM_INTERACTIVE: "never" };
const git = (args, cwd) => execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8", timeout: 90_000, stdio: ["ignore", "pipe", "pipe"] });

// The highest day-N tag of a public repo: {tag, day}. A repo with none is an error (merge order: tag the game first).
export function latestDayTag(url) {
  let out;
  try { out = git(["ls-remote", "--tags", "--refs", url, "refs/tags/day-*"]); }
  catch (e) { fail(`could not list the tags of ${url} (is the repo public and reachable?): ${String(e.stderr || e.message).trim().split("\n").pop()}`); }
  const days = out.split("\n").map((l) => /refs\/tags\/day-(\d+)$/.exec(l.trim())).filter(Boolean).map((m) => Number(m[1]));
  if (!days.length) fail(`${url} has no day-N tag yet. Tag the game's main (for example day-0) before this build.`);
  const day = Math.max(...days);
  return { tag: `day-${day}`, day };
}

function fetchGame(slug, repo, base, into) {
  const url = `${base.replace(/\/+$/, "")}/${repo}${/^https?:/.test(base) ? ".git" : ""}`;
  const { tag, day } = latestDayTag(url);
  const dir = join(into, slug);
  try { git(["clone", "--quiet", "--depth", "1", "--branch", tag, "--", url, dir]); }
  catch (e) { fail(`could not fetch ${repo} at ${tag}: ${String(e.stderr || e.message).trim().split("\n").pop()}`); }
  const sha = git(["rev-parse", "HEAD"], dir).trim();
  rmSync(join(dir, ".git"), { recursive: true, force: true });
  return { dir, tag, day, sha };
}

// ---- checking one game tree ---------------------------------------------------------------------
const readJson = (p, what) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch (e) { fail(`${what} is missing or is not valid JSON (${e.message})`); } };

export function checkTree(dir, label, { starter = false, skipTests = false } = {}) {
  const rulesPath = join(dir, "RULES.md");
  if (!existsSync(rulesPath)) fail(`${label}: RULES.md is missing`);
  if (statSync(rulesPath).size > MAX_RULES_BYTES) fail(`${label}: RULES.md is too large`);
  const rulesMd = readFileSync(rulesPath, "utf8");
  const settings = readJson(join(dir, "settings.json"), `${label}: settings.json`);
  const rulesDir = join(dir, "rules");
  if (!existsSync(rulesDir)) fail(`${label}: rules/ is missing`);
  const files = readdirSync(rulesDir).filter((f) => /^\d+\.ts$/.test(f)).sort((a, b) => parseInt(a) - parseInt(b));
  if (!files.length) fail(`${label}: rules/ has no rule modules (rules/<n>.ts)`);

  if (!starter) {
    const manifest = readJson(join(dir, "game.json"), `${label}: game.json`);
    if (manifest.engine !== ENGINE_VERSION) fail(`${label}: game.json says engine ${JSON.stringify(manifest.engine)}, this platform runs engine ${ENGINE_VERSION}`);
    const listed = (manifest.modules ?? []).map(Number).sort((a, b) => a - b).join(",");
    const present = files.map((f) => parseInt(f)).join(",");
    if (listed !== present) fail(`${label}: game.json lists modules [${listed}] but rules/ holds [${present}]`);
  }
  const problems = [];
  for (const f of files) problems.push(...lintModule(readFileSync(join(rulesDir, f), "utf8"), `${label} rules/${f}`));
  if (problems.length) fail(`lint failed:\n  ${problems.join("\n  ")}`);

  // Game code runs only from here on, and only in a child with a scrubbed environment.
  if (!starter) {
    const nm = join(dir, "node_modules");
    mkdirSync(nm, { recursive: true });
    if (!existsSync(join(nm, "promptocracy"))) symlinkSync(ROOT, join(nm, "promptocracy"), "dir");
  }
  const chk = runNode([join(ROOT, "scripts", "check-game.mjs"), dir], dir, "check");
  let verdict;
  try { verdict = JSON.parse(chk.stdout.trim().split("\n").pop()); } catch { fail(`${label}: the module check did not run:\n${chk.out.slice(-1500)}`); }
  if (verdict.problems.length) fail(`${label}: ${verdict.problems.join("\n  ")}`);

  let tests = "skipped";
  if (!skipTests) {
    const tf = readdirSync(rulesDir).filter((f) => /\.test\.ts$/.test(f)).map((f) => `rules/${f}`);
    if (!tf.length) fail(`${label}: no tests (rules/*.test.ts). A game's rules need tests.`);
    const t = runNode(["--test", ...tf], dir, "tests");
    if (!t.ok) fail(`${label}: the game's tests fail against this engine:\n${t.out.slice(-4000)}`);
    tests = `${(/# pass (\d+)/.exec(t.out) ?? [])[1] ?? "?"} passed`;
  }
  return { rulesMd, settings, files, tests };
}

// ---- writing the bundle ------------------------------------------------------------------------------
const imp = (n) => `m${n}`;
export function writeBundle(out, entries, starter) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const lines = ['// GENERATED by scripts/bundle-games.mjs at build time. Do not edit; it is gitignored.'];
  let n = 0;
  const place = (rel, srcDir, files) => files.map((f) => {
    mkdirSync(join(out, rel, "rules"), { recursive: true });
    cpSync(join(srcDir, "rules", f), join(out, rel, "rules", f));
    const name = imp(n++);
    lines.push(`import ${name} from "./${rel}/rules/${f}";`);
    return name;
  });
  const games = entries.map((e) => ({ e, names: place(`games/${e.slug}`, e.dir, e.files) }));
  const st = { names: place("starter", starter.dir, starter.files), ...starter };
  const obj = ({ names, ...meta }) => `{ ${Object.entries(meta).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")}, modules: [${names.join(", ")}] }`;
  lines.push("", "export const GAMES: Record<string, any> = {");
  for (const g of games) lines.push(`  ${JSON.stringify(g.e.slug)}: ${obj({ names: g.names, slug: g.e.slug, repo: g.e.repo, tag: g.e.tag, day: g.e.day, sha: g.e.sha, rulesMd: g.e.rulesMd, settings: g.e.settings })},`);
  lines.push("};", "", `export const STARTER: any = ${obj({ names: st.names, rulesMd: st.rulesMd, settings: st.settings })};`, "");
  writeFileSync(join(out, "games.ts"), lines.join("\n"));
}

// ---- main ----------------------------------------------------------------------------------------------
export function bundleGames(env = process.env) {
  const out = resolve(ROOT, env.BUNDLE_OUT || "src/generated");
  const skipTests = env.BUNDLE_SKIP_TESTS === "1";
  const work = mkdtempSync(join(tmpdir(), "bundle-games-"));
  const log = (m) => console.log(`bundle-games: ${m}`);
  try {
    const startDir = join(ROOT, "templates");
    const sp = checkTree(startDir, "starter pack", { starter: true, skipTests: true });
    if (!skipTests) {
      const t = runNode(["--test", ...readdirSync(join(startDir, "rules")).filter((f) => /\.test\.ts$/.test(f)).map((f) => `templates/rules/${f}`)], ROOT, "starter tests");
      if (!t.ok) fail(`the starter pack's tests fail:\n${t.out.slice(-4000)}`);
      sp.tests = `${(/# pass (\d+)/.exec(t.out) ?? [])[1] ?? "?"} passed`;
    }
    log(`starter pack: rules ${sp.files.join(" ")} (${sp.tests})`);

    const entries = [];
    if (env.GAMES_SOURCE) {
      const src = resolve(ROOT, env.GAMES_SOURCE);
      for (const slug of readdirSync(src).filter((d) => statSync(join(src, d)).isDirectory()).sort()) {
        if (!SLUG.test(slug)) fail(`GAMES_SOURCE folder ${slug} is not a valid slug`);
        const copy = join(work, slug);
        cpSync(join(src, slug), copy, { recursive: true });
        const c = checkTree(copy, slug, { skipTests });
        entries.push({ slug, repo: `fixture/${slug}`, tag: "fixture", day: 0, sha: "fixture", dir: copy, ...c });
        log(`${slug}: from ${env.GAMES_SOURCE} (${c.tests})`);
      }
    } else {
      const manifest = readJson(resolve(ROOT, env.GAMES_MANIFEST || "games.manifest.json"), "games.manifest.json");
      if (manifest.engine !== ENGINE_VERSION) fail(`games.manifest.json says engine ${JSON.stringify(manifest.engine)}, this platform runs engine ${ENGINE_VERSION}`);
      const base = env.GAMES_GIT_BASE || "https://github.com";
      for (const [slug, g] of Object.entries(manifest.games ?? {})) {
        if (!SLUG.test(slug)) fail(`manifest slug ${JSON.stringify(slug)} is not valid`);
        if (!REPO.test(g?.repo ?? "") || g.repo.includes("..")) fail(`manifest repo for ${slug} must look like owner/name`);
        const f = fetchGame(slug, g.repo, base, work);
        const c = checkTree(f.dir, `${slug} (${g.repo} ${f.tag})`, { skipTests });
        entries.push({ slug, repo: g.repo, tag: f.tag, day: f.day, sha: f.sha, dir: f.dir, ...c });
        log(`${slug}: ${g.repo} ${f.tag} @ ${f.sha.slice(0, 7)}, rules ${c.files.join(" ")} (${c.tests})`);
      }
    }
    writeBundle(out, entries, { dir: startDir, ...sp });
    log(`wrote ${out} (${entries.length} game${entries.length === 1 ? "" : "s"} + the starter pack)`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { bundleGames(); } catch (e) {
    if (e instanceof BundleError) { console.error(`bundle-games: FAILED\n${e.message}`); process.exit(1); }
    throw e;
  }
}
