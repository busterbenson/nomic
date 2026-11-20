#!/usr/bin/env node
// THE MODERATOR'S SCHEDULE. The night's times cannot change without a rule change, so the launchd job runs only inside
// each game's night window, from a register, instead of every 2 minutes all day (Buster, 2026-11-20).
//
//   node moderator/schedule.mjs [--plist <path>] [--state-dir <dir>] [--env-file <file>] [--no-reload] [--dry-run]
//
// 1. THE REGISTER (<state dir>/register.json): for each game in games.manifest.json that has a moderator token on this
//    machine, its time zone (the game's own settings.json `game.timezone` at its newest day-N tag: what the Worker's
//    bundle reads, src/lib/day.ts timeZoneOf) and its night window: it opens at the day's end (midnight in that zone,
//    rule 203.1) and closes at the deadline plus the deploy grace (rule 107.6: DEADLINE_HOUR in src/lib/day-gate.js and
//    DEPLOY_GRACE_MINUTES in src/lib/votes.js, the same constants the Worker uses). The file says where every input
//    came from.
// 2. THE SCHEDULE: launchd StartCalendarInterval entries in THIS machine's local time, one every 2 minutes through each
//    window, replacing StartInterval in the plist (between the schedule:begin / schedule:end markers). The plist is
//    rewritten, and the job reloaded, only when the entries changed.
// 3. KEEPING IT CURRENT: run.sh runs this again after a night that was claimed or re-tagged (a passed rule may have
//    changed the time zone), and Chalant runs it when installing the job.
//
// Daylight saving: an entry is only a wall-clock time, so one set of entries has to serve every night of the year. The
// slots of EVERY night of the next 400 days (the game's real window each night, converted to this machine's clock) are
// merged. On an ordinary night the extra slots are idle runs (one GET, no clone); they exist so the nights on which
// the two clocks disagree are still covered. See moderator/PLAN.md.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { addDays, DEADLINE_HOUR, deadlineAfter, localDate, startOfDate } from "../src/lib/day-gate.js";
import { DEFAULT_SETTINGS, validTimeZone } from "../src/lib/settings.js";
import { DEPLOY_GRACE_MINUTES } from "../src/lib/votes.js";
import { latestDayTag } from "../scripts/bundle-games.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
export const LABEL = "com.chalant.promptocracy-moderator";
export const STEP_MINUTES = 2;
export const HORIZON_DAYS = 400; // more than a year, so both daylight-saving changes of any zone are inside
export const BEGIN = "<!-- schedule:begin";
export const END = "<!-- schedule:end -->";
const CHALANT = join(homedir(), "chalantbot");

// ---- the clocks --------------------------------------------------------------------------------------------------
/** This machine's time zone (launchd reads StartCalendarInterval in it). */
export const hostZone = () => process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

const wallFmts = new Map();
function wallFmt(tz) {
  let f = wallFmts.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); wallFmts.set(tz, f); }
  return f;
}
/** The hour and minute on a clock in a time zone, at an instant. */
export function wallClock(tz, ms) {
  const p = Object.fromEntries(wallFmt(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { Hour: Number(p.hour), Minute: Number(p.minute) };
}
const pad = (n) => String(n).padStart(2, "0");
const hhmm = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

/** One night's window, in epoch milliseconds: from the day's end (midnight) to the deadline plus the deploy grace. */
export function nightWindow(tz, ymd, { deadlineHour = DEADLINE_HOUR, graceMinutes = DEPLOY_GRACE_MINUTES } = {}) {
  const opens = startOfDate(tz, ymd);
  const closes = deadlineAfter(tz, opens, deadlineHour) + graceMinutes * 60_000;
  return { opens, closes };
}

/**
 * Every slot (this machine's local Hour:Minute) the moderator must run at: each night in the horizon, each 2 minutes
 * from the window's opening to its close, read on this machine's clock. Returns [{Hour, Minute}] in clock order.
 */
export function slotsFor(gameTz, hostTz, now, { deadlineHour = DEADLINE_HOUR, graceMinutes = DEPLOY_GRACE_MINUTES, horizonDays = HORIZON_DAYS, stepMinutes = STEP_MINUTES } = {}) {
  const seen = new Map();
  const first = localDate(gameTz, now);
  for (let i = 0; i < horizonDays; i++) {
    const { opens, closes } = nightWindow(gameTz, addDays(first, i), { deadlineHour, graceMinutes });
    for (let t = opens; t <= closes; t += stepMinutes * 60_000) {
      const w = wallClock(hostTz, t);
      seen.set(w.Hour * 60 + w.Minute, w);
    }
  }
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([, w]) => w);
}

// ---- the register ------------------------------------------------------------------------------------------------
/**
 * The register. `games`: [{slug, repo, tag, sha, settings}] where settings is the game's parsed settings.json at its
 * newest day-N tag. The deadline and the deploy grace are platform constants (no game setting yet); the options let a
 * test, or a future rule that makes them settings, pass others.
 */
export function buildRegister({ games, hostTz = hostZone(), now = Date.now(), deadlineHour = DEADLINE_HOUR, graceMinutes = DEPLOY_GRACE_MINUTES, horizonDays = HORIZON_DAYS, stepMinutes = STEP_MINUTES }) {
  const out = {};
  const merged = new Map();
  for (const g of games) {
    const own = g.settings?.["game.timezone"];
    const timeZone = validTimeZone(own) ? own : DEFAULT_SETTINGS["game.timezone"];
    const slots = slotsFor(timeZone, hostTz, now, { deadlineHour, graceMinutes, horizonDays, stepMinutes });
    for (const s of slots) merged.set(s.Hour * 60 + s.Minute, s);
    out[g.slug] = {
      repo: g.repo,
      tag: g.tag,
      sha: g.sha,
      time_zone: timeZone,
      window: { opens: "00:00", closes: hhmm(deadlineHour * 60 + graceMinutes), in: "the game's time zone, on an ordinary night" },
      from: {
        time_zone: validTimeZone(own) ? `settings.json "game.timezone" in ${g.repo} at ${g.tag}` : `the platform default (DEFAULT_SETTINGS in src/lib/settings.js): settings.json has no valid "game.timezone" at ${g.tag}`,
        opens: "the day's end: midnight in the game's time zone (rule 203.1; startOfDate in src/lib/day-gate.js)",
        closes: `DEADLINE_HOUR ${deadlineHour}:00 (src/lib/day-gate.js, deadlineAfter, rule 107.6) plus DEPLOY_GRACE_MINUTES ${graceMinutes} (src/lib/votes.js, deployDeadline in src/lib/day.ts)`,
      },
      slots: slots.length,
    };
  }
  return {
    version: 1,
    generated_at: new Date(now).toISOString(),
    host_time_zone: hostTz,
    step_minutes: stepMinutes,
    horizon_days: horizonDays,
    deadline_hour: deadlineHour,
    deploy_grace_minutes: graceMinutes,
    games: out,
    entries: [...merged.entries()].sort((a, b) => a[0] - b[0]).map(([m]) => hhmm(m)), // "HH:MM" on this machine's clock
  };
}

/** The register without its timestamp: what decides whether it changed. */
export const registerKey = (r) => JSON.stringify({ ...r, generated_at: undefined });

// ---- the plist ---------------------------------------------------------------------------------------------------
const dict = (e) => { const [h, m] = e.split(":").map(Number); return `        <dict><key>Hour</key><integer>${h}</integer><key>Minute</key><integer>${m}</integer></dict>`; };
/** The schedule block of the plist: deterministic from the register's entries (no timestamp), so equal entries are equal text. */
export function scheduleBlock(register) {
  const games = Object.entries(register.games).map(([slug, g]) => `${slug} ${g.time_zone} ${g.window.opens}-${g.window.closes}`).join("; ") || "no game has a token here";
  const head = `    ${BEGIN} (generated by moderator/schedule.mjs from register.json; do not edit by hand, run it again).
         Every ${register.step_minutes} minutes inside each game's night window, in this machine's time zone (${register.host_time_zone}).
         Games: ${games}. ${register.entries.length} entries.
         A run missed while the Mac is asleep still happens: launchd starts the job once on wake.
         AbandonProcessGroup lets the detached reload helper outlive the run that started it. -->
    <key>AbandonProcessGroup</key>
    <true/>`;
  if (!register.entries.length) return `${head}\n    ${END}`;
  return `${head}\n    <key>StartCalendarInterval</key>\n    <array>\n${register.entries.map(dict).join("\n")}\n    </array>\n    ${END}`;
}

/** Put the block in the plist: replace the marked block; else replace StartInterval (the first install); else refuse. */
export function applySchedule(plist, block) {
  const b = plist.indexOf(BEGIN), e = plist.indexOf(END);
  if (b >= 0 && e > b) {
    const start = plist.lastIndexOf("\n", b) + 1; // the line's indent is part of the block
    return plist.slice(0, start) + block + plist.slice(e + END.length);
  }
  const old = /\n[ \t]*<key>StartInterval<\/key>\s*<integer>\d+<\/integer>/;
  if (old.test(plist)) return plist.replace(old, `\n${block}`);
  throw new Error("the plist has neither schedule markers nor a StartInterval to replace");
}

/** Write the plist when the text changed; returns whether it did. `lint` throws on a malformed plist (so a bad file never replaces a good one). */
export function writePlist(path, register, { lint = lintPlist } = {}) {
  const old = readFileSync(path, "utf8");
  const next = applySchedule(old, scheduleBlock(register));
  if (next === old) return false;
  lint(next);
  writeFileSync(path, next);
  return true;
}

/** plutil -lint on the new text (macOS); a missing plutil is not an error. */
export function lintPlist(text) {
  const tmp = mkdtempSync(join(tmpdir(), "moderator-plist-"));
  try {
    const f = join(tmp, "lint.plist");
    writeFileSync(f, text);
    try { execFileSync("/usr/bin/plutil", ["-lint", f], { stdio: "pipe" }); }
    catch (e) { if (e.code !== "ENOENT") throw new Error(`the generated plist does not lint: ${String(e.stdout || e.message).trim()}`); }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

// ---- reloading the job -------------------------------------------------------------------------------------------
/** Is the job loaded in this user's launchd? */
export function jobLoaded(label = LABEL, uid = process.getuid()) {
  try { execFileSync("/bin/launchctl", ["print", `gui/${uid}/${label}`], { stdio: "ignore" }); return true; } catch { return false; }
}
/**
 * Reload the job so launchd reads the new entries (it only reads a plist when the job is bootstrapped). Only a job
 * that is loaded is reloaded: this never installs one. The reload is a DETACHED helper that waits a few seconds first,
 * because this process usually runs inside the job itself (run.sh calls it): bootout would kill the caller. The
 * plist's AbandonProcessGroup keeps launchd from killing the helper with the job.
 */
export function reloadJob({ plist, label = LABEL, uid = process.getuid(), loaded = jobLoaded, spawnFn = spawn, logFile }) {
  if (!loaded(label, uid)) return false;
  const sh = `sleep 5; /bin/launchctl bootout gui/${uid}/${label}; /bin/launchctl bootstrap gui/${uid} '${plist.replace(/'/g, "'\\''")}'`;
  const out = logFile ? ["ignore", openLog(logFile), openLog(logFile)] : "ignore";
  const child = spawnFn("/bin/sh", ["-c", sh], { detached: true, stdio: out });
  child.unref?.();
  return true;
}
const openLog = (f) => openSync(f, "a");

// ---- reading the games -------------------------------------------------------------------------------------------
/** The slugs of a manifest that have a moderator token in the env file or the environment (names only: values are never read out). */
export function moderatedSlugs(manifest, { envFile, env = process.env } = {}) {
  const text = envFile && existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  return Object.keys(manifest.games ?? {}).filter((slug) => {
    const key = `PROMPTOCRACY_MODERATOR_TOKEN_${slug.toUpperCase().replace(/-/g, "_")}`;
    return new RegExp(`^${key}=\\S`, "m").test(text) || Boolean(env[key]);
  });
}

/** A game's repo URL: the same rule as process-day.mjs (PROMPTOCRACY_GAME_REPO_<SLUG>, else GitHub over HTTPS). */
export const repoUrlOf = (slug, manifest, env = process.env) => env[`PROMPTOCRACY_GAME_REPO_${slug.toUpperCase().replace(/-/g, "_")}`] || (manifest.games?.[slug]?.repo && `https://github.com/${manifest.games[slug].repo}.git`);

/** The game's newest day-N tag, its commit and its settings.json (a shallow clone of that tag, in a folder this call makes and removes). */
export function readGameInputs(url) {
  const { tag } = latestDayTag(url);
  const work = mkdtempSync(join(tmpdir(), "moderator-schedule-"));
  try {
    const dir = join(work, "g");
    const git = (args, cwd) => execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    git(["clone", "-q", "--depth", "1", "--branch", tag, "--", url, dir], work);
    const sha = git(["rev-parse", "HEAD"], dir).trim();
    let settings = {};
    try { settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")); } catch { /* none or unreadable: the bundler refuses such a tag; the default applies here */ }
    return { tag, sha, settings };
  } finally { rmSync(work, { recursive: true, force: true }); }
}

// ---- the whole thing ---------------------------------------------------------------------------------------------
/**
 * Regenerate the register, rewrite the plist if its entries changed, reload the job if it did. Everything outside the
 * network is injectable. Returns {changed, reloaded, register}.
 */
export async function refreshSchedule({ manifest, slugs, stateDir, plist, hostTz = hostZone(), now = Date.now(), readInputs = readGameInputs, urlOf = (s) => repoUrlOf(s, manifest), reload = reloadJob, lint = lintPlist, noReload = false, dryRun = false }) {
  const games = slugs.map((slug) => ({ slug, repo: manifest.games[slug].repo, ...readInputs(urlOf(slug)) }));
  const register = buildRegister({ games, hostTz, now });
  mkdirSync(stateDir, { recursive: true });
  const regPath = join(stateDir, "register.json");
  let prior = null;
  try { prior = JSON.parse(readFileSync(regPath, "utf8")); } catch { /* first one */ }
  if (!dryRun && (!prior || registerKey(prior) !== registerKey(register))) writeFileSync(regPath, JSON.stringify(register, null, 2) + "\n");
  if (dryRun) return { changed: existsSync(plist) && applySchedule(readFileSync(plist, "utf8"), scheduleBlock(register)) !== readFileSync(plist, "utf8"), reloaded: false, register };
  const changed = writePlist(plist, register, { lint });
  const reloaded = changed && !noReload ? Boolean(reload({ plist, logFile: join(stateDir, "reload.log") })) : false;
  return { changed, reloaded, register };
}

// ---- CLI ---------------------------------------------------------------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
  const manifest = JSON.parse(readFileSync(join(ROOT, "games.manifest.json"), "utf8"));
  const stateDir = opt("--state-dir", process.env.MODERATOR_STATE_DIR || join(CHALANT, "logs", "promptocracy-moderator"));
  const plist = opt("--plist", join(CHALANT, "launchd", `${LABEL}.plist`));
  const slugs = moderatedSlugs(manifest, { envFile: opt("--env-file", join(CHALANT, ".env")) });
  try {
    const r = await refreshSchedule({ manifest, slugs, stateDir, plist, noReload: args.includes("--no-reload"), dryRun: args.includes("--dry-run") });
    console.log(JSON.stringify({ at: new Date().toISOString(), games: slugs, entries: r.register.entries.length, plist_changed: r.changed, reloaded: r.reloaded }));
  } catch (e) {
    console.error(`schedule: ${String(e.message || e).slice(0, 400)}`);
    process.exit(1);
  }
}
