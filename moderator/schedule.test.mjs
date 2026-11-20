// The moderator's schedule (moderator/schedule.mjs): the register, the launchd entries, the plist, the reload-only-on-change
// rule. Nothing here loads a launchd job or reaches the network: every plist and state folder is a temp one, the game
// repo is a local bare repo, and the reload is a stand-in.
//   node moderator/schedule.test.mjs
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./process-day.mjs";
import { applySchedule, buildRegister, CRON_SLACK_MINUTES, lintPlist, isMainRun, moderatedSlugs, nightWindow, readGameInputs, refreshSchedule, reloadJob, reloadNow, scheduleBlock } from "./schedule.mjs";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else { fail++; console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`); } };
const TMP = realpathSync(mkdtempSync(join(tmpdir(), "moderator-schedule-test-")));
check("guard: the test's folders are not under ~/chalantbot", !TMP.startsWith(join(homedir(), "chalantbot")) && !TMP.startsWith(join(realpathSync(homedir()), "chalantbot")), TMP);
const NOW = Date.parse("2026-11-20T16:00:00Z");
const PT = "America/Los_Angeles";
const has = (entries, h, m) => entries.includes(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
const clock = (entries) => entries.join(" ");
const hourOf = (e) => Number(e.slice(0, 2));

console.log("the window");
{
  const w = nightWindow(PT, "2026-11-21");
  check("an ordinary Pacific night: opens at midnight, closes at 2:35 am (2:00 deadline + 30 minutes deploy grace + the Worker's 5-minute cron tick)", w.opens === Date.parse("2026-11-21T08:00:00Z") && w.closes === Date.parse("2026-11-21T10:35:00Z"), JSON.stringify(w));
  const fall = nightWindow(PT, "2026-11-01");
  check("the fall-back night (1 am comes twice): the 2 am deadline is 3 hours after midnight, so it closes at 2:35 am PST", fall.closes - fall.opens === (3 * 60 + 35) * 60_000, String((fall.closes - fall.opens) / 3600_000));
  const spring = nightWindow(PT, "2026-03-08");
  check("the spring-forward night (2 am never happens): the deadline is the jump, 3:00 am PDT, so it closes 3:35 am PDT, 2h35 after midnight", spring.closes - spring.opens === 155 * 60_000 && spring.closes === Date.parse("2026-03-08T10:35:00Z"), String((spring.closes - spring.opens) / 3600_000));
}

console.log("the register");
{
  const one = (tz, extra = {}, hostTz = PT, now = NOW) => buildRegister({ games: [{ slug: "g", repo: "o/g", tag: "day-3", sha: "a".repeat(40), settings: { "game.timezone": tz } }], hostTz, now, ...extra });
  const reg = buildRegister({ games: [{ slug: "rickshaw-1", repo: "busterbenson/promptocracy-rickshaw", tag: "day-3", sha: "a".repeat(40), settings: { "game.timezone": PT } }], hostTz: PT, now: NOW });
  const g = reg.games["rickshaw-1"];
  check("Pacific game on a Pacific mini: the night opens 00:00, the main run is 00:02, the backstop 01:00 (deadline 2:00 minus 1 hour)", g.time_zone === PT && g.window.opens === "00:00" && g.window.runs.main === "00:02" && g.window.runs.backstop === "01:00" && g.window.deadline === "02:00" && g.window.closes === "02:35", JSON.stringify(g.window));
  check("Pacific: exactly two entries, 00:02 and 01:00, whatever the date: the spring-forward night (deadline 3:00 am PDT) and the fall-back night (1 am twice) still start the main run at 00:02 and the backstop one real hour before the deadline, 01:00 PST and 01:00 PST", JSON.stringify(reg.entries) === JSON.stringify(["00:02", "01:00"]), clock(reg.entries));
  check("the register says where each input came from (the tag, the constants, the rule, the design)", /settings\.json "game\.timezone" in busterbenson\/promptocracy-rickshaw at day-3/.test(g.from.time_zone) && /DEADLINE_HOUR 2:00/.test(g.from.closes) && /DEPLOY_GRACE_MINUTES 30/.test(g.from.closes) && /rule 203\.1/.test(g.from.opens) && /main run 2 minutes after/.test(g.from.runs) && g.sha === "a".repeat(40) && reg.host_time_zone === PT);

  const ny = one("America/New_York");
  check("New York game on a Pacific mini: midnight Eastern is 21:00 Pacific, so main 21:02 and backstop 22:00; the fall-back night (East changed, West not) adds 23:00; nothing at Pacific midnight", has(ny.entries, 21, 2) && has(ny.entries, 22, 0) && has(ny.entries, 23, 0) && !has(ny.entries, 0, 2) && ny.entries.length === 3, clock(ny.entries));
  const lon = one("Europe/London");
  check("London game on a Pacific mini: main 16:02 and backstop 17:00 when London midnight is 16:00 Pacific; the weeks the two zones' clocks change on different dates (London midnight at 17:00) add 17:02 and 18:00", has(lon.entries, 16, 2) && has(lon.entries, 17, 0) && has(lon.entries, 17, 2) && has(lon.entries, 18, 0) && lon.entries.length === 4 && !has(lon.entries, 12, 0), clock(lon.entries));
  const ind = one("Asia/Kolkata");
  check("a half-hour zone (Kolkata, UTC+5:30): midnight is 10:30 PST, so main 10:32 and backstop 11:30 (the 2 am deadline is 12:30 PST)", has(ind.entries, 10, 32) && has(ind.entries, 11, 30) && !has(ind.entries, 10, 30), clock(ind.entries));
  const both = buildRegister({ games: [{ slug: "a", repo: "o/a", tag: "day-1", sha: "a".repeat(40), settings: { "game.timezone": PT } }, { slug: "ny", repo: "o/ny", tag: "day-1", sha: "b".repeat(40), settings: { "game.timezone": "America/New_York" } }], hostTz: PT, now: NOW });
  check("two games: the entries are the union, each time once, in clock order", has(both.entries, 0, 2) && has(both.entries, 21, 2) && both.entries.length === new Set([...reg.entries, ...ny.entries]).size && both.entries.every((e, i, a) => i === 0 || a[i - 1] < e));

  const moved = one("America/New_York");
  check("a passed rule that changes the game's time zone (settings.json at the new tag) moves the schedule", has(moved.entries, 21, 2) && !has(moved.entries, 0, 2) && /at day-3/.test(moved.games.g.from.time_zone));
  const bad = one("Mars/Olympus");
  check("a time zone the runtime doesn't know falls back to the platform default, as the Worker does, and says so", bad.games.g.time_zone === PT && /platform default/.test(bad.games.g.from.time_zone));
  const later = one(PT, { deadlineHour: 4, graceMinutes: 45 });
  check("a changed deadline (4:00, grace 45): the backstop moves to 03:00 (deadline minus 1 hour), the main run stays 00:02, the grace closes at 04:50", later.games.g.window.runs.backstop === "03:00" && has(later.entries, 3, 0) && has(later.entries, 0, 2) && !has(later.entries, 1, 0) && later.games.g.window.closes === "04:50" && later.deadline_hour === 4 && later.deploy_grace_minutes === 45, clock(later.entries));
  const knd = one(PT, {}, "Asia/Kathmandu");
  check("a mini on a 45-minute-offset zone (Kathmandu): Pacific midnight is 13:45 there, so main 13:47 and backstop 14:45", has(knd.entries, 13, 47) && has(knd.entries, 14, 45), clock(knd.entries));
  check("CRON_SLACK_MINUTES is the Worker's CRON_SLACK_MS (src/lib/day.ts)", new RegExp(`CRON_SLACK_MS = ${CRON_SLACK_MINUTES} \\* 60_000`).test(readFileSync(join(ROOT, "src", "lib", "day.ts"), "utf8")));
  check("the same inputs give the same entries whatever the date (the horizon covers every daylight-saving change)", JSON.stringify(one(PT, {}, PT, Date.parse("2027-06-15T12:00:00Z")).entries) === JSON.stringify(one(PT).entries));
  // Which run is the main one: a start within 20 minutes after the game's midnight.
  check("isMainRun: 00:02 Pacific is the main run, 01:00 (the backstop) and a wake at 09:00 are not", isMainRun(reg, "rickshaw-1", Date.parse("2026-11-21T08:02:00Z")) && !isMainRun(reg, "rickshaw-1", Date.parse("2026-11-21T09:00:00Z")) && !isMainRun(reg, "rickshaw-1", Date.parse("2026-11-21T17:00:00Z")) && !isMainRun(reg, "rickshaw-1", Date.parse("2026-11-21T07:59:00Z")) && !isMainRun(null, "rickshaw-1", Date.parse("2026-11-21T08:02:00Z")) && !isMainRun(reg, "other", Date.parse("2026-11-21T08:02:00Z")));
  check("isMainRun: follows the game's zone (New York main run is 05:02 UTC, not 08:02) and the spring-forward night's own midnight", isMainRun(moved, "g", Date.parse("2026-11-21T05:02:00Z")) && !isMainRun(moved, "g", Date.parse("2026-11-21T08:02:00Z")) && isMainRun(reg, "rickshaw-1", Date.parse("2026-03-08T08:02:00Z")));
}

console.log("the plist");
{
  const reg = buildRegister({ games: [{ slug: "rickshaw-1", repo: "busterbenson/promptocracy-rickshaw", tag: "day-3", sha: "a".repeat(40), settings: { "game.timezone": PT } }], hostTz: PT, now: NOW });
  const live = readFileSync(join(ROOT, "moderator", "com.chalant.promptocracy-moderator.plist"), "utf8");
  const block = scheduleBlock(reg);
  check("the block has one StartCalendarInterval dict per entry, and no double hyphen inside the comment (invalid XML)", (block.match(/<dict>/g) ?? []).length === 2 && !/--/.test(block.replace(/<!--|-->/g, "")), block.slice(0, 400));
  check("the committed plist's schedule is what the generator makes for Rickshaw on a Pacific mini (so a changed constant shows up here)", live.includes(block) && !/<key>StartInterval<\/key>/.test(live), "run: node moderator/schedule.mjs --plist moderator/com.chalant.promptocracy-moderator.plist --dry-run, or regenerate it");
  const old = '<plist><dict>\n    <key>Label</key>\n    <string>x</string>\n    <key>StartInterval</key>\n    <integer>120</integer>\n    <key>Other</key>\n    <string>y</string>\n</dict></plist>\n';
  const once = applySchedule(old, block);
  check("applySchedule replaces StartInterval with the block and keeps the rest", !/StartInterval/.test(once) && /StartCalendarInterval/.test(once) && /<key>Other<\/key>/.test(once) && /<key>Label<\/key>/.test(once));
  const again = applySchedule(once, block);
  check("applying the same block again changes nothing (idempotent)", again === once);
  const other = applySchedule(once, scheduleBlock(buildRegister({ games: [{ slug: "r", repo: "o/r", tag: "day-1", sha: "a".repeat(40), settings: { "game.timezone": "America/New_York" } }], hostTz: PT, now: NOW })));
  check("a different schedule replaces the marked block whole, not appended", (other.match(/schedule:begin/g) ?? []).length === 1 && (other.match(/<key>StartCalendarInterval<\/key>/g) ?? []).length === 1 && /<key>Hour<\/key><integer>21<\/integer>/.test(other) && !/<key>Hour<\/key><integer>0<\/integer><key>Minute<\/key><integer>2</.test(other));
  let threw = false; try { applySchedule("<plist><dict></dict></plist>", block); } catch { threw = true; }
  check("a plist with neither markers nor StartInterval is refused, not guessed at", threw);
  let linted = true; try { lintPlist(live); } catch (e) { linted = false; console.log(e.message); }
  check("the committed plist lints", linted);
  let bad = false; try { lintPlist(live.replace("</dict>\n</plist>", "")); } catch { bad = true; }
  check("a malformed plist does not lint", bad);
  const empty = scheduleBlock({ ...reg, entries: [], games: {} });
  check("no game with a token: the block has no entries (the job then never fires)", !/StartCalendarInterval/.test(empty) && /no game has a token/.test(empty));
}

console.log("reload only on change");
{
  const plist = join(TMP, "job.plist"), stateDir = join(TMP, "state");
  copyFileSync(join(ROOT, "moderator", "com.chalant.promptocracy-moderator.plist"), plist);
  // start from the old StartInterval form, as the live plist is today
  writeFileSync(plist, readFileSync(plist, "utf8").replace(/\n[ \t]*<!-- schedule:begin[\s\S]*?schedule:end -->/, "\n    <key>StartInterval</key>\n    <integer>120</integer>"));
  const manifest = { engine: 1, games: { "rickshaw-1": { repo: "busterbenson/promptocracy-rickshaw" } } };
  let tz = PT, reloads = 0, tag = "day-3";
  const common = { manifest, slugs: ["rickshaw-1"], stateDir, plist, hostTz: PT, now: NOW, readInputs: () => ({ tag, sha: "a".repeat(40), settings: { "game.timezone": tz } }), reload: () => { reloads++; return true; } };
  const r1 = await refreshSchedule(common);
  check("first run: StartInterval becomes the calendar schedule, and the job is reloaded", r1.changed && r1.reloaded && reloads === 1 && !/StartInterval/.test(readFileSync(plist, "utf8")) && (readFileSync(plist, "utf8").match(/<dict><key>Hour/g) ?? []).length === 2);
  const reg1 = readFileSync(join(stateDir, "register.json"), "utf8");
  const m1 = statSync(plist).mtimeMs;
  const r2 = await refreshSchedule({ ...common, now: NOW + 3600_000 });
  check("second run, same inputs: no rewrite, no reload, the register file is untouched", !r2.changed && !r2.reloaded && reloads === 1 && statSync(plist).mtimeMs === m1 && readFileSync(join(stateDir, "register.json"), "utf8") === reg1);
  tag = "day-4"; // a new tag, same time zone: the register notes the tag but the entries are the same
  const r3 = await refreshSchedule({ ...common, now: NOW + 7200_000 });
  check("a new tag with the same zone: the register is rewritten (the tag changed), the plist and the job are not", !r3.changed && reloads === 1 && /"tag": "day-4"/.test(readFileSync(join(stateDir, "register.json"), "utf8")));
  tz = "America/New_York";
  const r4 = await refreshSchedule({ ...common, now: NOW + 7200_000 });
  check("a rule that moves the time zone: the plist changes and the job is reloaded again", r4.changed && r4.reloaded && reloads === 2 && /<key>Hour<\/key><integer>21<\/integer>/.test(readFileSync(plist, "utf8")));
  tz = PT;
  const r5 = await refreshSchedule({ ...common, noReload: true });
  check("--no-reload rewrites the plist but never reloads", r5.changed && !r5.reloaded && reloads === 2);
  tz = "Europe/London";
  const before = readFileSync(plist, "utf8");
  const r6 = await refreshSchedule({ ...common, dryRun: true });
  check("--dry-run reports the change and writes nothing", r6.changed && readFileSync(plist, "utf8") === before && !/Europe/.test(readFileSync(join(stateDir, "register.json"), "utf8")));
  tz = PT;
  let lintFail = false;
  try { await refreshSchedule({ ...common, readInputs: () => ({ tag, sha: "a".repeat(40), settings: { "game.timezone": "Asia/Tokyo" } }), lint: () => { throw new Error("does not lint"); } }); } catch { lintFail = true; }
  check("a plist that fails to lint is never written", lintFail && readFileSync(plist, "utf8") === before);
}
{
  let spawned = 0, opts = null;
  const spawnFn = (cmd, args, o) => { spawned++; opts = { cmd, args, o }; return { unref() {} }; };
  check("reloadJob: a job that is not loaded is never loaded by this (the install is Chalant's)", reloadJob({ plist: "/x.plist", loaded: () => false, spawnFn }) === false && spawned === 0);
  check("reloadJob: a loaded job is reloaded by a DETACHED helper (the caller runs inside the job)", reloadJob({ plist: "/x.plist", uid: 501, loaded: () => true, spawnFn, notifyDir: "/n" }) === true && spawned === 1 && opts.o.detached === true && opts.args.includes("--reload-now") && opts.args.includes("/x.plist") && opts.args.includes("/n"), JSON.stringify(opts?.args));
  const calls = [], naps = [];
  const mk = (failBootstraps, stillOut) => { let b = 0; return (args) => { calls.push(args.join(" ")); if (args[0] === "bootstrap" && b++ < failBootstraps) throw Object.assign(new Error("x"), { stderr: "Bootstrap failed: 5: Input/output error" }); if (args[0] === "print" && stillOut) throw new Error("no such job"); return ""; }; };
  const nd = join(TMP, "notify");
  check("reloadNow: bootout, then bootstrap, then a check that the job is back", (await reloadNow({ plist: "/p.plist", uid: 501, launchctl: mk(0, false), sleep: async (ms) => naps.push(ms), notifyDir: nd })) === true && JSON.stringify(calls) === JSON.stringify(["bootout gui/501/com.chalant.promptocracy-moderator", "bootstrap gui/501 /p.plist", "print gui/501/com.chalant.promptocracy-moderator"]) && naps[0] === 5000, JSON.stringify(calls));
  calls.length = 0;
  check("reloadNow: a bootstrap that fails twice (I/O error right after the bootout) is retried, and nothing is notified", (await reloadNow({ plist: "/p.plist", uid: 501, launchctl: mk(2, false), sleep: async () => {}, notifyDir: nd })) === true && calls.filter((c) => c.startsWith("bootstrap")).length === 3 && !existsSync(nd));
  calls.length = 0;
  const failed = await reloadNow({ plist: "/p.plist", uid: 501, launchctl: mk(99, true), sleep: async () => {}, notifyDir: nd, attempts: 3 });
  const files = existsSync(nd) ? readdirSync(nd) : [];
  check("reloadNow: a job that never comes back writes a notification file saying the moderator is OFF and how to load it", failed === false && calls.filter((c) => c.startsWith("bootstrap")).length === 3 && files.length === 1 && /OFF until it is loaded: launchctl bootstrap gui\/501 \/p\.plist/.test(readFileSync(join(nd, files[0]), "utf8")), JSON.stringify(files));
}
{
  // The CLI looks for the plist before any network read.
  let out = "", code = 0;
  try { execFileSync(process.execPath, [join(ROOT, "moderator", "schedule.mjs"), "--plist", join(TMP, "missing.plist"), "--state-dir", join(TMP, "s3"), "--tokens-from", join(TMP, "none")], { stdio: "pipe", encoding: "utf8" }); } catch (e) { code = e.status; out = String(e.stderr); }
  check("the CLI with no plist at the path fails at once, naming it (no network read first)", code === 1 && /no plist at .*missing\.plist/.test(out), out);
}

console.log("the inputs");
{
  const manifest = { games: { "rickshaw-1": { repo: "o/r" }, "other-2": { repo: "o/o" } } };
  const envFile = join(TMP, "env");
  writeFileSync(envFile, "CLAUDE_API_KEY=x\nPROMPTOCRACY_MODERATOR_TOKEN_RICKSHAW_1=abcdef\nPROMPTOCRACY_MODERATOR_TOKEN_OTHER_2=\n");
  check("only a game with a non-empty moderator token on this machine is registered (names read, values never)", JSON.stringify(moderatedSlugs(manifest, { envFile, env: {} })) === '["rickshaw-1"]' && JSON.stringify(moderatedSlugs(manifest, { envFile: join(TMP, "none"), env: { PROMPTOCRACY_MODERATOR_TOKEN_OTHER_2: "t" } })) === '["other-2"]');
  // A game repo with two tags: the register reads the NEWEST day tag, not main.
  const bare = join(TMP, "game.git"), seed = join(TMP, "seed");
  const g = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  mkdirSync(seed, { recursive: true });
  g(["init", "-q", "--bare", "-b", "main", bare], TMP);
  g(["init", "-q", "-b", "main"], seed);
  g(["remote", "add", "origin", bare], seed);
  const put = (tz, tag) => { writeFileSync(join(seed, "settings.json"), JSON.stringify({ "game.timezone": tz })); g(["add", "-A"], seed); g(["commit", "-q", "--allow-empty", "-m", tag || "x"], seed); if (tag) g(["tag", tag], seed); };
  put(PT, "day-0"); put(PT, "day-1"); put("America/New_York", "day-2"); put("Asia/Tokyo", null);
  g(["push", "-q", "origin", "main", "--tags"], seed);
  const got = readGameInputs(bare);
  check("the register reads settings.json at the newest day-N tag (day-2), not at main", got.tag === "day-2" && got.settings["game.timezone"] === "America/New_York" && /^[0-9a-f]{40}$/.test(got.sha) && got.sha === g(["rev-parse", "day-2^{commit}"], seed).trim(), JSON.stringify(got));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
