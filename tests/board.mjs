// The island board: labels and geometry, the generator, migration 0002 on a database with data, piece colors,
// the claim/describe actions, the harvest, and the public board API.
// Run: npm test (after e2e.mjs). Real `wrangler dev`, LOCAL D1 only.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pjoin } from "node:path";
import { ROOT, COLORS, client, createGame, d1, join, migrate, newState, startRulesStub, startServer } from "./lib.mjs";
import { coordLabel, diagonals, generateTiles, landAllowed, neighbors, parseLabel, validProps } from "../src/lib/geometry.js";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "  -> " + detail : ""}`); }
};

// ---------------------------------------------------------------- geometry
console.log("labels");
check("C4 is x 2, y 3, and back", coordLabel(2, 3) === "C4" && JSON.stringify(parseLabel("C4")) === '{"x":2,"y":3}');
check("labels are case-insensitive and tolerate spaces around", JSON.stringify(parseLabel("c4")) === '{"x":2,"y":3}' && JSON.stringify(parseLabel(" h8 ")) === '{"x":7,"y":7}');
check("A1 is the origin, H8 the island's far corner", JSON.stringify(parseLabel("A1")) === '{"x":0,"y":0}' && coordLabel(7, 7) === "H8");
check("beyond Z the columns go AA, AB ... (AA12 is x 26, y 11)", coordLabel(25, 0) === "Z1" && coordLabel(26, 11) === "AA12" && coordLabel(27, 0) === "AB1" && JSON.stringify(parseLabel("aa12")) === '{"x":26,"y":11}' && coordLabel(701, 0) === "ZZ1" && coordLabel(702, 0) === "AAA1");
check("rows run past 8: 9, 10, ...", coordLabel(0, 8) === "A9" && coordLabel(3, 99) === "D100" && JSON.stringify(parseLabel("D100")) === '{"x":3,"y":99}');
let rt = true;
for (let x = 0; x < 1500; x += 7) for (const y of [0, 1, 7, 8, 9, 99, 1234]) { const p = parseLabel(coordLabel(x, y)); if (!p || p.x !== x || p.y !== y) rt = false; }
check("label <-> coordinate round-trips across a wide range", rt);
check("things that are not labels are refused", ["", "4C", "C", "C0", "C-1", "C 4", "C4x", "CC", "1", "A01", "ABCDE1", "C99999999", null, undefined, 4, {}].every((v) => parseLabel(v) === null));
check("a coordinate with no chess name falls back to (x, y)", coordLabel(-1, 2) === "(-1, 2)" && coordLabel(2, -1) === "(2, -1)");
check("neighbours: four orthogonal, four diagonal, kept apart",
  JSON.stringify(neighbors(2, 3)) === "[[3,3],[2,4],[1,3],[2,2]]" && JSON.stringify(diagonals(2, 3)) === "[[3,4],[1,4],[1,2],[3,2]]");
check("by default land is only at x >= 0 and y >= 0 (a rule may change that)", landAllowed(0, 0) && landAllowed(7, 7) && landAllowed(40, 9) && !landAllowed(-1, 0) && !landAllowed(0, -1) && !landAllowed(0.5, 0));

console.log("island generator");
const land = (size, seed) => generateTiles(size, seed);
const tiles8 = land(8, 12345);
check("an 8x8 island: tiles inside x 0..7, y 0..7, none repeated, no row for the sea",
  tiles8.every((t) => t.x >= 0 && t.x <= 7 && t.y >= 0 && t.y <= 7) && new Set(tiles8.map((t) => t.x + "," + t.y)).size === tiles8.length && tiles8.length < 64);
const seeds = Array.from({ length: 60 }, (_, i) => i * 7919 + 1);
const counts = seeds.map((s) => land(8, s).length);
check("the corners are eroded: 54 to 58 land tiles, every seed", counts.every((n) => n >= 54 && n <= 58), counts.join());
check("each corner tile is sea", seeds.every((s) => { const set = new Set(land(8, s).map((t) => t.x + "," + t.y)); return !["0,0", "7,0", "0,7", "7,7"].some((k) => set.has(k)); }));
check("every corner loses a second tile too, so each corner reads as a bite", seeds.every((s) => { const set = new Set(land(8, s).map((t) => t.x + "," + t.y)); return [[0, 0, [[1, 0], [0, 1]]], [7, 0, [[6, 0], [7, 1]]], [0, 7, [[1, 7], [0, 6]]], [7, 7, [[6, 7], [7, 6]]]].every(([, , ns]) => ns.some(([x, y]) => !set.has(x + "," + y))); }));
const connected = (ts) => { const set = new Set(ts.map((t) => t.x + "," + t.y)); const seen = new Set([ts[0].x + "," + ts[0].y]); const st = [[ts[0].x, ts[0].y]]; while (st.length) { const [x, y] = st.pop(); for (const [a, b] of neighbors(x, y)) { const k = a + "," + b; if (set.has(k) && !seen.has(k)) { seen.add(k); st.push([a, b]); } } } return seen.size === set.size; };
check("the island is one piece (4-connected), every seed", seeds.every((s) => connected(land(8, s))));
check("the same seed gives the same island", JSON.stringify(land(8, 99)) === JSON.stringify(land(8, 99)));
check("a different seed gives a different one", JSON.stringify(land(8, 99)) !== JSON.stringify(land(8, 100)));
const nonMeadow = seeds.map((s) => { const t = land(8, s); return t.filter((x) => x.terrain !== "meadow").length / t.length; });
check("about a quarter of the land is not meadow (18% to 32%, every seed)", nonMeadow.every((f) => f >= 0.18 && f <= 0.32), nonMeadow.map((f) => f.toFixed(2)).join());
const comps = (ts, terrain) => {
  const set = new Set(ts.filter((t) => t.terrain === terrain).map((t) => t.x + "," + t.y));
  const seen = new Set(); let best = 0;
  for (const k of set) {
    if (seen.has(k)) continue;
    let size = 0; const stack = [k]; seen.add(k);
    while (stack.length) {
      const [x, y] = stack.pop().split(",").map(Number); size++;
      for (const [a, b] of neighbors(x, y)) { const n = `${a},${b}`; if (set.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); } }
    }
    best = Math.max(best, size);
  }
  return best;
};
check("water is a lake: a clump of 3 or more connected tiles", seeds.every((s) => comps(land(8, s), "water") >= 3));
const isCoast = (ts, t) => { const set = new Set(ts.map((u) => u.x + "," + u.y)); return neighbors(t.x, t.y).some(([a, b]) => !set.has(a + "," + b)); };
check("the lake is INSIDE the island: no water tile touches the sea", seeds.every((s) => { const ts = land(8, s); return ts.filter((t) => t.terrain === "water").every((t) => !isCoast(ts, t)); }));
check("sand lies along the coast", seeds.every((s) => { const ts = land(8, s); const sand = ts.filter((t) => t.terrain === "sand"); return sand.length >= 2 && sand.every((t) => isCoast(ts, t)); }));
check("forest and stone come in clumps too", seeds.every((s) => comps(land(8, s), "stone") >= 2 && comps(land(8, s), "forest") >= 2));
check("every terrain comes from the fixed set", seeds.every((s) => land(8, s).every((t) => ["meadow", "water", "forest", "stone", "sand"].includes(t.terrain))));
check("other sizes work (4 to 16): one piece, inside x,y < size, corners bitten", [4, 5, 6, 12, 16].every((n) => { const t = land(n, 5); return t.length >= n * n - 11 && t.length <= n * n - 8 && connected(t) && t.every((u) => u.x < n && u.y < n); }));
check("props must be an object of at most 4 KB",
  validProps({}) && validProps({ a: 1, b: [1, 2], c: { d: true } }) && !validProps([]) && !validProps(null) && !validProps("x") && !validProps({ big: "x".repeat(4100) }));

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
    check("the existing game got an island size and a seed; unused join links were voided",
      sql("SELECT size, seed FROM games")[0].size === 8 && sql("SELECT seed FROM games")[0].seed > 0 && sql("SELECT COUNT(*) AS n FROM login_tokens")[0].n === 0);
    let dup = "ok"; try { sql(`INSERT INTO players (id, game_id, email, display_name, color, turn_order, joined_at) VALUES ('px','g1','x@x.test','x','vermilion',9,'2026-01-01T00:00:00Z')`); } catch { dup = "refused"; }
    check("the new table keeps one color per player per game", dup === "refused");
    let bad = 0;
    for (const props of ["'[1,2]'", "'not json'", `'${JSON.stringify({ x: "y".repeat(4100) })}'`]) {
      try { sql(`INSERT INTO tiles (game_id, x, y, props, updated_at) VALUES ('g1',0,0,${props},'t')`); } catch { bad++; }
    }
    check("the database itself refuses tile props that are not an object or are over 4 KB", bad === 3 && sql("SELECT COUNT(*) AS n FROM tiles")[0].n === 0);
    sql(`INSERT INTO tiles (game_id, x, y, props, updated_at) VALUES ('g1',0,0,'{"fertility":2}','t')`);
    check("and accepts any object", sql("SELECT props FROM tiles")[0].props === '{"fertility":2}');
  } catch (e) { fail++; console.log("  FAIL  migration harness:", String(e.stdout || "") + String(e.stderr || "") + (e.stack || e)); }
  finally { for (const d of [st, cfgDir]) { try { rmSync(d, { recursive: true, force: true }); } catch {} } }
}

// ---------------------------------------------------------------- the running site
const state = newState();
let srv, stub;
const tileOf = (b, q, r) => b.tiles.find((t) => t.x === q && t.y === r);
try {
  migrate(state);
  stub = await startRulesStub(8897, { "/busterbenson/hex/main/RULES.md": "# Rules\n" });
  const R = { rulesBase: stub.base, repo: "busterbenson/hex" };
  const g = await createGame(state, { slug: "hex", name: "Island game", max: 3, ...R });
  const big = await createGame(state, { slug: "eight", name: "Eight", max: 8, size: 4, ...R });
  const prop = await createGame(state, { slug: "prop", name: "Proposals", max: 2, ...R });
  srv = await startServer(state, 8795, ["DEV_MODE=1", "SITE_URL=http://hex.test", `RULES_BASE_URL=${stub.base}`]);
  const A = srv.base;

  console.log("board at creation");
  const nTiles = (slug) => d1(state, `SELECT COUNT(*) AS n FROM tiles WHERE game_id = (SELECT id FROM games WHERE slug='${slug}')`)[0].n;
  const row = d1(state, "SELECT seed, size FROM games WHERE slug = 'hex'")[0];
  const want = generateTiles(row.size, row.seed).sort((a, b) => a.x - b.x || a.y - b.y);
  check("a new game has its island already: an 8x8 island with eroded corners (54-58 tiles)", row.size === 8 && nTiles("hex") === want.length && want.length >= 54 && want.length <= 58, String(nTiles("hex")));
  check("and a --size 4 game has a smaller one", nTiles("eight") === generateTiles(4, d1(state, "SELECT seed FROM games WHERE slug='eight'")[0].seed).length && nTiles("eight") < 16);
  const stored = d1(state, "SELECT x, y, terrain FROM tiles WHERE game_id = (SELECT id FROM games WHERE slug='hex') ORDER BY x, y");
  check("stored terrain is exactly what the seed on the game generates, and there are no rows for sea", JSON.stringify(stored) === JSON.stringify(want) && d1(state, "SELECT COUNT(*) AS n FROM tiles WHERE x < 0 OR y < 0 OR x > 7 OR y > 7")[0].n === 0);
  let refused = "";
  for (const bad of ["3", "17", "x"]) { try { await createGame(state, { slug: "zzz", size: bad, ...R }); refused += "no "; } catch { refused += "yes "; } }
  check("create-game refuses an island size outside 4..16", refused === "yes yes yes ", refused);
  let nine = "";
  try { await createGame(state, { slug: "nine", max: 9, ...R }); nine = "created"; } catch { nine = "refused"; }
  check("create-game refuses more than 8 players (there are 8 colors)", nine === "refused");

  console.log("piece colors");
  const page = await client(A).get(`/hex/join/${g.code}`);
  check("the join page offers all 8 colors as pieces, with their names", page.status === 200 && (page.text.match(/name="color"/g) || []).length === 8 && ["Vermilion", "Saffron", "Moss", "Teal", "Cobalt", "Violet", "Rose", "Graphite"].every((n) => page.text.includes(`<b>${n}</b>`)) && !page.text.includes('name="marker"'));
  const ana = await join(A, "hex", g.code, { email: "ana@example.com", name: "Ana", color: "teal" });
  const page2 = await client(A).get(`/hex/join/${g.code}`);
  check("a color someone took is shown as taken and cannot be picked", /value="teal"[^>]*disabled/.test(page2.text) && !/value="cobalt"[^>]*disabled/.test(page2.text) && page2.text.includes("<i>taken</i>"));
  const dupe = await client(A).post("/hex/api/join", { code: g.code, email: "x@example.com", name: "X", color: "teal" });
  check("joining with a taken color is refused (409)", dupe.status === 409 && /color/i.test(dupe.data.error), dupe.text);
  check("an unknown color is refused (400), and so is the old marker field", (await client(A).post("/hex/api/join", { code: g.code, email: "y@example.com", name: "Y", color: "puce" })).status === 400 && (await client(A).post("/hex/api/join", { code: g.code, email: "y@example.com", name: "Y", marker: "🦉" })).status === 400);
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
  check("/api/game players carry colors, not markers", game.players.every((p) => p.color?.key && !("marker" in p)) && game.players.map((p) => p.color.key).join() === "teal,cobalt,rose" && game.game.size === 8);

  const eight = [];
  for (let i = 0; i < 8; i++) eight.push(await join(A, "eight", big.code, { email: `e${i}@example.com`, name: `E${i}`, color: COLORS[i] }));
  const ninth = await client(A).post("/eight/api/join", { code: big.code, email: "e9@example.com", name: "E9", color: "teal" });
  check("eight players fit, with eight different colors, and a ninth is turned away", ninth.status === 409 && (await client(A).get("/eight/api/game")).data.players.length === 8);
  check("the full join page offers no free piece", (await client(A).get(`/eight/join/${big.code}`)).text.includes("This game is full"));

  console.log("actions");
  const post = (c, body, slug = "hex") => c.post(`/${slug}/api/action`, body);
  const turnOf = async (slug = "hex") => (await client(A).get(`/${slug}/api/game`)).data.game;
  check("logged out is 401", (await post(client(A), { kind: "claim", x: 0, y: 0 })).status === 401);
  const early = await post(ana, { kind: "claim", x: 2, y: 3 });
  check("in setup, an action is refused (409) and nothing changes", early.status === 409 && /not started/i.test(early.data.error) && tileOf((await client(A).get("/hex/api/board")).data, 2, 3).owner === null, early.text);
  d1(state, "UPDATE games SET status = 'playing', round = 1, turn = 0 WHERE slug = 'hex'");
  for (const [label, body] of [["open sea far away", { kind: "claim", x: 99, y: 99 }], ["negative coordinates (no land there by default)", { kind: "claim", x: -1, y: 0 }], ["A1 is a corner: eroded, so sea", { kind: "claim", label: "A1" }], ["a label that is not one", { kind: "claim", label: "nope" }], ["row 0", { kind: "claim", label: "C0" }], ["a number as label", { kind: "claim", label: 5 }], ["a label and nothing sensible", { kind: "claim", label: "" }], ["text coordinates", { kind: "claim", x: "1", y: 0 }], ["fractions", { kind: "claim", x: 0.5, y: 0 }], ["missing r", { kind: "claim", x: 0 }], ["null", { kind: "claim", x: null, y: null }]]) {
    const x = await post(ana, body);
    check(`bad coordinates are refused (${label})`, x.status === 400, x.text);
  }
  check("an unknown kind is refused", (await post(ana, { kind: "teleport", x: 0, y: 0 })).status === 400 && (await post(ana, { x: 0, y: 0 })).status === 400);
  check("players cannot write tile props through an action", (await post(ana, { kind: "claim", x: 2, y: 3, props: { gold: 99 } })).status === 400 && (await post(ana, { kind: "describe", x: 2, y: 3, name: "a", description: "b", props: { gold: 99 } })).status === 400);
  const oot = await post(bo, { kind: "claim", x: 2, y: 4 });
  check("out of turn is refused (403) and nothing is claimed", oot.status === 403 && (await turnOf()).turn === 0 && tileOf((await client(A).get("/hex/api/board")).data, 2, 4).owner === null, oot.text);
  const notYet = await post(ana, { kind: "describe", x: 2, y: 3, name: "Hearth", description: "Warm." });
  check("describing a tile you do not own is refused (403)", notYet.status === 403, notYet.text);

  const notesBefore = (await bo.get("/hex/api/notifications")).data.unread;
  const c1 = await post(ana, { kind: "claim", x: 2, y: 3 });
  check("the player whose turn it is claims an unowned tile", c1.status === 200 && c1.data.kind === "claim" && c1.data.turn === 1 && c1.data.round === 1, c1.text);
  let gm = await turnOf();
  check("the turn advanced to the next player, same round, no harvest yet", gm.turn === 1 && gm.round === 1 && (await client(A).get("/hex/api/game")).data.players.every((p) => p.score === 0));
  let board = (await client(A).get("/hex/api/board")).data;
  check("the tile shows its owner and color", tileOf(board, 2, 3).owner.name === "Ana" && tileOf(board, 2, 3).owner.color.key === "teal");
  check("the log records it, naming the tile like a chess square", (await client(A).get("/hex/api/game")).data.events[0].text === "Ana (Teal) claimed tile C4.");
  check("every tile in /api/board carries its label, and so does a piece's position", board.tiles.every((t) => /^[A-H][1-8]$/.test(t.label)) && tileOf(board, 2, 3).label === "C4" && board.pieces.find((p) => p.name === "Ana").at.label === "C4");
  check("board size and island extent are reported", board.size === 8 && board.tiles.length === want.length);
  const notes = (await bo.get("/hex/api/notifications")).data;
  check("the table is notified, and told who is up", notes.unread === notesBefore + 1 && notes.notifications[0].body.includes("Ana (Teal) claimed tile C4. Bo (Cobalt) is up."), JSON.stringify(notes.notifications[0]));
  check("Ana's own turn is spent: she is refused now", (await post(ana, { kind: "claim", x: 2, y: 4 })).status === 403);
  check("the same tile can be named by label or by x and y: owned by label is refused too", (await post(bo, { kind: "claim", label: "c4" })).status === 409);
  const owned = await post(bo, { kind: "claim", x: 2, y: 3 });
  check("claiming an owned tile is refused (409) and the turn stays", owned.status === 409 && (await turnOf()).turn === 1, owned.text);
  const steal = await post(bo, { kind: "describe", x: 2, y: 3, name: "Mine", description: "Not mine." });
  check("describing someone else's tile is refused (403)", steal.status === 403 && tileOf((await client(A).get("/hex/api/board")).data, 2, 3).name === null, steal.text);
  const b1 = await post(bo, { kind: "claim", x: 3, y: 3 });
  check("the next player claims", b1.status === 200 && b1.data.turn === 2 && b1.data.harvest === null, b1.text);
  const c2 = await post(cy, { kind: "claim", label: "c5" });
  gm = await turnOf();
  const ev = (await client(A).get("/hex/api/game")).data;
  check("when the turn wraps past the last player the round ends: round 2, turn 0", c2.status === 200 && gm.round === 2 && gm.turn === 0 && c2.data.round === 2, c2.text);
  check("harvest: +1 point per tile owned, once, for everyone", ev.players.map((p) => p.score).join() === "1,1,1");
  const harvests = ev.events.filter((e) => e.kind === "harvest");
  check("one harvest event summarises it", harvests.length === 1 && harvests[0].text === "Harvest at the end of round 1: Ana (Teal) +1, Bo (Cobalt) +1, Cy (Rose) +1.", JSON.stringify(harvests));

  console.log("describing");
  for (const [label, body] of [["empty name", { name: "  ", description: "x" }], ["41-character name", { name: "n".repeat(41), description: "x" }], ["empty description", { name: "ok", description: "" }], ["281-character description", { name: "ok", description: "d".repeat(281) }], ["a number for a name", { name: 5, description: "x" }]]) {
    const x = await post(ana, { kind: "describe", x: 2, y: 3, ...body });
    check(`a bad name or description is refused (${label})`, x.status === 400, x.text);
  }
  check("and none of that cost her the turn", (await turnOf()).turn === 0);
  const d1r = await post(ana, { kind: "describe", x: 2, y: 3, name: "Hearth\u0007 ‮hold", description: "A warm place.\n\nBring wood." });
  board = (await client(A).get("/hex/api/board")).data;
  check("a player names and describes their own tile; control and bidi characters are stripped", d1r.status === 200 && tileOf(board, 2, 3).name === "Hearth hold" && tileOf(board, 2, 3).description === "A warm place. Bring wood.", d1r.text);
  check("describing also ends the turn, and the log says so", (await turnOf()).turn === 1 && (await client(A).get("/hex/api/game")).data.events[0].text === 'Ana (Teal) named tile C4 "Hearth hold".');
  await post(bo, { kind: "claim", x: 3, y: 4 });
  const c3 = await post(cy, { kind: "claim", x: 4, y: 4 });
  const sc = (await client(A).get("/hex/api/game")).data;
  check("round 2 ends: Ana owns 1, Bo 2, Cy 2, so scores are 1+1, 1+2, 1+2", c3.status === 200 && sc.game.round === 3 && sc.players.map((p) => p.score).join() === "2,3,3", JSON.stringify(sc.players.map((p) => p.score)));
  check("two harvests are logged", sc.events.filter((e) => e.kind === "harvest").length === 2);

  console.log("one winner of a race");
  const [r1, r2] = await Promise.all([post(ana, { kind: "claim", x: 4, y: 3 }), post(ana, { kind: "claim", x: 5, y: 3 })]);
  const sc2 = (await client(A).get("/hex/api/game")).data;
  const owners = (await client(A).get("/hex/api/board")).data.tiles.filter((t) => t.owner?.name === "Ana").length;
  check("two simultaneous moves from the same player: exactly one lands, the turn advances once",
    [r1.status, r2.status].filter((s) => s === 200).length === 1 && [r1.status, r2.status].every((s) => [200, 403, 409].includes(s)) && sc2.game.turn === 1 && owners === 2, `${r1.status} ${r2.status} turn=${sc2.game.turn} owners=${owners}`);

  console.log("board API");
  const raw = await client(A).get("/hex/api/board");
  board = raw.data;
  check("it is public and never cached", raw.status === 200 && raw.headers.get("cache-control") === "no-store");
  check("it has no email addresses and no ids", !raw.text.includes("@") && !/"(id|player_id|owner_player_id|game_id|email)"/.test(raw.text), raw.text.slice(0, 200));
  check("size 8, the whole island, and a piece per player", board.size === 8 && board.tiles.length === want.length && board.pieces.length === 3 && board.game.round === 3);
  const anaPiece = board.pieces.find((p) => p.name === "Ana");
  check("a piece stands on its owner's most recently claimed tile", (anaPiece.at.x === 4 && anaPiece.at.y === 3) || (anaPiece.at.x === 5 && anaPiece.at.y === 3));
  check("pieces report color, score and tile count", anaPiece.color.key === "teal" && anaPiece.tiles === 2 && anaPiece.score === 2);
  d1(state, `UPDATE tiles SET props = '{"fertility":2,"haunted":true,"notes":["a","b"]}' WHERE game_id = (SELECT id FROM games WHERE slug='hex') AND x = 5 AND y = 5`);
  check("tile props of any shape come through", JSON.stringify(tileOf((await client(A).get("/hex/api/board")).data, 5, 5).props) === '{"fertility":2,"haunted":true,"notes":["a","b"]}');
  check("a tile nobody owns has owner null and empty props", tileOf(board, 6, 3).owner === null && JSON.stringify(tileOf(board, 6, 3).props) === "{}");
  const nobody = (await client(A).get("/prop/api/board")).data;
  check("a piece with no tile has no position (it waits on the bench)", nobody.pieces.length === 0 && nobody.tiles.length >= 54 && nobody.tiles.length <= 58);
  check("an unknown game is 404", (await client(A).get("/nope/api/board")).status === 404);

  console.log("proposals");
  const pa = await join(A, "prop", prop.code, { email: "pa@example.com", name: "Pa", color: "vermilion" });
  const pb = await join(A, "prop", prop.code, { email: "pb@example.com", name: "Pb", color: "graphite" });
  d1(state, "UPDATE games SET status = 'playing', round = 1, turn = 0 WHERE slug = 'prop'");
  const prp = await pa.post("/prop/api/turn", { prompt: "Let there be cats." });
  check("a proposal is recorded and does not advance the turn", prp.status === 200 && (await turnOf("prop")).turn === 0 && (await turnOf("prop")).round === 1, prp.text);
  const after = await post(pa, { kind: "claim", x: 2, y: 4 }, "prop");
  check("after proposing, the same turn cannot also act (409): it waits for the referee", after.status === 409 && /proposed/i.test(after.data.error) && (await turnOf("prop")).turn === 0, after.text);
  check("and the other player is still not up", (await post(pb, { kind: "claim", x: 2, y: 4 }, "prop")).status === 403);

  console.log("legacy games");
  const gid = "11111111-2222-3333-4444-555555555555";
  d1(state, `INSERT INTO games (id, slug, name, repo, join_code, status, size, seed, created_at) VALUES ('${gid}','old','Old game','a/b','ZZZZ2222','setup',6,123,'2026-01-01T00:00:00Z')`);
  const lazy = (await client(A).get("/old/api/board")).data;
  const exp = generateTiles(6, 123);
  check("a game with no tiles gets them from its stored seed the first time the board is read, same as at creation",
    lazy.tiles.length === exp.length && lazy.size === 6 && lazy.tiles.every((t) => exp.find((e) => e.x === t.x && e.y === t.y).terrain === t.terrain));
  check("and not twice", d1(state, `SELECT COUNT(*) AS n FROM tiles WHERE game_id = '${gid}'`)[0].n === exp.length && (await client(A).get("/old/api/board")).data.tiles.length === exp.length);

  console.log("static files");
  const js = await client(A).get("/js/board.js");
  check("the board's script is served as JavaScript", js.status === 200 && /javascript/.test(js.headers.get("content-type")), js.status + " " + js.headers.get("content-type"));
  for (const f of ["/js/board-gl.js", "/js/theme.js", "/theme.css", "/vendor/three.module.js", "/vendor/three.core.js"]) check(`${f} is served`, (await client(A).get(f)).status === 200);
  check("nothing else in public/ is reachable, and no path tricks", (await client(A).get("/vendor/three.LICENSE")).status === 404 && (await client(A).get("/js/nope.js")).status === 404 && (await client(A).get("/js/%2e%2e/board.html")).status === 404 && (await client(A).get("/board.html")).status === 404);
} catch (e) {
  fail++;
  console.log("  FAIL  harness error:", e?.stack || e);
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
