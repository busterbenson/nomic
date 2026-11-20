// The moderator's schedule (moderator/schedule.mjs): the register, the launchd entries, the plist, the reload-only-on-change
// rule. Nothing here loads a launchd job or reaches the network: every plist and state folder is a temp one, the game
// repo is a local bare repo, and the reload is a stand-in.
//   node moderator/schedule.test.mjs
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./process-day.mjs";
import { applySchedule, buildRegister, LABEL, lintPlist, moderatedSlugs, nightWindow, readGameInputs, refreshSchedule, reloadJob, scheduleBlock, slotsFor } from "./schedule.mjs";

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
  check("an ordinary Pacific night: opens at midnight, closes at 2:30 am (2:00 deadline + 30 minutes deploy grace)", w.opens === Date.parse("2026-11-21T08:00:00Z") && w.closes === Date.parse("2026-11-21T10:30:00Z"), JSON.stringify(w));
  const fall = nightWindow(PT, "2026-11-01");
  check("the fall-back night (1 am comes twice): the 2 am deadline is 3 hours after midnight, so it closes at 2:30 am PST", fall.closes - fall.opens === (3 * 60 + 30) * 60_000, String((fall.closes - fall.opens) / 3600_000));
  const spring = nightWindow(PT, "2026-03-08");
  check("the spring-forward night (2 am never happens): the deadline is the jump, 3:00 am PDT, so it closes 3:30 am PDT, 2.5 hours after midnight", spring.closes - spring.opens === 150 * 60_000 + 0 && spring.closes === Date.parse("2026-03-08T10:30:00Z"), String((spring.closes - spring.opens) / 3600_000));
}

console.log("the register");
{
  const reg = buildRegister({ games: [{ slug: "rickshaw-1", repo: "busterbenson/promptocracy-rickshaw", tag: "day-3", sha: "a".repeat(40), settings: { "game.timezone": PT } }], hostTz: PT, now: NOW });
  const g = reg.games["rickshaw-1"];
  check("Pacific game on a Pacific mini: the window is 00:00 to 02:30", g.time_zone === PT && g.window.opens === "00:00" && g.window.closes === "02:30", JSON.stringify(g.window));
  check("Pacific: an entry every 2 minutes from 0:00 through 2:30", has(reg.entries, 0, 0) && has(reg.entries, 0, 2) && has(reg.entries, 1, 58) && has(reg.entries, 2, 30) && !has(reg.entries, 0, 1) && !has(reg.entries, 2, 32) && !has(reg.entries, 12, 0), clock(reg.entries));
  check("Pacific: the spring-forward night (3:30 am PDT close) is covered too, and nothing else is: 76 + 16 entries, none after 3:30", has(reg.entries, 3, 0) && has(reg.entries, 3, 30) && !has(reg.entries, 3, 32) && reg.entries.length === 92 && reg.entries.every((e) => hourOf(e) < 4), String(reg.entries.length));
  check("the register says where each input came from (the tag, the constants, the rule)", /settings\.json "game\.timezone" in busterbenson\/promptocracy-rickshaw at day-3/.test(g.from.time_zone) && /DEADLINE_HOUR 2:00/.test(g.from.closes) && /DEPLOY_GRACE_MINUTES 30/.test(g.from.closes) && /rule 203\.1/.test(g.from.opens) && g.sha === "a".repeat(40) && reg.host_time_zone === PT);

  const ny = buildRegister({ games: [{ slug: "ny", repo: "o/ny", tag: "day-1", sha: "b".repeat(40), settings: { "game.timezone": "America/New_York" } }], hostTz: PT, now: NOW });
  check("New York game on a Pacific mini: midnight Eastern is 21:00 Pacific, so 21:00 to 23:30; the fall-back night (the East has changed its clocks, the West has not) runs on to 00:30; nothing else", has(ny.entries, 21, 0) && has(ny.entries, 23, 30) && has(ny.entries, 0, 30) && !has(ny.entries, 0, 32) && !has(ny.entries, 20, 58) && !has(ny.entries, 12, 0), clock(ny.entries));
  const lon = buildRegister({ games: [{ slug: "ldn", repo: "o/l", tag: "day-1", sha: "c".repeat(40), settings: { "game.timezone": "Europe/London" } }], hostTz: PT, now: NOW });
  check("London game on a Pacific mini: 16:00 to 18:30 in winter and summer; the weeks the two zones' clocks change on different dates (London midnight at 17:00) run on to 19:30", has(lon.entries, 16, 0) && has(lon.entries, 18, 30) && has(lon.entries, 17, 0) && has(lon.entries, 19, 30) && !has(lon.entries, 15, 58) && !has(lon.entries, 19, 32), clock(lon.entries));
  const ind = buildRegister({ games: [{ slug: "in", repo: "o/i", tag: "day-1", sha: "d".repeat(40), settings: { "game.timezone": "Asia/Kolkata" } }], hostTz: PT, now: NOW });
  check("a half-hour zone (Kolkata, UTC+5:30) lands on the mini's clock at 10:30 PST", has(ind.entries, 10, 30) && has(ind.entries, 13, 0) && !has(ind.entries, 10, 0), clock(ind.entries));
  const both = buildRegister({ games: [{ slug: "a", repo: "o/a", tag: "day-1", sha: "a".repeat(40), settings: { "game.timezone": PT } }, { slug: "ny", repo: "o/ny", tag: "day-1", sha: "b".repeat(40), settings: { "game.timezone": "America/New_York" } }], hostTz: PT, now: NOW });
  check("two games: the entries are the union, each time once, in clock order", has(both.entries, 0, 0) && has(both.entries, 21, 0) && both.entries.length === new Set([...reg.entries, ...ny.entries]).size && both.entries.every((e, i, a) => i === 0 || a[i - 1] < e));

  const moved = buildRegister({ games: [{ slug: "rickshaw-1", repo: "o/r", tag: "day-4", sha: "e".repeat(40), settings: { "game.timezone": "America/New_York" } }], hostTz: PT, now: NOW });
  check("a passed rule that changes the game's time zone (settings.json at the new tag) moves the schedule", has(moved.entries, 21, 0) && !has(moved.entries, 1, 0) && /at day-4/.test(moved.games["rickshaw-1"].from.time_zone));
  const bad = buildRegister({ games: [{ slug: "rickshaw-1", repo: "o/r", tag: "day-4", sha: "e".repeat(40), settings: { "game.timezone": "Mars/Olympus" } }], hostTz: PT, now: NOW });
  check("a time zone the runtime doesn't know falls back to the platform default, as the Worker does, and says so", bad.games["rickshaw-1"].time_zone === PT && /platform default/.test(bad.games["rickshaw-1"].from.time_zone));
  const later = buildRegister({ games: [{ slug: "rickshaw-1", repo: "o/r", tag: "day-4", sha: "e".repeat(40), settings: { "game.timezone": PT } }], hostTz: PT, now: NOW, deadlineHour: 4, graceMinutes: 45 });
  check("a changed deadline (4:00 + 45 minutes) moves the close to 04:45; the last 2-minute slot is 04:44", later.games["rickshaw-1"].window.closes === "04:45" && has(later.entries, 4, 44) && !has(later.entries, 4, 46) && !has(later.entries, 2, 30) === false);
  check("the same inputs give the same entries whatever the date (the horizon covers every daylight-saving change)", JSON.stringify(buildRegister({ games: [{ slug: "rickshaw-1", repo: "o/r", tag: "day-3", sha: "a".repeat(40), settings: { "game.timezone": PT } }], hostTz: PT, now: Date.parse("2027-06-15T12:00:00Z") }).entries) === JSON.stringify(reg.entries));
}

console.log("the plist");
{
  const reg = buildRegister({ games: [{ slug: "rickshaw-1", repo: "busterbenson/promptocracy-rickshaw", tag: "day-3", sha: "a".repeat(40), settings: { "game.timezone": PT } }], hostTz: PT, now: NOW });
  const live = readFileSync(join(ROOT, "moderator", "com.chalant.promptocracy-moderator.plist"), "utf8");
  const block = scheduleBlock(reg);
  check("the block has one StartCalendarInterval dict per entry, and no double hyphen inside the comment (invalid XML)", (block.match(/<dict>/g) ?? []).length === 92 && !/--/.test(block.replace(/<!--|-->/g, "")), block.slice(0, 400));
  check("the committed plist's schedule is what the generator makes for Rickshaw on a Pacific mini (so a changed constant shows up here)", live.includes(block) && !/<key>StartInterval<\/key>/.test(live), "run: node moderator/schedule.mjs --plist moderator/com.chalant.promptocracy-moderator.plist --dry-run, or regenerate it");
  const old = '<plist><dict>\n    <key>Label</key>\n    <string>x</string>\n    <key>StartInterval</key>\n    <integer>120</integer>\n    <key>Other</key>\n    <string>y</string>\n</dict></plist>\n';
  const once = applySchedule(old, block);
  check("applySchedule replaces StartInterval with the block and keeps the rest", !/StartInterval/.test(once) && /StartCalendarInterval/.test(once) && /<key>Other<\/key>/.test(once) && /<key>Label<\/key>/.test(once));
  const again = applySchedule(once, block);
  check("applying the same block again changes nothing (idempotent)", again === once);
  const other = applySchedule(once, scheduleBlock(buildRegister({ games: [{ slug: "r", repo: "o/r", tag: "day-1", sha: "a".repeat(40), settings: { "game.timezone": "America/New_York" } }], hostTz: PT, now: NOW })));
  check("a different schedule replaces the marked block whole, not appended", (other.match(/schedule:begin/g) ?? []).length === 1 && (other.match(/<key>StartCalendarInterval<\/key>/g) ?? []).length === 1 && /<key>Hour<\/key><integer>21<\/integer>/.test(other) && !/<key>Hour<\/key><integer>12<\/integer>/.test(other) && !/<key>Hour<\/key><integer>2<\/integer><key>Minute<\/key><integer>30/.test(other));
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
  check("first run: StartInterval becomes the calendar schedule, and the job is reloaded", r1.changed && r1.reloaded && reloads === 1 && !/StartInterval/.test(readFileSync(plist, "utf8")) && (readFileSync(plist, "utf8").match(/<dict><key>Hour/g) ?? []).length === 92);
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
  check("reloadJob: a loaded job is reloaded by a detached helper that waits first (the caller runs inside the job)", reloadJob({ plist: "/x/it's.plist", uid: 501, loaded: () => true, spawnFn }) === true && spawned === 1 && opts.o.detached === true && /^sleep \d+; \/bin\/launchctl bootout gui\/501\/com\.chalant\.promptocracy-moderator; \/bin\/launchctl bootstrap gui\/501 '\/x\/it'\\''s\.plist'$/.test(opts.args[1]), opts?.args?.[1]);
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
