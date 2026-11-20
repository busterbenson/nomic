// The page structure (step 1, the chrome PR): header, board band and move bar, players, the book (Summary, Rulebook, Catalog,
// History), the rule card with its Back stack, the player card, the account menu and the bell. A real `wrangler dev` on a
// throwaway LOCAL D1 and headless Chromium (tests/browser-chrome.py). The rules come from templates/RULES.md through a local stub.
// Set CHROME_SHOTS=<dir> to keep the screenshots (light and dark, 1280 and 390). Run: node tests/chrome.mjs
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { ROOT, createGame, d1, join, migrate, newState, startPlaying, startRulesStub, startServer } from "./lib.mjs";

const shots = process.env.CHROME_SHOTS || "";
if (shots) mkdirSync(shots, { recursive: true });
// random ports: other agents and test runs on this machine use the fixed ones
const PORT = 19000 + Math.floor(Math.random() * 900) * 2;
const state = newState();
let srv = null, stub = null, failed = false;
try {
  migrate(state);
  const rules = readFileSync(ROOT + "/templates/RULES.md", "utf8");
  stub = await startRulesStub(PORT, { "/busterbenson/chrome-game/main/RULES.md": rules });   // both games read the same stub path
  const g = await createGame(state, { slug: "chrome", name: "Chrome Game", repo: "busterbenson/chrome-game", rulesBase: stub.base });
  d1(state, "CREATE TABLE IF NOT EXISTS dev_controls (key TEXT PRIMARY KEY, value TEXT)");
  srv = await startServer(state, PORT + 1, ["DEV_MODE=1", `RULES_BASE_URL=${stub.base}`]);
  const ada = await join(srv.base, "chrome", g.code, { email: "ada@example.com", name: "Ada", color: "teal" });
  const bo = await join(srv.base, "chrome", g.code, { email: "bo@example.com", name: "Bo", color: "vermilion" });
  const cy = await join(srv.base, "chrome", g.code, { email: "cy@example.com", name: "Cy", color: "cobalt" });
  startPlaying(state, "chrome");
  const gid = d1(state, "SELECT id FROM games WHERE slug = 'chrome'")[0].id;
  // Ada one step inside the island's east edge (x 2); Bo near the middle; Cy north
  d1(state, `UPDATE players SET x = 2, y = 0 WHERE game_id = '${gid}' AND turn_order = 0`);
  d1(state, `UPDATE players SET x = -1, y = -1 WHERE game_id = '${gid}' AND turn_order = 1`);
  d1(state, `UPDATE players SET x = 0, y = 2 WHERE game_id = '${gid}' AND turn_order = 2`);
  // two proposals on today's ballot: a clause for 401 (Bo) and a new rule for block 400 (Cy), as the midnight roll would leave them
  const p1 = await bo.post("/chrome/api/turn", { kind: "addclause", target: "401", words: "Points are whole numbers." });
  const p2 = await cy.post("/chrome/api/turn", { kind: "add", target: "400", words: "A tie goes to the older player." });
  if (p1.status !== 200 || p2.status !== 200) throw new Error("fixture proposals: " + p1.text + " " + p2.text);
  // the midnight roll: day 1 is over, day 2 is open, and both proposals are on its ballot
  d1(state, `UPDATE proposals SET status = 'on_ballot' WHERE game_id = '${gid}' AND status = 'confirmed'`);
  d1(state, `UPDATE days SET status = 'done' WHERE game_id = '${gid}' AND n = 1; UPDATE games SET day = 2 WHERE id = '${gid}'; INSERT INTO days (game_id, n, starts_at, ends_at, status) VALUES ('${gid}', 2, '2000-01-02T00:00:00.000Z', '${new Date(Date.now() + (7 * 60 + 41) * 60000).toISOString()}', 'open')`);   // 7 h 41 m left: far from the midnight lock for the length of a run
  // a second game still being set up (one player, not started), seen by nobody logged in
  const open = await createGame(state, { slug: "setup", name: "Setting Up", repo: "busterbenson/chrome-game", rulesBase: stub.base });
  await join(srv.base, "setup", open.code, { email: "dee@example.com", name: "Dee", color: "marigold" });
  // a game where two players share a name (joining does not need unique names): one has ended their turn, the other has not
  const dup = await createGame(state, { slug: "dupes", name: "Same Names", repo: "busterbenson/chrome-game", rulesBase: stub.base });
  const sam1 = await join(srv.base, "dupes", dup.code, { email: "sam1@example.com", name: "Sam", color: "teal" });
  const sam2 = await join(srv.base, "dupes", dup.code, { email: "sam2@example.com", name: "Sam", color: "vermilion" });
  startPlaying(state, "dupes");
  const e = await sam2.post("/dupes/api/end-turn", {});
  if (e.status !== 200) throw new Error("end turn: " + e.text);
  const samCookie = [...sam1.jar].find(([k]) => k === "s|/dupes")[1];
  const cookie = [...ada.jar].find(([k]) => k === "s|/chrome")[1];
  if (process.env.CHROME_SERVE) { console.log("SERVE", srv.base, cookie); await new Promise((res) => setTimeout(res, Number(process.env.CHROME_SERVE) * 1000)); }   // for debugging: keep the fixture up
  const r = await promisify(execFile)("/usr/local/bin/python3", [ROOT + "/tests/browser-chrome.py", srv.base, shots || "-", cookie, samCookie], { timeout: 240000, maxBuffer: 1 << 24 });
  process.stdout.write(r.stdout);
} catch (e) {
  failed = true;
  if (e.stdout) process.stdout.write(e.stdout);
  console.log("  FAIL  " + (e.stderr || e.message));
} finally {
  await srv?.stop(); await stub?.stop();
  try { rmSync(state, { recursive: true, force: true }); } catch {}
}
process.exit(failed ? 1 : 0);
