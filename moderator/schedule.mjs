#!/usr/bin/env node
// THE MODERATOR'S SCHEDULE. The night's times cannot change without a rule change, so the launchd job runs only at the
// times registered for each game's night, from a register, instead of every 2 minutes all day (Buster, 2026-11-20).
//
//   node moderator/schedule.mjs [--plist <path>] [--state-dir <dir>] [--tokens-from <file>] [--no-reload] [--dry-run]
//
// TWO RUNS A NIGHT PER GAME (Buster's design call, 2026-11-20):
//   MAIN      the window's open + 2 minutes (Rickshaw: 00:02). One process, start to finish: it waits for the site's
//             count (the Worker's cron), does the night's work, then watches its own deploy until the site unlocks or the
//             deploy grace closes (process-day.mjs, watch mode; isMainRun below says when a run is the main one).
//   BACKSTOP  the deadline minus 1 hour (Rickshaw: 01:00). The existing resumable path: it picks up a night a crashed or
//             stuck main run left, and does nothing if the night is done. The lock file keeps it off a main run that is
//             still watching its deploy.
// 1. THE REGISTER (<state dir>/register.json): for each game in games.manifest.json that has a moderator token on this
//    machine, its time zone (the game's own settings.json `game.timezone` at its newest day-N tag: what the Worker's
//    bundle reads, src/lib/day.ts timeZoneOf) and its night: it opens at the day's end (midnight in that zone, rule
//    203.1), the deadline is DEADLINE_HOUR (src/lib/day-gate.js) and the deploy grace DEPLOY_GRACE_MINUTES
//    (src/lib/votes.js), the same constants the Worker uses. The file says where every input came from.
// 2. THE SCHEDULE: launchd StartCalendarInterval entries in THIS machine's local time, two per game, replacing
//    StartInterval in the plist (between the schedule:begin / schedule:end markers). The plist is rewritten, and the job
//    reloaded, only when the entries changed.
// 3. KEEPING IT CURRENT: run.sh runs this again after a night that was claimed or re-tagged (a passed rule may have
//    changed the time zone), and Chalant runs it when installing the job.
//
// Daylight saving: an entry is only a wall-clock time, so one set of entries has to serve every night of the year. The
// times of EVERY night of the next 400 days (the game's real open and deadline each night, read on this machine's clock)
// are merged. On a night when the two clocks disagree a run may fire at an extra time: it finds nothing to do (one GET,
// no clone). See moderator/PLAN.md.
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
export const MAIN_AFTER_OPEN_MINUTES = 2; // the main run starts this long after the day's end
export const BACKSTOP_BEFORE_DEADLINE_MINUTES = 60; // the backstop run starts this long before the deadline
export const MAIN_WINDOW_MINUTES = 20; // a run that starts within this long of a night's opening is that night's main run
// The Worker's cron runs every 5 minutes (CRON_SLACK_MS in src/lib/day.ts, a TypeScript file this can't import; the test
// checks the two agree). A night not live by the deploy deadline is listed as not applied on the first cron tick after
// it, so the window stays open this long past the deadline: the run that reverts it must still be inside the window.
export const CRON_SLACK_MINUTES = 5;
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

/** One night, in epoch milliseconds: opens at the day's end (midnight), the deadline, and the deploy grace's end (plus one cron tick). */
export function nightWindow(tz, ymd, { deadlineHour = DEADLINE_HOUR, graceMinutes = DEPLOY_GRACE_MINUTES, cronSlackMinutes = CRON_SLACK_MINUTES } = {}) {
  const opens = startOfDate(tz, ymd);
  const deadline = deadlineAfter(tz, opens, deadlineHour);
  return { opens, deadline, closes: deadline + (graceMinutes + cronSlackMinutes) * 60_000 };
}

/**
 * Every time (this machine's local Hour:Minute) the moderator must start: for each night in the horizon, the main run
 * (open + 2 minutes) and the backstop (deadline - 1 hour), read on this machine's clock. [{Hour, Minute}] in clock order.
 */
export function slotsFor(gameTz, hostTz, now, { deadlineHour = DEADLINE_HOUR, graceMinutes = DEPLOY_GRACE_MINUTES, cronSlackMinutes = CRON_SLACK_MINUTES, horizonDays = HORIZON_DAYS, mainAfter = MAIN_AFTER_OPEN_MINUTES, backstopBefore = BACKSTOP_BEFORE_DEADLINE_MINUTES } = {}) {
  const seen = new Map();
  const first = localDate(gameTz, now);
  for (let i = 0; i < horizonDays; i++) {
    const { opens, deadline } = nightWindow(gameTz, addDays(first, i), { deadlineHour, graceMinutes, cronSlackMinutes });
    for (const t of [opens + mainAfter * 60_000, deadline - backstopBefore * 60_000]) {
      const w = wallClock(hostTz, t);
      seen.set(w.Hour * 60 + w.Minute, w);
    }
  }
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([, w]) => w);
}

/**
 * Is a run that starts at `nowMs` the MAIN run of a night of this game? Yes when it starts within MAIN_WINDOW_MINUTES after
 * the game's most recent midnight (read from the register's time zone). Any other start (the backstop, a run launchd made
 * up on wake from sleep) is a single pass. No register or game: never main.
 */
export function isMainRun(register, slug, nowMs) {
  const tz = register?.games?.[slug]?.time_zone;
  if (!validTimeZone(tz)) return false;
  const opens = startOfDate(tz, localDate(tz, nowMs));
  return nowMs >= opens && nowMs - opens <= MAIN_WINDOW_MINUTES * 60_000;
}

// ---- the register ------------------------------------------------------------------------------------------------
/**
 * The register. `games`: [{slug, repo, tag, sha, settings}] where settings is the game's parsed settings.json at its
 * newest day-N tag. The deadline and the deploy grace are platform constants (no game setting yet); the options let a
 * test, or a future rule that makes them settings, pass others.
 */
export function buildRegister({ games, hostTz = hostZone(), now = Date.now(), deadlineHour = DEADLINE_HOUR, graceMinutes = DEPLOY_GRACE_MINUTES, cronSlackMinutes = CRON_SLACK_MINUTES, horizonDays = HORIZON_DAYS, mainAfter = MAIN_AFTER_OPEN_MINUTES, backstopBefore = BACKSTOP_BEFORE_DEADLINE_MINUTES }) {
  const out = {};
  const merged = new Map();
  for (const g of games) {
    const own = g.settings?.["game.timezone"];
    const timeZone = validTimeZone(own) ? own : DEFAULT_SETTINGS["game.timezone"];
    const slots = slotsFor(timeZone, hostTz, now, { deadlineHour, graceMinutes, cronSlackMinutes, horizonDays, mainAfter, backstopBefore });
    for (const s of slots) merged.set(s.Hour * 60 + s.Minute, s);
    out[g.slug] = {
      repo: g.repo,
      tag: g.tag,
      sha: g.sha,
      time_zone: timeZone,
      window: { opens: "00:00", deadline: hhmm(deadlineHour * 60), closes: hhmm(deadlineHour * 60 + graceMinutes + cronSlackMinutes), runs: { main: hhmm(mainAfter), backstop: hhmm(deadlineHour * 60 - backstopBefore) }, in: "the game's time zone, on an ordinary night" },
      from: {
        time_zone: validTimeZone(own) ? `settings.json "game.timezone" in ${g.repo} at ${g.tag}` : `the platform default (DEFAULT_SETTINGS in src/lib/settings.js): settings.json has no valid "game.timezone" at ${g.tag}`,
        opens: "the day's end: midnight in the game's time zone (rule 203.1; startOfDate in src/lib/day-gate.js)",
        runs: `the main run ${mainAfter} minutes after the day's end, the backstop ${backstopBefore} minutes before the deadline (Buster, 2026-11-20)`,
        closes: `DEADLINE_HOUR ${deadlineHour}:00 (src/lib/day-gate.js, deadlineAfter, rule 107.6) plus DEPLOY_GRACE_MINUTES ${graceMinutes} (src/lib/votes.js, deployDeadline in src/lib/day.ts) plus one Worker cron tick, CRON_SLACK_MS ${cronSlackMinutes} (src/lib/day.ts): the tick that lists an undeployed night as not applied, which the moderator then reverts`,
      },
      times_on_this_machine: slots.length,
    };
  }
  return {
    version: 1,
    generated_at: new Date(now).toISOString(),
    host_time_zone: hostTz,
    main_after_open_minutes: mainAfter,
    backstop_before_deadline_minutes: backstopBefore,
    horizon_days: horizonDays,
    deadline_hour: deadlineHour,
    deploy_grace_minutes: graceMinutes,
    cron_slack_minutes: cronSlackMinutes,
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
  const games = Object.entries(register.games).map(([slug, g]) => `${slug} ${g.time_zone} ${g.window.runs.main} and ${g.window.runs.backstop}`).join("; ") || "no game has a token here";
  const head = `    ${BEGIN} (generated by moderator/schedule.mjs from register.json; do not edit by hand, run it again).
         Two runs a night per game, in this machine's time zone (${register.host_time_zone}): the main run just after the
         day's end and the backstop an hour before the deadline.
         Games (game time zone, main and backstop in that zone): ${games}. ${register.entries.length} entries.
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
 * Reload the job so launchd reads the new entries (it only reads a plist when the job is bootstrapped). Only a job that
 * is loaded is reloaded: this never installs one. The reload is a DETACHED helper (`--reload-now`, below) that waits a
 * few seconds first, because this process usually runs inside the job itself (run.sh calls it) and bootout would kill the
 * caller. The helper is in its own session (detached), and the plist's AbandonProcessGroup is the second guard.
 */
export function reloadJob({ plist, label = LABEL, uid = process.getuid(), loaded = jobLoaded, spawnFn = spawn, logFile, notifyDir }) {
  if (!loaded(label, uid)) return false;
  const out = logFile ? ["ignore", openSync(logFile, "a"), openSync(logFile, "a")] : "ignore";
  const child = spawnFn(process.execPath, [fileURLToPath(import.meta.url), "--reload-now", "--plist", plist, ...(notifyDir ? ["--notify-dir", notifyDir] : [])], { detached: true, stdio: out });
  child.unref?.();
  return true;
}

/**
 * The helper's work: wait, bootout, bootstrap (retried: right after a bootout launchd can answer "Input/output error"),
 * then check the job is back. If it is not, the moderator is OFF, so say so with a notification file for Buster.
 */
export async function reloadNow({ plist, label = LABEL, uid = process.getuid(), launchctl = (args) => execFileSync("/bin/launchctl", args, { stdio: "pipe", encoding: "utf8" }), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), notifyDir, attempts = 5, waitMs = 5000, retryMs = 3000 }) {
  const target = `gui/${uid}/${label}`;
  await sleep(waitMs);
  try { launchctl(["bootout", target]); } catch { /* not loaded any more: fine */ }
  let err = "";
  for (let i = 0; i < attempts; i++) {
    try { launchctl(["bootstrap", `gui/${uid}`, plist]); err = ""; break; } catch (e) { err = String(e.stderr || e.message).trim().slice(0, 200); await sleep(retryMs); }
  }
  let back = false;
  try { launchctl(["print", target]); back = true; } catch { /* still not loaded */ }
  if (!back && notifyDir) {
    mkdirSync(notifyDir, { recursive: true });
    writeFileSync(join(notifyDir, `${new Date().toISOString().slice(0, 10)}-promptocracy-schedule-reload-failed.md`), `# Promptocracy: the moderator's launchd job is not loaded\n\nThe schedule changed and the job was reloaded, but it did not come back (${err || "bootstrap answered, the job is still not there"}). The moderator is OFF until it is loaded: launchctl bootstrap gui/${uid} ${plist}\n`);
  }
  return back;
}

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
export async function refreshSchedule({ manifest, slugs, stateDir, plist, hostTz = hostZone(), now = Date.now(), readInputs = readGameInputs, urlOf = (s) => repoUrlOf(s, manifest), reload = reloadJob, lint = lintPlist, noReload = false, dryRun = false, notifyDir }) {
  const games = slugs.map((slug) => ({ slug, repo: manifest.games[slug].repo, ...readInputs(urlOf(slug)) }));
  const register = buildRegister({ games, hostTz, now });
  mkdirSync(stateDir, { recursive: true });
  const regPath = join(stateDir, "register.json");
  let prior = null;
  try { prior = JSON.parse(readFileSync(regPath, "utf8")); } catch { /* first one */ }
  if (!dryRun && (!prior || registerKey(prior) !== registerKey(register))) writeFileSync(regPath, JSON.stringify(register, null, 2) + "\n");
  if (dryRun) return { changed: existsSync(plist) && applySchedule(readFileSync(plist, "utf8"), scheduleBlock(register)) !== readFileSync(plist, "utf8"), reloaded: false, register };
  const changed = writePlist(plist, register, { lint });
  const reloaded = changed && !noReload ? Boolean(reload({ plist, logFile: join(stateDir, "reload.log"), notifyDir })) : false;
  return { changed, reloaded, register };
}

// ---- CLI ---------------------------------------------------------------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
  const manifest = JSON.parse(readFileSync(join(ROOT, "games.manifest.json"), "utf8"));
  const stateDir = opt("--state-dir", process.env.MODERATOR_STATE_DIR || join(CHALANT, "logs", "promptocracy-moderator"));
  const plist = opt("--plist", join(CHALANT, "launchd", `${LABEL}.plist`));
  if (args.includes("--reload-now")) {
    const ok = await reloadNow({ plist, notifyDir: opt("--notify-dir", join(CHALANT, "_notifications")) });
    console.log(JSON.stringify({ at: new Date().toISOString(), reloaded: ok }));
    process.exit(ok ? 0 : 1);
  }
  // The plist is what this writes: check it is there before any network read (a missing file would fail after one).
  if (!existsSync(plist)) { console.error(`schedule: no plist at ${plist}`); process.exit(1); }
  const slugs = moderatedSlugs(manifest, { envFile: opt("--tokens-from", join(CHALANT, ".env")) });
  try {
    const r = await refreshSchedule({ manifest, slugs, stateDir, plist, notifyDir: opt("--notify-dir", join(CHALANT, "_notifications")), noReload: args.includes("--no-reload"), dryRun: args.includes("--dry-run") });
    console.log(JSON.stringify({ at: new Date().toISOString(), games: slugs, entries: r.register.entries.length, plist_changed: r.changed, reloaded: r.reloaded }));
  } catch (e) {
    console.error(`schedule: ${String(e.message || e).slice(0, 400)}`);
    process.exit(1);
  }
}
