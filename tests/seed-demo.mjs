// Seeds a local game with two players and takes screenshots with playwright
// (python). Usage: node tests/seed-demo.mjs <outdir>
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { createGame, d1, join, migrate, newState, startServer, MARKERS } from "./lib.mjs";
import { ROOT } from "./lib.mjs";

const out = process.argv[2];
if (!out) { console.error("usage: node tests/seed-demo.mjs <outdir>"); process.exit(1); }
mkdirSync(out, { recursive: true });
const state = newState();
let srv;
try {
  migrate(state);
  const g = createGame(state, { name: "Nomic, game 1" });
  srv = await startServer(state, 8793, ["DEV_MODE=1"]);
  const ada = await join(srv.base, g.code, { email: "ada@example.com", name: "Ada", marker: MARKERS[0] });
  await join(srv.base, g.code, { email: "bo@example.com", name: "Bo", marker: MARKERS[1] });
  d1(state, "UPDATE players SET score = 30 WHERE marker = '" + MARKERS[0] + "'");
  d1(state, "UPDATE players SET score = 55 WHERE marker = '" + MARKERS[1] + "'");
  d1(state, "UPDATE games SET status = 'playing', round = 1, turn = 1");
  const cookie = ada.cookie.split("=")[1];
  execFileSync("/usr/local/bin/python3", [ROOT + "/tests/screenshot.py", srv.base, out, cookie, g.code], { stdio: "inherit", timeout: 120000 });
} finally {
  await srv?.stop();
  try { rmSync(state, { recursive: true, force: true }); } catch {}
}
