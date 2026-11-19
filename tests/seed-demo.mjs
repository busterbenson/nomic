// Seeds two local games (one in play with two players, one open for joining) and
// takes screenshots with playwright (python). Rules come from templates/RULES.md
// through a local stub, never GitHub. Usage: node tests/seed-demo.mjs <outdir>
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { createGame, d1, join, migrate, newState, startRulesStub, startServer, COLORS, ROOT } from "./lib.mjs";

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
  const ada = await join(srv.base, "first", g.code, { email: "ada@example.com", name: "Ada", color: "teal" });
  await join(srv.base, "first", g.code, { email: "bo@example.com", name: "Bo", color: "vermilion" });
  await join(srv.base, "second", open.code, { email: "cy@example.com", name: "Cy", color: "cobalt" });
  await join(srv.base, "second", open.code, { email: "dee@example.com", name: "Dee", color: "marigold" });
  // in play, Ada's turn; her piece one step inside the island's east edge (x 2; the island is x -4..3), Bo's near the center
  const gid = d1(state, "SELECT id FROM games WHERE slug = 'first'")[0].id;
  d1(state, "UPDATE games SET status = 'playing', round = 1, turn = 0, last_move = '' WHERE slug = 'first'");
  d1(state, `UPDATE players SET x = 2, y = 0 WHERE game_id = '${gid}' AND turn_order = 0`);
  d1(state, `UPDATE players SET x = -1, y = -1 WHERE game_id = '${gid}' AND turn_order = 1`);
  const cookie = [...ada.jar].find(([k]) => k === "s|/first")[1];
  // async: a blocked event loop would stop the rules stub answering the Worker, and the board would say "Rules unavailable"
  const r = await promisify(execFile)("/usr/local/bin/python3", [ROOT + "/tests/screenshot.py", srv.base, out, cookie, open.code], { timeout: 180000 });
  process.stdout.write(r.stdout);
} finally {
  await srv?.stop(); await stub?.stop();
  try { rmSync(state, { recursive: true, force: true }); } catch {}
}
