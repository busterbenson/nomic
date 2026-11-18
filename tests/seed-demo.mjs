// Seeds two local games (one in play with two players, one open for joining) and
// takes screenshots with playwright (python). Rules come from templates/RULES.md
// through a local stub, never GitHub. Usage: node tests/seed-demo.mjs <outdir>
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { createGame, d1, join, migrate, newState, startRulesStub, startServer, MARKERS, ROOT } from "./lib.mjs";

const out = process.argv[2];
if (!out) { console.error("usage: node tests/seed-demo.mjs <outdir>"); process.exit(1); }
mkdirSync(out, { recursive: true });
const state = newState();
let srv, stub;
try {
  migrate(state);
  const rules = readFileSync(ROOT + "/templates/RULES.md", "utf8");
  stub = await startRulesStub(8896, { "/busterbenson/first-game/main/RULES.md": rules, "/busterbenson/second-game/main/RULES.md": rules });
  const R = { rulesBase: stub.base };
  const g = await createGame(state, { slug: "first", name: "Game one", repo: "busterbenson/first-game", ...R });
  const open = await createGame(state, { slug: "second", name: "Game two", repo: "busterbenson/second-game", ...R });
  srv = await startServer(state, 8793, ["DEV_MODE=1", `RULES_BASE_URL=${stub.base}`]);
  const ada = await join(srv.base, "first", g.code, { email: "ada@example.com", name: "Ada", marker: MARKERS[0] });
  await join(srv.base, "first", g.code, { email: "bo@example.com", name: "Bo", marker: MARKERS[1] });
  await join(srv.base, "second", open.code, { email: "cy@example.com", name: "Cy", marker: MARKERS[2] });
  d1(state, "UPDATE players SET score = 30 WHERE marker = '" + MARKERS[0] + "'");
  d1(state, "UPDATE players SET score = 55 WHERE marker = '" + MARKERS[1] + "'");
  d1(state, "UPDATE games SET status = 'playing', round = 1, turn = 0 WHERE slug = 'first'");
  const cookie = [...ada.jar].find(([k]) => k === "s|/first")[1];
  // async: a blocked event loop would stop the rules stub answering the Worker, and the board would say "Rules unavailable"
  const r = await promisify(execFile)("/usr/local/bin/python3", [ROOT + "/tests/screenshot.py", srv.base, out, cookie, open.code], { timeout: 180000 });
  process.stdout.write(r.stdout);
} finally {
  await srv?.stop(); await stub?.stop();
  try { rmSync(state, { recursive: true, force: true }); } catch {}
}
