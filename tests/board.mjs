// The blank-slate board: compass labels and geometry, what a move charts, migration 0002 on a database with
// data, settings, piece colors, spawning, the move action, and the public board API.
// Run: npm test (after e2e.mjs). Real `wrangler dev`, LOCAL D1 only.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, readFileSync as readText } from "node:fs";
import { tmpdir } from "node:os";
import { join as pjoin } from "node:path";
import { ROOT, COLORS, client, createGame, d1, finish, join, migrate, newState, startRulesStub, startServer } from "./lib.mjs";
import { chartOffsets, chartedAround, coordLabel, diagonals, islandCoords, tileLabel, neighbors, parseLabel, validCoord, withinSteps, xLabel, yLabel, zLabel } from "../src/lib/geometry.js";
import { DEFAULT_SETTINGS, getSettings, settingsForSize, spawnSpots, validateSettings } from "../src/lib/settings.js";
import { DIAGONAL_MOVES, SHARED_TILES } from "../src/lib/board-rules.js";
import { PROPOSAL_INSERT_SQL } from "../src/lib/proposal.js";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "  -> " + detail : ""}`); }
};
const J = JSON.stringify;

// ---------------------------------------------------------------- labels
console.log("labels");
check("columns: ... 3W 2W 1W | 1E 2E 3E ..., with no zero (x -1 is 1W, x 0 is 1E)", [-3, -2, -1, 0, 1, 2].map(xLabel).join() === "3W,2W,1W,1E,2E,3E");
check("rows: ... 2N 1N | 1S 2S ... (y 0 is 1N, y -1 is 1S, north is up)", [2, 1, 0, -1, -2].map(yLabel).join() === "3N,2N,1N,1S,2S");
check("the seams: 1W and 1E are neighbours (x -1, 0), and so are 1N and 1S (y 0, -1)", xLabel(-1) === "1W" && xLabel(0) === "1E" && yLabel(0) === "1N" && yLabel(-1) === "1S" && J(parseLabel("1N 1W")) === '{"x":-1,"y":0,"z":0}' && J(parseLabel("1S 1E")) === '{"x":0,"y":-1,"z":0}');
check("a tile reads row first, then column: 3N 2E is x 1, y 2", coordLabel(1, 2) === "3N 2E" && J(parseLabel("3N 2E")) === '{"x":1,"y":2,"z":0}');
check("the four center tiles are 1N 1W, 1N 1E, 1S 1W, 1S 1E", [[-1, 0], [0, 0], [-1, -1], [0, -1]].map(([x, y]) => coordLabel(x, y)).join() === "1N 1W,1N 1E,1S 1W,1S 1E");
check("big values: x 999999 is 1000000E, y -1000000 is 1000000S, and back", xLabel(999999) === "1000000E" && yLabel(-1000000) === "1000000S" && J(parseLabel("1000000S 1000000W")) === '{"x":-1000000,"y":-1000000,"z":0}' && coordLabel(-1000000, 999999) === "1000000N 1000000W");
let rt = true;
for (const x of [-1000000, -12345, -100, -9, -2, -1, 0, 1, 2, 9, 100, 12345, 999999]) for (const y of [-1000000, -777, -2, -1, 0, 1, 2, 9, 4321, 999999]) { const p = parseLabel(coordLabel(x, y)); if (!p || p.x !== x || p.y !== y) rt = false; }
check("label <-> integers round-trips across negative, zero-adjacent and big values", rt);
check("labels are case-insensitive and tolerate extra spaces", J(parseLabel("3n 2e")) === '{"x":1,"y":2,"z":0}' && J(parseLabel("  4S   4W ")) === '{"x":-4,"y":-4,"z":0}');
check("things that are not labels are refused (there is no zero row or column; column first is not a label)", ["", "0N 1E", "1N 0E", "0S 0W", "2E 3N", "3N", "3N2E", "N3 E2", "3X 2E", "-1N 1E", "1N 1E 1", "01N 1E", "99999999N 1E", null, undefined, 4, {}].every((v) => parseLabel(v) === null));
check("levels skip zero too: ground (z 0) is 1U, z 1 is 2U, z -1 is 1D, z -2 is 2D (the 1U/1D seam)", [-2, -1, 0, 1, 2].map(zLabel).join() === "2D,1D,1U,2U,3U" && tileLabel(1, 2, 0) === "3N 2E 1U" && tileLabel(-1, -1, -1) === "1S 1W 1D");
check("a label may carry its level: 3N 2E 1U is z 0, 3N 2E 2U is z 1, 3N 2E 1D is z -1; without one it is the ground", J(parseLabel("3N 2E 1U")) === '{"x":1,"y":2,"z":0}' && J(parseLabel("3n 2e 2u")) === '{"x":1,"y":2,"z":1}' && J(parseLabel("3N 2E 1D")) === '{"x":1,"y":2,"z":-1}' && parseLabel("3N 2E 0U") === null && parseLabel("3N 2E 1X") === null && J(parseLabel(tileLabel(5, -6, -3))) === '{"x":5,"y":-6,"z":-3}');
check("coordinates are plain integers up to a million, z included", validCoord(0, 0) && validCoord(-1000000, 1000000, 0) && !validCoord(1000001, 0) && !validCoord(0.5, 0) && !validCoord(0, 0, 1.5) && !validCoord("1", 0) && !validCoord(0, 0, 2000000));
check("neighbours: four orthogonal, four diagonal, kept apart", J(neighbors(2, 3)) === "[[3,3],[2,4],[1,3],[2,2]]" && J(diagonals(2, 3)) === "[[3,4],[1,4],[1,2],[3,2]]");

// ---------------------------------------------------------------- the island, charting, moving
console.log("geometry");
const isl = islandCoords(8, 8);
const L = (x, y) => coordLabel(x, y);
check("the starting island is 8x8 = 64 tiles centered on the origin: columns 4W..4E, rows 4N..4S", isl.length === 64 && new Set(isl.map((c) => c + "")).size === 64 &&
  Math.min(...isl.map((c) => c[0])) === -4 && Math.max(...isl.map((c) => c[0])) === 3 && Math.min(...isl.map((c) => c[1])) === -4 && Math.max(...isl.map((c) => c[1])) === 3 &&
  L(-4, 3) === "4N 4W" && L(3, -4) === "4S 4E" && L(-4, -4) === "4S 4W" && L(3, 3) === "4N 4E");
check("other even sizes are centered too (4x4: 2W..2E, 2N..2S; 12x6)", islandCoords(4, 4).length === 16 && L(-2, 1) === "2N 2W" && Math.max(...islandCoords(12, 6).map((c) => c[0])) === 5 && Math.min(...islandCoords(12, 6).map((c) => c[1])) === -3);
const off = chartOffsets(2);
check("a move charts exactly 21 offsets: the 5x5 square without its 4 corners", off.length === 21 && new Set(off.map((o) => o + "")).size === 21);
check("the four corners (+-2, +-2) are excluded, every other tile of the 5x5 square is in", [[2, 2], [-2, 2], [2, -2], [-2, -2]].every(([a, b]) => !off.some(([x, y]) => x === a && y === b)) && off.every(([x, y]) => Math.abs(x) <= 2 && Math.abs(y) <= 2) && off.some(([x, y]) => x === 2 && y === 1) && off.some(([x, y]) => x === 0 && y === -2) && off.some(([x, y]) => x === 0 && y === 0));
check("it is the tiles with centers within Euclidean distance 2.5 of the piece", off.every(([x, y]) => Math.hypot(x, y) <= 2.5) && (() => { let n = 0; for (let x = -4; x <= 4; x++) for (let y = -4; y <= 4; y++) if (Math.hypot(x, y) <= 2.5) n++; return n === 21; })());
check("chartedAround is that shape at a position, in the plain integers (across the 1W/1E seam too)", chartedAround(0, 0, 2).length === 21 && chartedAround(-1, -1, 2).some(([x, y]) => x === 1 && y === 0) && J(chartedAround(5, -7, 2).slice(0, 2)) === J([[4, -9], [5, -9]]) && chartOffsets(1).length === 9 - 0 && chartOffsets(3).length === 37);
check("one step, with diagonals (P1, decided): all 8 neighbours, nothing two away, never the same tile", DIAGONAL_MOVES === true &&
  [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]].every(([dx, dy]) => withinSteps(0, 0, dx, dy, 1)) &&
  [[2, 0], [0, 2], [2, 1], [2, 2], [-2, 0], [0, 0]].every(([dx, dy]) => !withinSteps(0, 0, dx, dy, 1)));
check("1W -> 1E and 1N -> 1S are one step (computed on the plain integers)", withinSteps(-1, 0, 0, 0, 1) && withinSteps(0, 0, 0, -1, 1) && withinSteps(-1, 0, 0, -1, 1) && !withinSteps(-1, 0, 1, 0, 1));
check("without diagonals (the switch) only N, S, E, W count, and a larger distance reaches further", !withinSteps(0, 0, 1, 1, 1, false) && withinSteps(0, 0, 1, 0, 1, false) && withinSteps(0, 0, 2, 0, 2) && !withinSteps(0, 0, 3, 0, 2));
check("the decided questions are pinned: P1 diagonals yes, P2 sharing a tile no", DIAGONAL_MOVES === true && SHARED_TILES === false);

// ---------------------------------------------------------------- migration 0002 on a database with data
console.log("migration 0002");
{
  const st = newState(), cfgDir = mkdtempSync(pjoin(tmpdir(), "promptocracy-mig-"));
  try {
    mkdirSync(pjoin(cfgDir, "m"));
    copyFileSync(pjoin(ROOT, "migrations/0001_init.sql"), pjoin(cfgDir, "m/0001_init.sql"));
    const cfg = pjoin(cfgDir, "wrangler.toml");
    writeFileSync(cfg, `name = "mig"\nmain = "${ROOT}/src/index.ts"\ncompatibility_date = "2026-11-01"\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "promptocracy"\ndatabase_id = "639f045e-df2d-406e-91a4-a1facc4ca2fe"\nmigrations_dir = "${cfgDir}/m"\n`);
    const W = pjoin(ROOT, "node_modules/.bin/wrangler");
    const run = (args) => execFileSync(W, [...args, "--config", cfg, "--local", "--persist-to", st], { cwd: cfgDir, encoding: "utf8", timeout: 60000, env: { ...process.env, CI: "1", NO_COLOR: "1", WRANGLER_SEND_METRICS: "false" } });
    run(["d1", "migrations", "apply", "DB"]); // 0001 only
    const sql = (s) => JSON.parse(run(["d1", "execute", "DB", "--json", "--command", s]).replace(/^[^[]*/, ""))[0].results;
    sql(`INSERT INTO games (id, slug, name, repo, join_code, status, created_at) VALUES ('g1','old','Old','a/b','AAAA2222','playing','2026-01-01T00:00:00Z')`);
    for (const [i, n] of ["ada", "bo", "cy"].entries()) {
      sql(`INSERT INTO players (id, game_id, email, display_name, marker, color, score, turn_order, joined_at) VALUES ('p${i}','g1','${n}@x.test','${n}','m${i}','#abcdef',${i * 10},${i},'2026-01-01T00:00:00Z')`);
      sql(`INSERT INTO sessions (id_hash, game_id, player_id, created_at, expires_at) VALUES ('s${i}','g1','p${i}','2026-01-01T00:00:00Z','2099-01-01T00:00:00Z')`);
      sql(`INSERT INTO notifications (id, game_id, player_id, kind, body, created_at) VALUES ('n${i}','g1','p${i}','k','b','2026-01-01T00:00:00Z')`);
    }
    sql(`INSERT INTO turns (id, game_id, player_id, round, turn_index, prompt, created_at, updated_at) VALUES ('t1','g1','p1',1,1,'hi','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`);
    sql(`INSERT INTO login_tokens (token_hash, game_id, email, purpose, display_name, marker, created_at, expires_at) VALUES ('h1','g1','new@x.test','join','New','m3','2026-01-01T00:00:00Z','2099-01-01T00:00:00Z')`);
    copyFileSync(pjoin(ROOT, "migrations/0002_island_board.sql"), pjoin(cfgDir, "m/0002_island_board.sql"));
    run(["d1", "migrations", "apply", "DB"]); // 0002 on top of data
    const players = sql("SELECT id, color, score, turn_order FROM players ORDER BY turn_order");
    check("existing players keep ids, scores and order, and get palette colors in turn order",
      JSON.stringify(players) === JSON.stringify([{ id: "p0", color: "vermilion", score: 0, turn_order: 0 }, { id: "p1", color: "saffron", score: 10, turn_order: 1 }, { id: "p2", color: "moss", score: 20, turn_order: 2 }]), JSON.stringify(players));
    check("the marker column is gone", !sql("SELECT name FROM pragma_table_info('players')").some((c) => c.name === "marker") && !sql("SELECT name FROM pragma_table_info('login_tokens')").some((c) => c.name === "marker"));
    check("sessions, notifications and turns still point at their players",
      sql("SELECT COUNT(*) AS n FROM sessions s JOIN players p ON p.id = s.player_id AND p.game_id = s.game_id")[0].n === 3 &&
      sql("SELECT COUNT(*) AS n FROM notifications")[0].n === 3 && sql("SELECT COUNT(*) AS n FROM turns")[0].n === 1);
    check("foreign keys are intact after the rebuild", sql("PRAGMA foreign_key_check").length === 0);
    check("the existing game got its seat limit as a setting (the old column's 5; every other default applies) and an empty last-move marker; unused join links were voided",
      sql("SELECT settings FROM games")[0].settings === '{"max_players":5}' && sql("SELECT last_move FROM games")[0].last_move === "" && sql("SELECT COUNT(*) AS n FROM login_tokens")[0].n === 0);
    let dup = "ok"; try { sql(`INSERT INTO players (id, game_id, email, display_name, color, turn_order, joined_at, x, y) VALUES ('px','g1','x@x.test','x','vermilion',9,'2026-01-01T00:00:00Z',0,0)`); } catch { dup = "refused"; }
    check("the new table keeps one color per player per game", dup === "refused");
    const t = sql("SELECT x, y, z FROM tiles WHERE game_id = 'g1'");
    check("the existing game's 8x8 island is charted: columns x -4..3 (4W..4E), rows y -4..3 (4N..4S), all on the ground",
      t.length === 64 && t.every((u) => u.x >= -4 && u.x <= 3 && u.y >= -4 && u.y <= 3 && u.z === 0) && new Set(t.map((u) => u.x + "," + u.y)).size === 64);
    const pos = sql("SELECT x, y, z FROM players ORDER BY turn_order");
    check("every existing player is placed on a distinct charted tile", new Set(pos.map((u) => u.x + "," + u.y)).size === 3 && pos.every((u) => t.some((v) => v.x === u.x && v.y === u.y && u.z === 0)), JSON.stringify(pos));
    check("tiles have no property columns at all", JSON.stringify(sql("SELECT name FROM pragma_table_info('tiles') ORDER BY cid").map((c) => c.name)) === '["game_id","x","y","z","charted_at"]');
    let dupTile = "ok"; try { sql(`INSERT INTO tiles (game_id, x, y, z, charted_at) VALUES ('g1',0,0,0,'t')`); } catch { dupTile = "refused"; }
    check("a tile exists once per game and place", dupTile === "refused");
  } catch (e) { fail++; console.log("  FAIL  migration harness:", String(e.stdout || "") + String(e.stderr || "") + (e.stack || e)); }
  finally { for (const d of [st, cfgDir]) { try { rmSync(d, { recursive: true, force: true }); } catch {} } }
}


// ---------------------------------------------------------------- settings
console.log("settings");
check("the default settings are valid; they are the seat limit, the island size, the chart radius and the move distance, nothing else", validateSettings(DEFAULT_SETTINGS).length === 0 && validateSettings(settingsForSize(16, 12)).length === 0 && J(Object.keys(DEFAULT_SETTINGS)) === '["max_players","board.island","board.chart_radius","turn.move_distance"]' && DEFAULT_SETTINGS.max_players === 8 && DEFAULT_SETTINGS["board.island"].width === 8 && DEFAULT_SETTINGS["board.chart_radius"] === 2 && DEFAULT_SETTINGS["turn.move_distance"] === 1);
const bad = (k, v) => validateSettings({ ...DEFAULT_SETTINGS, [k]: v }).length > 0;
check("seats must fit the island: max_players above the spawn spots is refused (8x8 radius 2 leaves 16; 6x6 leaves 4; radius 3 on 8x8 leaves 4)", spawnSpots(8, 8, 2) === 16 && spawnSpots(6, 6, 2) === 4 && spawnSpots(8, 8, 3) === 4 && spawnSpots(4, 4, 2) === 0 && validateSettings(settingsForSize(6, 6)).length === 1 && /spawn spots/.test(validateSettings(settingsForSize(6, 6))[0]) && validateSettings(settingsForSize(6, 6, 4)).length === 0 && validateSettings({ ...DEFAULT_SETTINGS, max_players: 5, "board.chart_radius": 3 }).length === 1 && validateSettings({ ...DEFAULT_SETTINGS, max_players: 4, "board.chart_radius": 3 }).length === 0);
check("bad values are refused: odd or tiny sizes, radii, distances, extra keys", bad("board.island", { width: 3, height: 8 }) && bad("board.island", { width: 7, height: 8 }) && bad("board.island", { width: 8 }) && bad("board.island", { width: 8, height: 8, depth: 1 }) && bad("board.chart_radius", 0) && bad("board.chart_radius", 2.5) && bad("max_players", 0) && bad("max_players", 9) && bad("max_players", 2.5) && bad("turn.move_distance", 0) && bad("turn.move_distance", "1") && validateSettings({ ...DEFAULT_SETTINGS, mystery: 1 }).length > 0);
check("a game's stored settings override only what they name; an invalid stored value falls back to the default",
  getSettings({ "turn.move_distance": 2 })["turn.move_distance"] === 2 && getSettings({ "turn.move_distance": 2 })["board.chart_radius"] === 2 && getSettings({ "turn.move_distance": "far" })["turn.move_distance"] === 1 && getSettings("not json")["board.island"].width === 8 && getSettings(null)["board.chart_radius"] === 2 && getSettings({ nope: 1 }).nope === undefined);
check("settings named __proto__ or constructor are ignored, not thrown on", (() => { try { const s = getSettings(JSON.parse('{"__proto__":{"x":1},"constructor":{"y":2}}')); return s["board.island"].width === 8; } catch { return false; } })());
const rulesText = readText(pjoin(ROOT, "templates/RULES.md"), "utf8");
const named = [...rulesText.matchAll(/\[setting: ([^\]]+)\]/g)].flatMap((m) => m[1].split(",").map((n) => n.trim()));
const inRules = new Set(named), inCode = new Set(Object.keys(DEFAULT_SETTINGS));
check("every [setting: x] named in templates/RULES.md exists in the default settings", named.length > 0 && [...inRules].every((n) => inCode.has(n)), [...inRules].filter((n) => !inCode.has(n)).join());
check("and every default setting is named in templates/RULES.md", [...inCode].every((n) => inRules.has(n)), [...inCode].filter((n) => !inRules.has(n)).join());
check("the rules keep 201 to 206 and replace the old 207 to 212 with a Board and a Turn section (plus the player limit)", ["201.", "202.", "203.", "204.", "205.", "206.", "207. The Board.", "208. The Turn.", "209. Players."].every((h) => rulesText.includes("**" + h)) && !/\*\*(210|211|212)\./.test(rulesText) && !/claim|harvest|terrain|meadow|forest|owner/i.test(rulesText.slice(rulesText.indexOf("**207."))));
const wrapped = rulesText.replace(/\s+/g, " ");
const must = ["is infinite", "charted or uncharted", "8x8 charted island centered on the origin", "3N 2E", "no zero row or column", "5x5 square with its four corners cut off", "random unoccupied charted tile at least 2.5 tiles from any uncharted tile", "visible to everyone", "propose one rule change", "diagonals included", "at most once per turn", "no other piece stands on", "seats at most 8 players"];
check("the rules say what Buster decided: infinite grid, charted/uncharted, 8x8 centered island, 3N 2E, no zero, 5x5 minus corners, random unoccupied start 2.5 from uncharted, visible to everyone, propose and move, diagonals, once per turn, 8 players", must.every((w) => wrapped.includes(w)), must.filter((w) => !wrapped.includes(w)).join(" | "));

// ---------------------------------------------------------------- the running site
const state = newState();
let srv, stub;
const gidOf = (slug) => d1(state, `SELECT id FROM games WHERE slug = '${slug}'`)[0].id;
const tilesOf = (slug) => d1(state, `SELECT x, y, z FROM tiles WHERE game_id = '${gidOf(slug)}'`);
const playersOf = (slug) => d1(state, `SELECT display_name AS name, x, y, z, turn_order FROM players WHERE game_id = '${gidOf(slug)}' ORDER BY turn_order`);
const tkey = (t) => `${t.x},${t.y},${t.z}`;
try {
  migrate(state);
  stub = await startRulesStub(8897, { "/busterbenson/hex/main/RULES.md": "# Rules\n" });
  const R = { rulesBase: stub.base, repo: "busterbenson/hex" };
  const g = await createGame(state, { slug: "hex", name: "Blank board", max: 3, ...R });
  const big = await createGame(state, { slug: "eight", name: "Eight", max: 8, size: 8, ...R });
  const prop = await createGame(state, { slug: "prop", name: "Proposals", max: 2, ...R });
  srv = await startServer(state, 8795, ["DEV_MODE=1", "SITE_URL=http://hex.test", `RULES_BASE_URL=${stub.base}`]);
  const A = srv.base;

  console.log("a new game");
  const row = d1(state, "SELECT settings FROM games WHERE slug = 'eight'")[0];
  check("a new game's row holds every board setting, written out, equal to the defaults", J(JSON.parse(row.settings)) === J(DEFAULT_SETTINGS) && validateSettings(JSON.parse(row.settings)).length === 0);
  check("it starts with no tiles stored: the island is charted the first time anything needs the board", tilesOf("hex").length === 0);
  const b0 = (await client(A).get("/hex/api/board")).data;
  const gridKeys = new Set(islandCoords(8, 8).map((c) => c[0] + "," + c[1]));
  check("reading the board charts the 8x8 island: 64 tiles, 4W..4E by 4N..4S, all on the ground", b0.tiles.length === 64 && b0.tiles.every((t) => t.z === 0 && gridKeys.has(t.x + "," + t.y)) && b0.tiles.some((t) => t.label === "4N 4W 1U") && b0.tiles.some((t) => t.label === "4S 4E 1U") && !b0.tiles.some((t) => /^0|\b0[NSEWUD]/.test(t.label)));
  check("again: it is charted once, not twice", tilesOf("hex").length === 64 && (await client(A).get("/hex/api/board")).data.tiles.length === 64);
  let seatsRefused = "";
  try { await createGame(state, { slug: "zzz", size: 6, ...R }); seatsRefused = "created"; } catch { seatsRefused = "refused"; }
  check("create-game refuses an island too small for the seats (--size 6 with the default 8 players), and accepts it with --max-players 4", seatsRefused === "refused" && (await createGame(state, { slug: "six", size: 6, max: 4, ...R })).slug === "six");
  let refused = "";
  for (const bad of ["3", "17", "x", "7", "5"]) { try { await createGame(state, { slug: "zzz", size: bad, ...R }); refused += "no "; } catch { refused += "yes "; } }
  check("create-game refuses an island size that is not an even number from 4 to 16", refused === "yes yes yes yes yes ", refused);
  let nine = "";
  try { await createGame(state, { slug: "nine", max: 9, ...R }); nine = "created"; } catch { nine = "refused"; }
  check("create-game refuses more than 8 players (there are 8 colors)", nine === "refused");

  console.log("piece colors and spawning");
  const page = await client(A).get(`/hex/join/${g.code}`);
  check("the join page offers all 8 colors as pieces, with their names", page.status === 200 && (page.text.match(/name="color"/g) || []).length === 8 && ["Vermilion", "Saffron", "Moss", "Teal", "Cobalt", "Violet", "Rose", "Graphite"].every((n) => page.text.includes(`<b>${n}</b>`)) && !page.text.includes('name="marker"'));
  const ana = await join(A, "hex", g.code, { email: "ana@example.com", name: "Ana", color: "teal" });
  const page2 = await client(A).get(`/hex/join/${g.code}`);
  check("a color someone took is shown as taken and cannot be picked", /value="teal"[^>]*disabled/.test(page2.text) && !/value="cobalt"[^>]*disabled/.test(page2.text) && page2.text.includes("<i>taken</i>"));
  const dupe = await client(A).post("/hex/api/join", { code: g.code, email: "x@example.com", name: "X", color: "teal" });
  check("joining with a taken color is refused (409)", dupe.status === 409 && /color/i.test(dupe.data.error), dupe.text);
  check("an unknown color is refused (400), and so is the old marker field", (await client(A).post("/hex/api/join", { code: g.code, email: "y@example.com", name: "Y", color: "puce" })).status === 400 && (await client(A).post("/hex/api/join", { code: g.code, email: "y@example.com", name: "Y", marker: "x" })).status === 400);
  const bo = await join(A, "hex", g.code, { email: "bo@example.com", name: "Bo", color: "cobalt" });
  const cy = await join(A, "hex", g.code, { email: "cy@example.com", name: "Cy", color: "rose" });
  const full = await client(A).post("/hex/api/join", { code: g.code, email: "d@example.com", name: "D", color: "moss" });
  check("max_players 3 is honoured", full.status === 409 && /full/i.test(full.data.error), full.text);
  await new Promise((r) => setTimeout(r, 800)); // emails are sent after the reply
  const outbox = d1(state, "SELECT subject, body FROM outbox").map((o) => o.subject + o.body).join("\n");
  check("the log and emails name players as 'Ana (Teal)'", outbox.includes("as Ana (Teal).") && outbox.includes("Bo (Cobalt) joined the game.") && (await client(A).get("/hex/api/game")).data.events.some((e) => e.text === "Cy (Rose) took a seat."), outbox.slice(0, 300));
  const me = await ana.get("/hex/api/me");
  check("/api/me carries the claimed color", me.data.player.color.key === "teal" && me.data.player.color.name === "Teal" && /^#[0-9a-f]{6}$/.test(me.data.player.color.hex) && !("marker" in me.data.player));
  const game = (await client(A).get("/hex/api/game")).data;
  check("/api/game players carry colors, not markers", game.players.every((p) => p.color?.key && !("marker" in p)) && game.players.map((p) => p.color.key).join() === "teal,cobalt,rose");
  const inner = new Set(islandCoords(8, 8).filter(([x, y]) => x >= -2 && x <= 1 && y >= -2 && y <= 1).map((c) => c[0] + "," + c[1]));
  const ps = playersOf("hex");
  check("the island leaves exactly 16 spawn spots (the inner 4x4, every tile whose whole chart shape is charted); each piece stands on one, on the ground, and no two share", inner.size === 16 && ps.length === 3 && ps.every((p) => p.z === 0 && inner.has(p.x + "," + p.y)) && new Set(ps.map((p) => p.x + "," + p.y)).size === 3, J(ps));
  check("spawning charts nothing: still the 64 island tiles", tilesOf("hex").length === 64);
  const eight = [];
  for (let i = 0; i < 8; i++) eight.push(await join(A, "eight", big.code, { email: `e${i}@example.com`, name: `E${i}`, color: COLORS[i] }));
  const ninth = await client(A).post("/eight/api/join", { code: big.code, email: "e9@example.com", name: "E9", color: "teal" });
  const p8 = playersOf("eight");
  check("eight players fit, with eight different colors and eight different tiles, and a ninth is turned away", ninth.status === 409 && p8.length === 8 && new Set(p8.map((p) => p.x + "," + p.y)).size === 8 && p8.every((p) => inner.has(p.x + "," + p.y)));
  check("the 9th join attempt fails with a clear message: 'This game is full.'", ninth.status === 409 && ninth.data.error === "This game is full." && d1(state, `SELECT COUNT(*) AS n FROM players WHERE game_id = '${gidOf("eight")}'`)[0].n === 8);
  check("the full join page offers no free piece", (await client(A).get(`/eight/join/${big.code}`)).text.includes("This game is full"));
  // the seat limit is enforced atomically when the link is finished: two people finishing for the last seat
  const last = await createGame(state, { slug: "last", max: 2, ...R });
  await join(A, "last", last.code, { email: "l0@example.com", name: "L0", color: "teal" });
  const lc1 = client(A), lc2 = client(A);
  const lj1 = await lc1.post("/last/api/join", { code: last.code, email: "l1@example.com", name: "L1", color: "cobalt" });
  const lj2 = await lc2.post("/last/api/join", { code: last.code, email: "l2@example.com", name: "L2", color: "rose" });
  const [lv1, lv2] = await Promise.all([finish(lc1, lj1.data.dev_link), finish(lc2, lj2.data.dev_link)]);
  const lloc = [lv1, lv2].map((v) => v.headers.get("location"));
  check("two people finishing for the last seat at once: exactly one gets it, the other is told the join failed", playersOf("last").length === 2 && lloc.filter((l) => l.includes("notice=joined")).length === 1 && lloc.filter((l) => l.includes("notice=join-failed")).length === 1, lloc.join());
  check("max_players is read from the game's settings, and nothing else caps seats", getSettings(d1(state, "SELECT settings FROM games WHERE slug = 'last'")[0].settings).max_players === 2 && getSettings(d1(state, "SELECT settings FROM games WHERE slug = 'eight'")[0].settings).max_players === 8);
  // spawn is random: over many fresh games the first piece does not always land on the same tile
  const spots = new Set();
  for (let i = 0; i < 6; i++) { const slug = `rnd${i}`; const gg = await createGame(state, { slug, max: 2, ...R }); await join(A, slug, gg.code, { email: "r@example.com", name: "R", color: "teal" }); const p = playersOf(slug)[0]; spots.add(p.x + "," + p.y); }
  check("spawn is random: six games put the first piece on more than one tile", spots.size > 1, [...spots].join(" "));
  // no room: an island too small to have a fully charted shape around any tile
  const tiny = await createGame(state, { slug: "tiny", max: 2, ...R });
  d1(state, `UPDATE games SET settings = '{"board.island":{"width":4,"height":4},"max_players":2}' WHERE slug = 'tiny'`);
  const tc = client(A);
  const tj = await tc.post("/tiny/api/join", { code: tiny.code, email: "t1@example.com", name: "T1", color: "teal" });
  const tv = await finish(tc, tj.data.dev_link);
  check("a game whose island is 4x4 has no spawn spot (settings edited by hand, since create-game refuses it): the join fails with the 'no room on the map yet' notice and takes no seat", tv.status === 303 && tv.headers.get("location") === "/tiny/?notice=no-room" && playersOf("tiny").length === 0, tv.headers.get("location"));
  // occupied spots: a 6x6 island has exactly 4 spawn spots; with the seat limit forced to 5 by hand, the 5th joiner has none left
  const one = await createGame(state, { slug: "one", max: 4, size: 6, ...R });
  d1(state, `UPDATE games SET settings = '{"board.island":{"width":6,"height":6},"max_players":5}' WHERE slug = 'one'`);
  for (let i = 0; i < 4; i++) await join(A, "one", one.code, { email: `o${i}@example.com`, name: `O${i}`, color: COLORS[i] });
  const oc = client(A), oj = await oc.post("/one/api/join", { code: one.code, email: "o9@example.com", name: "O9", color: "violet" });
  const ov = await finish(oc, oj.data.dev_link);
  check("all 4 spawn spots are occupied (two pieces cannot share): the 5th join fails with the no-room notice, and the first four stood on four different tiles", playersOf("one").length === 4 && new Set(playersOf("one").map((q) => q.x + "," + q.y)).size === 4 && ov.status === 303 && ov.headers.get("location") === "/one/?notice=no-room", ov.headers.get("location"));

  console.log("moves");
  const post = (c, body, slug = "hex") => c.post(`/${slug}/api/action`, body);
  const gameOf = async (slug = "hex") => (await client(A).get(`/${slug}/api/game`)).data.game;
  const posOf = (slug, n) => playersOf(slug)[n];
  const setPos = (slug, n, x, y, z = 0) => d1(state, `UPDATE players SET x = ${x}, y = ${y}, z = ${z} WHERE game_id = '${gidOf(slug)}' AND turn_order = ${n}`);
  const setTurn = (slug, turn = 0, moved = false, settings = "{}") => d1(state, `UPDATE games SET status = 'playing', round = 1, turn = ${turn}, last_move = '${moved ? `1:${turn}` : ""}', settings = '${settings}' WHERE slug = '${slug}'`);
  check("logged out is 401", (await post(client(A), { kind: "move", x: 0, y: 0 })).status === 401);
  const early = await post(ana, { kind: "move", x: 0, y: 0 });
  check("in setup, a move is refused (409) and nothing changes", early.status === 409 && /not started/i.test(early.data.error));
  setTurn("hex");
  setPos("hex", 0, 0, 0); setPos("hex", 1, 3, 3); setPos("hex", 2, -3, -3);
  check("an unknown kind is refused, including the removed claim and describe", (await post(ana, { kind: "teleport", x: 0, y: 0 })).status === 400 && (await post(ana, { kind: "claim", x: 0, y: 0 })).status === 400 && (await post(ana, { kind: "describe", x: 0, y: 0, name: "n", description: "d" })).status === 400 && (await post(ana, { x: 0, y: 0 })).status === 400);
  const oot = await post(bo, { kind: "move", x: 3, y: 2 });
  check("out of turn is refused (403) and the piece stays", oot.status === 403 && J([posOf("hex", 1).x, posOf("hex", 1).y]) === "[3,3]", oot.text);
  check("not a label, or a label with a zero row or column, is refused (400)", (await post(ana, { kind: "move", label: "0N 1E" })).status === 400 && (await post(ana, { kind: "move", label: "A1" })).status === 400 && (await post(ana, { kind: "move", x: 0.5, y: 0 })).status === 400 && (await post(ana, { kind: "move" })).status === 400);
  const far = await post(ana, { kind: "move", x: 2, y: 0 });
  check("two steps away is refused (400): the piece stays and no move is used", far.status === 400 && /step/.test(far.data.error) && posOf("hex", 0).x === 0 && (await gameOf()).moved === false, far.text);
  check("so is the tile you already stand on", (await post(ana, { kind: "move", x: 0, y: 0 })).status === 400);
  const lvl = await post(ana, { kind: "move", x: 1, y: 0, z: 1 });
  check("a different level is refused for now (400)", lvl.status === 400 && /level/.test(lvl.data.error), lvl.text);
  const logBefore = (await client(A).get("/hex/api/game")).data.events.length;
  const diag = await post(ana, { kind: "move", x: 1, y: 1 });
  check("a diagonal step succeeds (P1: diagonals count)", diag.status === 200 && diag.data.ok && diag.data.at.label === "2N 2E 1U" && J([posOf("hex", 0).x, posOf("hex", 0).y, posOf("hex", 0).z]) === "[1,1,0]", diag.text);
  check("the move is logged, naming the tile, and the turn did NOT end (a move is in addition to proposing)", (await client(A).get("/hex/api/game")).data.events[0].text === "Ana (Teal) moved to 2N 2E 1U." && (await client(A).get("/hex/api/game")).data.events.length === logBefore + 1 && (await gameOf()).turn === 0 && (await gameOf()).moved === true && (await gameOf()).round === 1);
  const again = await post(ana, { kind: "move", x: 2, y: 1 });
  check("a second move in the same turn is refused (409), at most one per turn", again.status === 409 && /already moved/.test(again.data.error) && posOf("hex", 0).x === 1, again.text);
  const prp = await ana.post("/hex/api/turn", { prompt: "Let there be cats." });
  check("after moving, the same player can still propose a rule change this turn", prp.status === 200 && d1(state, `SELECT COUNT(*) AS n FROM turns WHERE game_id = '${gidOf("hex")}'`)[0].n === 1, prp.text);
  check("and a proposal does not advance the turn", (await gameOf()).turn === 0);
  // the other order: propose first, then move
  const pa = await join(A, "prop", prop.code, { email: "pa@example.com", name: "Pa", color: "vermilion" });
  const pb = await join(A, "prop", prop.code, { email: "pb@example.com", name: "Pb", color: "graphite" });
  setTurn("prop"); setPos("prop", 0, 0, 0); setPos("prop", 1, 1, 0);
  const prp2 = await pa.post("/prop/api/turn", { prompt: "Rain, but only on Tuesdays." });
  const mv2 = await post(pa, { kind: "move", x: -1, y: 1 }, "prop");
  check("propose first, then move: both land in the same turn", prp2.status === 200 && mv2.status === 200 && posOf("prop", 0).x === -1 && (await gameOf("prop")).turn === 0, mv2.text);
  setTurn("prop", 0, false); setPos("prop", 0, 0, 0); setPos("prop", 1, 1, 0);
  const occ = await post(pa, { kind: "move", x: 1, y: 0 }, "prop");
  check("a move onto a tile another piece stands on is refused (409): two pieces cannot share a tile", occ.status === 409 && /another piece/i.test(occ.data.error) && posOf("prop", 0).x === 0 && (await gameOf("prop")).moved === false, occ.text);
  check("and the other player is still not up", (await post(pb, { kind: "move", x: 2, y: 0 }, "prop")).status === 403);
  // uncharted destination
  setTurn("hex"); setPos("hex", 0, 3, 0);
  const unc = await post(ana, { kind: "move", x: 4, y: 0 }); // one step past the island's east edge (x 3): uncharted
  check("moving onto an uncharted tile is refused (400) and uses no move", unc.status === 400 && /not charted/.test(unc.data.error) && (await gameOf()).moved === false && posOf("hex", 0).x === 3, unc.text);
  // seams: 1N 1W -> 1S 1E in one diagonal step, by label
  setTurn("hex"); setPos("hex", 0, -1, 0);
  const seam = await post(ana, { kind: "move", label: "1s 1e" });
  check("across both seams in one diagonal step: 1N 1W to 1S 1E, named by label", seam.status === 200 && J([posOf("hex", 0).x, posOf("hex", 0).y]) === "[0,-1]", seam.text);
  // chart on move
  setTurn("hex"); setPos("hex", 0, 3, 0);
  d1(state, `INSERT INTO tiles (game_id, x, y, z, charted_at) VALUES ('${gidOf("hex")}', 4, 0, 0, 'x')`);
  const before = new Set(tilesOf("hex").map(tkey));
  const edge = await post(ana, { kind: "move", label: "1N 5E" });
  const after = tilesOf("hex"), afterSet = new Set(after.map(tkey));
  const shape = chartedAround(4, 0, 2).map(([x, y]) => `${x},${y},0`);
  const expected = new Set([...before, ...shape]);
  check("moving past the island edge charts the 21-tile shape around the new position, and only that", edge.status === 200 && shape.length === 21 && shape.every((k) => afterSet.has(k)) && afterSet.size === expected.size && [...afterSet].every((k) => expected.has(k)) && afterSet.size > before.size, `${before.size} -> ${afterSet.size}`);
  check("the new tiles are blank: just a place, and a charted time", d1(state, `SELECT COUNT(*) AS n FROM tiles WHERE game_id = '${gidOf("hex")}' AND charted_at IS NULL`)[0].n === 0);
  check("the corners of the shape stay uncharted", [[6, 2], [6, -2], [2, 2 + 0]].slice(0, 2).every(([x, y]) => !afterSet.has(`${x},${y},0`)) && afterSet.has("6,1,0") && afterSet.has("6,0,0"));
  setTurn("hex"); setPos("hex", 0, 4, 0);
  const n1 = tilesOf("hex").length;
  const back = await post(ana, { kind: "move", x: 3, y: 0 });
  check("charting a charted tile is a no-op: moving back changes no tile (insert-if-absent)", back.status === 200 && tilesOf("hex").length === n1, `${n1} -> ${tilesOf("hex").length}`);
  // the move distance setting
  setTurn("hex", 0, false, '{"turn.move_distance":2}'); setPos("hex", 0, 0, 0);
  const two = await post(ana, { kind: "move", x: 2, y: 1 });
  check("the move distance is a setting: with 2, a two-step move succeeds", two.status === 200 && posOf("hex", 0).x === 2, two.text);
  setTurn("hex", 0, false, '{"turn.move_distance":2}'); setPos("hex", 0, 0, 0);
  check("and three steps still fails", (await post(ana, { kind: "move", x: 3, y: 0 })).status === 400);
  // two simultaneous moves
  let raceOk = true, raceWhy = "";
  for (let i = 0; i < 6; i++) {
    setTurn("hex"); setPos("hex", 0, 0, 0); setPos("hex", 1, 3, 3);
    const [r1, r2] = await Promise.all([post(ana, { kind: "move", x: 1, y: 0 }), post(ana, { kind: "move", x: 0, y: 1 })]);
    const ok = [r1.status, r2.status].filter((x) => x === 200).length === 1 && [r1, r2].filter((r) => r.status !== 200).every((r) => r.status === 409);
    const events = d1(state, `SELECT COUNT(*) AS n FROM events WHERE game_id = '${gidOf("hex")}' AND kind = 'piece_moved'`)[0].n;
    if (!ok || !(await gameOf()).moved) { raceOk = false; raceWhy = `${r1.status} ${r1.text} | ${r2.status} ${r2.text} moved=${(await gameOf()).moved} events=${events}`; break; }
  }
  check("two simultaneous moves from one player, 6 times: exactly one lands, the other is refused 409, the turn is marked as moved", raceOk, raceWhy);
  // the proposal INSERT: guarded on turn and round, not on moves
  const gidS = gidOf("prop"), pidS = d1(state, `SELECT id FROM players WHERE game_id = '${gidS}' AND turn_order = 0`)[0].id;
  const lit = (v) => (typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  const cond = (turn, round, moves, status = "playing") => { d1(state, `UPDATE games SET last_move = '${moves ? "1:0" : ""}', status = '${status}' WHERE id = '${gidS}'`); d1(state, `DELETE FROM turns WHERE id LIKE 'tt%'`); const binds = [`tt${turn}${round}${moves}${status}`, pidS, "p", "n", "n", gidS, turn, round]; let i = 0; try { d1(state, PROPOSAL_INSERT_SQL.replace(/\?/g, () => lit(binds[i++]))); } catch { /* one live proposal per player and round */ } return d1(state, "SELECT COUNT(*) AS n FROM turns WHERE id LIKE 'tt%'")[0].n; };
  d1(state, `DELETE FROM turns WHERE game_id = '${gidS}'`); setTurn("prop");
  const n0 = cond(1, 1, 0), nA = cond(0, 2, 0), nB = cond(0, 1, 0, "setup"), nC = cond(0, 1, 1), nD = cond(0, 1, 0);
  check("the proposal INSERT lands only if the game is playing and the turn and round are as read; a move made this turn does not stop it", n0 === 0 && nA === 0 && nB === 0 && nC === 1 && nD === 1, [n0, nA, nB, nC, nD].join());
  check("/api/game reports whether the current turn has moved, and a new turn needs no reset (the marker no longer matches)", (setTurn("hex", 0, false), (await gameOf()).moved === false) && (() => { setTurn("hex", 0, true); return true; })() && (await gameOf()).moved === true && (() => { d1(state, "UPDATE games SET turn = 1 WHERE slug = 'hex'"); return true; })() && (await gameOf()).moved === false && (() => { d1(state, "UPDATE games SET turn = 0, round = 2 WHERE slug = 'hex'"); return true; })() && (await gameOf()).moved === false);

  console.log("the public board");
  const raw = await client(A).get("/hex/api/board");
  const pb2 = raw.data;
  check("it is public and never cached", raw.status === 200 && raw.headers.get("cache-control") === "no-store");
  check("it has no email addresses and no ids", !raw.text.includes("@") && !/"(id|player_id|owner_player_id|game_id|email)"/.test(raw.text), raw.text.slice(0, 200));
  check("a tile is only a place: x, y, z and a label, with no properties, terrain, owner or name", pb2.tiles.every((t) => J(Object.keys(t).sort()) === '["label","x","y","z"]') && !/terrain|props|owner|description/.test(raw.text));
  check("every tile and piece carries x, y, z and a full label like '3N 2E 1U'", pb2.tiles.every((t) => t.z === 0 && /^[1-9][0-9]*[NS] [1-9][0-9]*[EW] 1U$/.test(t.label)) && pb2.pieces.length === 3 && pb2.pieces.every((p) => Number.isInteger(p.at.x) && Number.isInteger(p.at.y) && p.at.z === 0 && /^[1-9][0-9]*[NS] [1-9][0-9]*[EW] 1U$/.test(p.at.label)));
  check("pieces report color, score and place; the board reports its settings and the move rules", pb2.pieces[0].color.key === "teal" && pb2.pieces[0].score === 0 && J(pb2.settings) === J(getSettings(d1(state, "SELECT settings FROM games WHERE slug = 'hex'")[0].settings)) && pb2.rules.move_distance === 1 && pb2.rules.diagonal_moves === true && pb2.rules.shared_tiles === false);
  check("an unknown game is 404", (await client(A).get("/nope/api/board")).status === 404);
  check("every piece stands on a charted tile", pb2.pieces.every((p) => pb2.tiles.some((t) => t.x === p.at.x && t.y === p.at.y && t.z === p.at.z)));

  console.log("legacy games");
  const gid = "11111111-2222-3333-4444-555555555555";
  d1(state, `INSERT INTO games (id, slug, name, repo, join_code, status, settings, created_at) VALUES ('${gid}','old','Old game','a/b','ZZZZ2222','setup','{"board.island":{"width":6,"height":4}}','2026-01-01T00:00:00Z')`);
  const lazy = (await client(A).get("/old/api/board")).data;
  check("a game with no tiles gets its island from its stored settings the first time the board is read: 6x4 centered (3W..3E, 2N..2S)", lazy.tiles.length === 24 && Math.min(...lazy.tiles.map((t) => t.x)) === -3 && Math.max(...lazy.tiles.map((t) => t.x)) === 2 && Math.min(...lazy.tiles.map((t) => t.y)) === -2 && Math.max(...lazy.tiles.map((t) => t.y)) === 1);

  console.log("static files");
  const js = await client(A).get("/js/board.js");
  check("the board's script is served as JavaScript", js.status === 200 && /javascript/.test(js.headers.get("content-type")), js.status + " " + js.headers.get("content-type"));
  for (const f of ["/js/board-gl.js", "/js/theme.js", "/theme.css", "/vendor/three.module.js", "/vendor/three.core.js"]) check(`${f} is served`, (await client(A).get(f)).status === 200);
  check("nothing else in public/ is reachable, and no path tricks", (await client(A).get("/vendor/three.LICENSE")).status === 404 && (await client(A).get("/js/nope.js")).status === 404 && (await client(A).get("/js/%2e%2e/board.html")).status === 404 && (await client(A).get("/board.html")).status === 404);
} catch (e) {
  fail++;
  console.log("  FAIL  harness error:", e?.stack || e, e?.cause);
  if (srv) console.log(srv.log().slice(-1500));
} finally {
  await srv?.stop();
  try { rmSync(state, { recursive: true, force: true }); } catch {}
}
// ---------------------------------------------------------------- production vars vs local runs
console.log("production vars");
{
  const { readFileSync } = await import("node:fs");
  const toml = readFileSync(pjoin(ROOT, "wrangler.toml"), "utf8");
  const vars = toml.slice(toml.indexOf("\n[vars]"), toml.indexOf("[[send_email]]"));
  check("wrangler.toml sets the production sender and site", /^MAIL_FROM = "Chalant <chalant@promptocracy\.us>"$/m.test(vars) && /^SITE_URL = "https:\/\/promptocracy\.us"$/m.test(vars));
  const pv = toml.slice(toml.search(/^\[+previews/m));
  check("the previews config has a block and gives previews no vars, no email binding, no site url",
    pv.length > 20 && !/MAIL_FROM|SITE_URL|send_email|\[previews\.vars\]|\bEMAIL\b|RESEND/.test(pv.replace(/^\s*#.*$/gm, "")), pv.slice(0, 200));
  check("no top-level [vars] key can leak into previews: the only previews tables are D1", [...toml.matchAll(/^\[+(previews[^\]]*)\]+/gm)].every((m) => m[1] === "previews.d1_databases"));
  let local, st2 = newState();
  try {
    migrate(st2);
    const lg = await createGame(st2, { slug: "loc", repo: "busterbenson/hex", rulesBase: stub.base });
    local = await startServer(st2, 8798, ["DEV_MODE=1"]); // no MAIL_FROM / SITE_URL given: the harness blanks the production ones
    const p = await join(local.base, "loc", lg.code, { email: "l@example.com", name: "L", color: "teal" });
    const jr = await client(local.base).post("/loc/api/join", { code: lg.code, email: "l2@example.com", name: "L2", color: "cobalt" });
    check("locally the link points at the local origin and mail goes to the outbox, not Cloudflare", jr.data.dev_link.startsWith(local.base + "/loc/auth/verify") && d1(st2, "SELECT COUNT(*) AS n FROM outbox")[0].n >= 2);
    const tok = new URL(jr.data.dev_link).searchParams.get("token");
    const prod = await client(local.base).form("/loc/auth/verify", { token: tok }, { origin: "https://promptocracy.us" });
    check("the production origin is NOT what local runs check against (403)", prod.status === 403, String(prod.status));
    const ok = await client(local.base).form("/loc/auth/verify", { token: tok }, { origin: local.base });
    check("a POST from the dev origin passes the Origin check (303)", ok.status === 303, String(ok.status));
  } catch (e) { fail++; console.log("  FAIL  local-vars harness:", e?.stack || e); }
  finally { await local?.stop(); try { rmSync(st2, { recursive: true, force: true }); } catch {} }
}
await stub?.stop();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
