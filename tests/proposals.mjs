// Proposals (rules 103, 105, 108.3, 110.1): the code drafts of every mechanical kind, what no proposal can change, the
// conflicts the moderator names, the small model's answer (a stub with recorded answers: success, malformed, failing,
// and no key at all), confirm (one a day, even when two confirms race; P-numbers in confirm order; the mark fixed at
// confirm), withdraw, the lock and End turn, the roll onto the next day's ballot, that nothing about votes leaks, and
// migration 0006 on a database with data. Run: npm test. Real `wrangler dev`, LOCAL D1 only; the model is a local stub.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join as pjoin } from "node:path";
import { ROOT, client, createGame, d1, join, migrate, newState, startPlaying, startRulesStub, startServer } from "./lib.mjs";
import { dayOpenBinds } from "../src/lib/day-gate.js";
import {
  DRAFT_INSERT_SQL, WITHDRAW_SQL, citedIn, draftOf, fixedParts, fixedRefusal, markFor, needsModel, parseBook, readModelAnswer, readRequest, referencesTo,
} from "../src/lib/proposals.js";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name}${detail ? "  -> " + detail : ""}`); }
};
const J = JSON.stringify;
const LOCK1 = "Chalant is processing day 1. Play resumes when it's done.";
const MD = readFileSync(pjoin(ROOT, "templates/RULES.md"), "utf8");
const B = parseBook(MD);
const req = (body) => readRequest(B, body);
const drafted = (body, after = null) => { const r = req(body); return { r, d: draftOf(B, r, after) }; };

// ---------------------------------------------------------------- the code drafts (pure)
console.log("the moderator's code drafts (rule 103.1), after the mockup's makeDraft");
{
  let { r, d } = drafted({ kind: "repeal", target: "403" });
  check("repeal a rule: struck and kept ('[Repealed]'), headed 'Repeal rule 403 (Paradox):'", d.head === "Repeal rule 403 (Paradox):" && d.after_text === "[Repealed]" && d.before_text.startsWith("If the rules are changed") && !needsModel(r), J(d));
  ({ r, d } = drafted({ kind: "repeal", target: "202.3" }));
  check("remove a clause: 'Remove clause 202.3 (Your turn):', its text struck", d.head === "Remove clause 202.3 (Your turn):" && d.after_text === "" && d.before_text === "Every part of a turn is optional, and skipping one has no penalty.", J(d));
  ({ r, d } = drafted({ kind: "addclause", target: "401", words: "Points can't be given away." }));
  check("add a clause to a rule: the next clause number (401.1) and the player's words", d.head === "Add a clause to rule 401 (Points):" && d.after_text === "401.1 Points can't be given away." && d.new_num === "401.1", J(d));
  ({ r, d } = drafted({ kind: "addclause", target: "202.2", words: "You may also wait." }));
  check("add a clause after a clause: 'Add a clause to rule 202 (Your turn), after 202.2:', numbered after the rule's last clause (202.6)", d.head === "Add a clause to rule 202 (Your turn), after 202.2:" && d.new_num === "202.6" && d.after_text === "202.6 You may also wait.", J(d));
  ({ r, d } = drafted({ kind: "add", target: "400", words: "A tie goes to the older player." }));
  check("add a rule: the block's next free number (404), headed 'Add rule 404 to block 400:'", d.head === "Add rule 404 to block 400:" && d.new_num === "404" && d.after_text === "A tie goes to the older player." && r.scope === "block", J(d));
  ({ r, d } = drafted({ kind: "move", target: "403", to: "300" }));
  check("move a rule: 'Move rule 403 (Paradox) to block 300 as rule 303:', and its old number keeps a forwarder", d.head === "Move rule 403 (Paradox) to block 300 as rule 303:" && d.new_num === "303" && d.after_text.endsWith("403 [Moved to 303]"), J(d));
  ({ r, d } = drafted({ kind: "move", target: "504", to: "300" }));
  check("a moved rule's clauses move with it: 504 to block 300 as 303 gives 303.2 and 303.3, and only the forwarder keeps 504",
    d.after_text.includes("303.2 When you move") && d.after_text.includes("303.3 You can only move") && !/504\.\d/.test(d.after_text) && d.after_text.endsWith("504 [Moved to 303]"), d.after_text);
  ({ r, d } = drafted({ kind: "mark", target: "401" }));
  check("lock a rule: 'Mark rule 401 (Points) unanimous:' [majority] -> [unanimous]; it needs the votes of its CURRENT mark (rule 105.3)", d.head === "Mark rule 401 (Points) unanimous:" && d.before_text === "[majority]" && d.after_text === "[unanimous]" && markFor(B, { ...r, ...d }) === "majority", J(d));
  ({ r, d } = drafted({ kind: "mark", target: "400" }));
  check("lock a block: 'Mark block 400 (Points and winning) unanimous:'", d.head === "Mark block 400 (Points and winning) unanimous:" && r.scope === "block", J(d));
  ({ r, d } = drafted({ kind: "reword", target: "401", words: "A player whose proposal passes gets 15 points.", prefilled: true }));
  check("reword with the current text edited in place (prefilled) is exact already: drafted by code, the words are the new text", !needsModel(r) && r.kind === "amend" && d.head === "Amend rule 401 (Points) to read:" && d.after_text === "A player whose proposal passes gets 15 points." && d.before_text === "A player whose proposal passes gets 10 points.", J(d));
  check("reword in plain words needs the small model; a clause reword is headed 'Edit clause 504.2 (...) to read:'", needsModel(req({ kind: "reword", target: "401", words: "15 points" })) && draftOf(B, req({ kind: "amend", target: "504.2", words: "x" }), "new").head.startsWith("Edit clause 504.2 ("));
  check("a target that is an inherited object key (constructor, __proto__, toString, hasOwnProperty) is no rule, for every kind (no junk draft, no crash)",
    ["constructor", "__proto__", "toString", "hasOwnProperty"].every((t) => ["amend", "addclause", "add", "repeal", "move", "mark"].every((k) => /There is no rule/.test(req({ kind: k, target: t, words: "x", to: "300", prefilled: true }).error || ""))) &&
    /Say which block/.test(req({ kind: "move", target: "403", to: "constructor" }).error));
  check("citations are read in every form the text uses: 'rule 504.2', 'Rule 504', 'rules 202.4 and 203.1', 'rules 101, 102 or 103'",
    J(citedIn("See rule 504.2. Rule 504 too, and rules 202.4 and 203.1, and rules 101, 102 or 103.")) === J(["504.2", "504", "202.4", "203.1", "101", "102", "103"]) &&
    J(citedIn("rule 4012 is not a rule number")) === J([]));
  check("no merge, split or 'change the setting' kind: they are refused as unknown kinds", ["merge", "split", "setting"].every((k) => "error" in req({ kind: k, target: "401" })));
  check("requests that can't be drafted say why: no such rule, a mark on a clause, moving a clause, a move to its own block, reword with no words",
    /no rule 999/.test(req({ kind: "repeal", target: "999" }).error) && /not a clause/.test(req({ kind: "mark", target: "202.2" }).error) && /whole rule/.test(req({ kind: "move", target: "202.2", to: "300" }).error) &&
    /already in block 400/.test(req({ kind: "move", target: "403", to: "400" }).error) && /few words/.test(req({ kind: "amend", target: "401" }).error));
  check("the mark a proposal needs is the strictest part it touches (rule 103.4): moving 403 into block 100 needs unanimous, a new rule in block 100 too",
    markFor(B, { kind: "move", target: "403", to_block: "100" }) === "unanimous" && markFor(B, { kind: "add", target: "100", to_block: "100" }) === "unanimous" && markFor(B, { kind: "repeal", target: "403" }) === "majority");
}

console.log("what no proposal can change (rule 110.1), refused at drafting");
{
  const refuse = (body, after = null, settings = {}) => { const r = req(body); return fixedRefusal(B, { ...r, ...draftOf(B, r, after), settings }); };
  check("the fixed parts are the site's floor plus what 110.1 names: 103.2, 107.1, 110.1, 202.4, 203.1", J(fixedParts(B)) === J(["103.2", "107.1", "110.1", "202.4", "203.1"]), J(fixedParts(B)));
  check("repealing 107 (it holds the lock, 107.1) is refused, naming rule 107.1 and rule 110.1", /rule 107\.1/.test(refuse({ kind: "repeal", target: "107" })) && /rule 110\.1/.test(refuse({ kind: "repeal", target: "107" })));
  check("rewording 202.4 (End turn), 103.2 (one proposal a day) or 203.1 (midnight to midnight) is refused, and so is changing 110.1 itself (\"this rule included\")",
    ["202.4", "103.2", "203.1", "110.1"].every((t) => refuse({ kind: "amend", target: t, words: "x", prefilled: true }) !== null));
  check("moving 203, unlocking block 100 and repealing rule 110 are refused too", refuse({ kind: "move", target: "203", to: "300" }) && refuse({ kind: "mark", target: "100" }) && refuse({ kind: "repeal", target: "110" }));
  check("adding a clause to 203 or a rule to block 100 changes nothing already there: allowed", refuse({ kind: "addclause", target: "203", words: "Weekends are long." }) === null && refuse({ kind: "add", target: "100", words: "Be kind." }) === null);
  const same = B.byNum["203.1"];
  check("a reword that keeps 203.1's text and only sets its setting (game.timezone) is allowed: 'their settings can still be changed'",
    refuse({ kind: "amend", target: "203.1", words: "Use New York time." }, draftOf(B, req({ kind: "amend", target: "203.1", words: "x" }), "x").before_text, { "game.timezone": "America/New_York" }) === null && !!same);
  const r202 = draftOf(B, req({ kind: "amend", target: "202", words: "x", prefilled: true }), "x").before_text;
  check("rewording all of 202 is allowed while its fixed clause 202.4 stays word for word, and refused once 202.4 changes",
    refuse({ kind: "amend", target: "202", words: r202.replace("Every part of a turn is optional", "Each part of a turn is optional"), prefilled: true }) === null &&
    /rule 202\.4/.test(refuse({ kind: "amend", target: "202", words: r202.replace("Ending is final", "Ending is not final"), prefilled: true }) || ""));
  const r103 = draftOf(B, req({ kind: "amend", target: "103", words: "x", prefilled: true }), "x").before_text;
  check("text appended to a fixed clause inside a whole-rule reword changes it: refused (103.2 + 'Except ... ten proposals on Sundays.')",
    /rule 103\.2/.test(refuse({ kind: "amend", target: "103", words: r103.replace("next day's ballot.", "next day's ballot. Except that a player may confirm ten proposals on Sundays."), prefilled: true }) || ""), r103);
  check("a reword elsewhere (401) is not refused", refuse({ kind: "amend", target: "401", words: "15", prefilled: true }) === null);
}

console.log("the conflicts the moderator names (rule 108.3)");
{
  check("repealing 504 names the rules that refer to it (505 cites rule 504.2), and not 504's own clauses", referencesTo(B, "504").includes("505") && !referencesTo(B, "504").some((n) => n.startsWith("504")), J(referencesTo(B, "504")));
  check("repealing 202 names 103.3 (it cites rule 202.4) and 107.1-style references to it, never 202 itself", referencesTo(B, "202").includes("103.3") && !referencesTo(B, "202").includes("202"), J(referencesTo(B, "202")));
  check("a draft of a repeal carries those conflicts", J(drafted({ kind: "repeal", target: "504" }).d.conflicts) === J(referencesTo(B, "504")));
}

console.log("the small model's answer, checked");
{
  const r = req({ kind: "amend", target: "401", words: "make it 15" });
  const ok = readModelAnswer(B, r, '{"after_text": "A player whose proposal passes gets 15 points.", "conflicts": ["402", "999", "401", "x"], "settings": {}}');
  check("a good answer: the new text, and only conflicts that name another rule the book has (999, the target itself and junk dropped)", ok.after_text === "A player whose proposal passes gets 15 points." && J(ok.conflicts) === J(["402"]), J(ok));
  check("an answer wrapped in prose still parses when it holds one JSON object", readModelAnswer(B, r, 'Here: {"after_text": "x y", "conflicts": []}').after_text === "x y");
  check("malformed answers are refused, never guessed from: not JSON, no text, conflicts not a list, a setting the rule doesn't name",
    ["nope", "{}", '{"after_text": ""}', '{"after_text": "a", "conflicts": "402"}', '{"after_text": "a", "settings": {"max_players": 9}}', "[1,2]"].every((t) => readModelAnswer(B, r, t).error === "malformed"));
  check("a setting the target names is kept (203.1 names game.timezone)", J(readModelAnswer(B, req({ kind: "amend", target: "203.1", words: "NY" }), '{"after_text": "t", "settings": {"game.timezone": "America/New_York"}}').settings) === J({ "game.timezone": "America/New_York" }));
}

// ---------------------------------------------------------------- migration 0006 on a database with data
console.log("migration 0006");
{
  const st = newState(), cfgDir = mkdtempSync(pjoin(tmpdir(), "promptocracy-mig6-"));
  try {
    mkdirSync(pjoin(cfgDir, "m"));
    for (const f of readdirSync(pjoin(ROOT, "migrations")).filter((f) => f < "0006")) copyFileSync(pjoin(ROOT, "migrations", f), pjoin(cfgDir, "m", f));
    const cfg = pjoin(cfgDir, "wrangler.toml");
    writeFileSync(cfg, `name = "mig"\nmain = "${ROOT}/src/index.ts"\ncompatibility_date = "2026-11-01"\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "promptocracy"\ndatabase_id = "639f045e-df2d-406e-91a4-a1facc4ca2fe"\nmigrations_dir = "${cfgDir}/m"\n`);
    const W = pjoin(ROOT, "node_modules/.bin/wrangler");
    const run = (args) => execFileSync(W, [...args, "--config", cfg, "--local", "--persist-to", st], { cwd: cfgDir, encoding: "utf8", timeout: 60000, env: { ...process.env, CI: "1", NO_COLOR: "1", WRANGLER_SEND_METRICS: "false" } });
    run(["d1", "migrations", "apply", "DB"]);
    const sql = (s) => JSON.parse(run(["d1", "execute", "DB", "--json", "--command", s]).replace(/^[^[]*/, ""))[0].results;
    sql(`INSERT INTO games (id, slug, name, repo, join_code, status, created_at, day) VALUES ('gp','old-play','Old','a/c','PLAY2222','playing','2026-01-01T00:00:00Z', 1)`);
    sql(`INSERT INTO players (id, game_id, email, display_name, color, turn_order, joined_at, x, y) VALUES ('p0','gp','a@x.test','Ada','teal',0,'2026-01-01T00:00:00Z',0,0), ('p1','gp','b@x.test','Bo','cobalt',1,'2026-01-01T00:00:00Z',1,1)`);
    sql(`INSERT INTO turns (id, game_id, player_id, round, turn_index, prompt, created_at, updated_at) VALUES ('t1','gp','p1',1,1,'hi','2026-01-02T00:00:00Z','2026-01-02T00:00:00Z')`);
    const before = J([sql("SELECT * FROM games"), sql("SELECT * FROM players"), sql("SELECT * FROM turns")]);
    copyFileSync(pjoin(ROOT, "migrations", "0006_proposals.sql"), pjoin(cfgDir, "m", "0006_proposals.sql"));
    run(["d1", "migrations", "apply", "DB"]);
    check("0006 changes no existing row (games, players and the legacy turns are as they were) and adds an empty proposals table",
      J([sql("SELECT * FROM games"), sql("SELECT * FROM players"), sql("SELECT * FROM turns")]) === before && sql("SELECT COUNT(*) AS n FROM proposals")[0].n === 0 && sql("PRAGMA foreign_key_check").length === 0);
    const refused = (s) => { try { sql(s); return false; } catch { return true; } };
    const ins = (id, status, extra = "") => `INSERT INTO proposals (id, game_id, player_id, day_proposed, kind, scope, target, draft_head, drafted_by, base_sha, created_at, status${extra ? ", number, mark, day_ballot, confirmed_at" : ""}) VALUES ('${id}', 'gp', 'p0', 1, 'repeal', 'rule', '403', 'h', 'code', 's', 'x', '${status}'${extra})`;
    check("the schema holds its rules: a draft has no number; a confirmed one has its number, mark and ballot day; one confirmed a day per player; P-numbers unique per game; a player of another game is refused",
      !refused(ins("d1", "draft")) && !refused(ins("d2", "draft")) && refused(ins("c0", "confirmed")) && !refused(ins("c1", "confirmed", ", 1, 'majority', 2, 'x'")) &&
      refused(ins("c2", "confirmed", ", 2, 'majority', 2, 'x'")) && !refused(ins("w1", "withdrawn", ", 2, 'majority', 2, 'x'")) &&
      refused(`UPDATE proposals SET number = 1 WHERE id = 'w1'`) && refused(ins("c3", "confirmed", ", 3, 'majority', 5, 'x'")) &&
      refused(`INSERT INTO proposals (id, game_id, player_id, day_proposed, kind, scope, target, draft_head, drafted_by, base_sha, created_at) VALUES ('z', 'gp', 'nobody', 1, 'repeal', 'rule', '403', 'h', 'code', 's', 'x')`));
  } catch (e) {
    fail++; console.log("  FAIL  migration harness:", e?.message || e);
  } finally {
    try { rmSync(st, { recursive: true, force: true }); rmSync(cfgDir, { recursive: true, force: true }); } catch {}
  }
}

// ---------------------------------------------------------------- the model stub (recorded answers)
// POST /v1/messages answers whatever `next` holds: a recorded good answer, a malformed one, or a 500.
const model = { next: null, before: null, calls: [] };
const stubModel = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    model.calls.push({ url: req.url, key: req.headers["x-api-key"] === "stub-key-not-real", version: req.headers["anthropic-version"], body: JSON.parse(body || "{}") });
    if (model.before) { const f = model.before; model.before = null; f(); }
    const n = model.next ?? { status: 200, text: '{"after_text": "A player whose proposal passes gets 15 points.", "conflicts": ["402"], "settings": {}}' };
    res.statusCode = n.status;
    res.setHeader("content-type", "application/json");
    res.end(n.status === 200 ? J({ content: [{ type: "text", text: n.text }] }) : '{"error":"boom"}');
  });
});
await new Promise((r) => stubModel.listen(8813, "127.0.0.1", r));

const SITE = "http://localhost:8797";
let srv = null, srv2 = null, stub = null;
const state = newState(), state2 = newState();
try {
  migrate(state);
  stub = await startRulesStub(8814, { "/busterbenson/prop/main/RULES.md": "# Rules\n", "/busterbenson/nokey/main/RULES.md": "# Rules\n" });
  const g = await createGame(state, { slug: "prop", name: "Props", max: 4, rulesBase: stub.base, repo: "busterbenson/prop" });
  d1(state, "CREATE TABLE IF NOT EXISTS dev_controls (key TEXT PRIMARY KEY, value TEXT)");
  const setClock = (iso) => d1(state, `INSERT INTO dev_controls (key, value) VALUES ('clock', '${iso}') ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
  setClock("2026-03-08T19:00:00.000Z");
  srv = await startServer(state, 8797, ["DEV_MODE=1", `SITE_URL=${SITE}`, `RULES_BASE_URL=${stub.base}`, "MODEL_API_KEY=stub-key-not-real", "MODEL_BASE_URL=http://127.0.0.1:8813"]);
  const A = srv.base;
  const gid = d1(state, "SELECT id FROM games WHERE slug = 'prop'")[0].id;
  const ana = await join(A, "prop", g.code, { email: "ana@example.com", name: "Ana", color: "teal" });
  const bo = await join(A, "prop", g.code, { email: "bo@example.com", name: "Bo", color: "cobalt" });
  const cy = await join(A, "prop", g.code, { email: "cy@example.com", name: "Cy", color: "jade" });
  const rows = () => d1(state, `SELECT q.id, p.display_name AS who, q.number, q.status, q.kind, q.target, q.mark, q.day_ballot, q.drafted_by FROM proposals q JOIN players p ON p.id = q.player_id WHERE q.game_id = '${gid}' ORDER BY q.created_at, q.id`);
  const P = "/prop/api/proposals";

  console.log("before the game starts");
  const s0 = await ana.post(P, { kind: "repeal", target: "403" });
  check("in setup a draft is refused like every write (409, not started), and nothing is stored", s0.status === 409 && /not started/.test(s0.data.error) && rows().length === 0, s0.text);
  d1(state, `UPDATE games SET status = 'playing' WHERE id = '${gid}'`);
  await client(A).get("/prop/api/day"); // day 1 begins now

  console.log("drafting is free and repeatable (rule 103.1)");
  check("signed out, drafting answers 401", (await client(A).post(P, { kind: "repeal", target: "403" })).status === 401);
  const dr = await ana.post(P, { kind: "repeal", target: "403", words: "Nobody understands it." });
  const v = dr.data.proposal;
  check("a code draft: status draft, no number, the head and the tracked change, drafted by code, the need for 3 players (majority: 2 of 3)",
    dr.status === 200 && v.status === "draft" && v.n === null && v.head === "Repeal rule 403 (Paradox):" && v.after_text === "[Repealed]" && v.drafted_by === "code" && J(v.needs) === J({ mark: "majority", needed: 2, of: 3 }) && v.mine === true && !!v.id && model.calls.length === 0, dr.text);
  model.next = null;
  const dm = await ana.post(P, { kind: "reword", target: "401", words: "A passed proposal should be worth 15 points, not 10." });
  const call = model.calls.at(-1);
  check("a reword in plain words goes to the small model once: the Messages API path, the key header and version, the player's words and the rule's text in the prompt, a small model",
    dm.status === 200 && model.calls.length === 1 && call.url === "/v1/messages" && call.key === true && call.version === "2023-06-01" && call.body.model === "claude-haiku-5-5" &&
    call.body.messages[0].content.includes("worth 15 points") && call.body.messages[0].content.includes("A player whose proposal passes gets 10 points."), dm.text);
  check("...and its answer becomes the draft: 'Amend rule 401 (Points) to read:', the new text, drafted by the model, with the conflict it named (rule 108.3)",
    dm.data.proposal.head === "Amend rule 401 (Points) to read:" && dm.data.proposal.after_text === "A player whose proposal passes gets 15 points." && dm.data.proposal.drafted_by === "model" &&
    J(dm.data.proposal.conflicts) === J(["402"]) && /rule 402 \(rule 108\.3\)/.test(dm.data.proposal.conflict_note), dm.text);
  const callsPre = model.calls.length;
  model.next = { status: 200, text: '{"after_text": "IGNORED", "conflicts": ["202.2"], "settings": {}}' };
  const pre = await ana.post(P, { kind: "reword", target: "401", words: "Every player must move twice every day.", prefilled: true });
  model.next = null;
  check("an exact rewording (prefilled) keeps the player's text word for word, and the model still names the conflicts (rule 108.3): 202.2",
    pre.status === 200 && pre.data.proposal.after_text === "Every player must move twice every day." && J(pre.data.proposal.conflicts) === J(["202.2"]) && model.calls.length === callsPre + 1 &&
    model.calls.at(-1).body.messages[0].content.includes("Only name the conflicts"), pre.text);
  model.next = { status: 500 };
  const preDown = await ana.post(P, { kind: "reword", target: "401", words: "Every player gets 12 points.", prefilled: true });
  model.next = null;
  check("...and if the model is down, the exact text still drafts (no conflicts named)", preDown.status === 200 && J(preDown.data.proposal.conflicts) === J([]), preDown.text);
  model.next = { status: 200, text: "I think the rule should say 15." };
  const bad = await ana.post(P, { kind: "reword", target: "401", words: "15 points" });
  model.next = { status: 500 };
  const down = await ana.post(P, { kind: "reword", target: "401", words: "15 points" });
  model.next = null;
  check("a malformed model answer and a failing model both answer 502 with a plain reason, and store nothing", bad.status === 502 && bad.data.drafting === "malformed" && down.status === 502 && down.data.drafting === "failed" && rows().length === 4, bad.text + down.text);
  const fx = await ana.post(P, { kind: "repeal", target: "107" });
  check("a proposal that would change a fixed part is refused when it is drafted (422, rule 110.1), and stores nothing", fx.status === 422 && fx.data.rule === "110.1" && /rule 107\.1/.test(fx.data.error) && rows().length === 4, fx.text);
  const cf = await ana.post(P, { kind: "repeal", target: "504" });
  check("a repeal names the rules it would leave pointing at nothing (505 cites 504.2)", cf.status === 200 && cf.data.proposal.conflicts.includes("505") && /rule 505/.test(cf.data.proposal.conflict_note), cf.text);

  console.log("confirm: one proposal a day, numbered in confirm order (rule 103.2)");
  const [ca, cb] = await Promise.all([ana.post(`${P}/${v.id}/confirm`, {}), ana.post(`${P}/${dm.data.proposal.id}/confirm`, {})]);
  const okOne = [ca, cb].filter((r) => r.status === 200), noOne = [ca, cb].filter((r) => r.status === 409);
  check("two of Ana's drafts confirmed at the same moment: exactly one lands (P1), the other is refused 'You already proposed today. One proposal a day.'",
    okOne.length === 1 && noOne.length === 1 && noOne[0].data.error === "You already proposed today. One proposal a day." && okOne[0].data.proposal.n === "P1" && okOne[0].data.message === "P1 is on tomorrow's ballot." &&
    rows().filter((r) => r.status === "confirmed").length === 1, ca.text + " | " + cb.text);
  const anaP1 = okOne[0].data.proposal;
  const anaOther = anaP1.id === v.id ? dm.data.proposal.id : v.id;
  check("after confirming, Ana can't draft more today (409), and /api/day says she proposed", (await ana.post(P, { kind: "repeal", target: "402" })).status === 409 && (await ana.get("/prop/api/day")).data.you.proposed === true && (await ana.get("/prop/api/day")).data.you.can.propose.allowed === false);
  const bd = await bo.post(P, { kind: "mark", target: "102" });
  const cyd = await cy.post(P, { kind: "add", target: "400", words: "A tie goes to the older player." });
  const [bc, cc] = await Promise.all([bo.post(`${P}/${bd.data.proposal.id}/confirm`, {}), cy.post(`${P}/${cyd.data.proposal.id}/confirm`, {})]);
  check("Bo and Cy confirm at the same moment: both land, with the next two numbers, no number twice", bc.status === 200 && cc.status === 200 && J([bc.data.proposal.number, cc.data.proposal.number].sort()) === J([2, 3]), bc.text + cc.text);
  check("the mark is fixed at confirm (rule 105.4): NULL while a draft, stored on confirm from the marks then (Bo's unlock of 102, in block 100: its current mark, unanimous; Cy's new rule in 400: majority)",
    d1(state, `SELECT COUNT(*) AS n FROM proposals WHERE status = 'draft' AND mark IS NOT NULL`)[0].n === 0 && bc.data.proposal.mark === "unanimous" && cc.data.proposal.mark === "majority" && rows().filter((r) => r.number).every((r) => r.day_ballot === 2), J(rows()));
  const reconfirm = await bo.post(`${P}/${bd.data.proposal.id}/confirm`, {});
  check("confirming the same draft twice answers 409 'That is already P2.' (or P3), and another player's draft is not yours to confirm (404)", reconfirm.status === 409 && /already P[23]/.test(reconfirm.data.error) && (await bo.post(`${P}/${anaOther}/confirm`, {})).status === 404, reconfirm.text);

  console.log("hidden until tomorrow; nothing about votes leaks");
  d1(state, `UPDATE proposals SET yes = 7, no = 8, absent = 9, needed = 6, electorate = 5, why = 'qa-fixture-why' WHERE game_id = '${gid}' AND number IS NOT NULL`);
  const lb = await bo.get(P), la = await client(A).get(P);
  check("today Bo sees only his own confirmed proposal (mine, with its id); signed out sees none: another player's proposal waits for the ballot",
    lb.status === 200 && lb.data.proposals.length === 1 && lb.data.proposals[0].mine === true && lb.data.proposals[0].n === bc.data.proposal.n && !!lb.data.proposals[0].id && la.data.proposals.length === 0, lb.text + la.text);
  const leak = (t) => /qa-fixture-why|"yes"|"no"|"absent"|"electorate"|"why"/.test(t);
  const gameView = await bo.get("/prop/api/game"), dayView = await bo.get("/prop/api/day");
  check("no view carries the count's columns (yes, no, absent, needed, electorate, why): /api/proposals, /api/game, /api/day, a draft, a confirm",
    !leak(lb.text) && !leak(gameView.text) && !leak(dayView.text) && !leak(bc.text) && !leak(dr.text) && !lb.data.proposals.some((p) => "needed" in p), lb.text);
  check("the day log says who proposed, not what (the change stays hidden until the ballot)", d1(state, `SELECT text FROM events WHERE game_id = '${gid}' AND kind = 'proposal_confirmed' ORDER BY id`).map((e) => e.text).join("|") === "Ana (Teal) proposed a change.|Bo (Cobalt) proposed a change.|Cy (Jade) proposed a change." || d1(state, `SELECT COUNT(*) AS n FROM events WHERE game_id = '${gid}' AND kind = 'proposal_confirmed'`)[0].n === 3);
  d1(state, `UPDATE proposals SET yes = NULL, no = NULL, absent = NULL, needed = NULL, electorate = NULL, why = NULL WHERE game_id = '${gid}'`);

  console.log("withdraw (rule 103.3)");
  const w1 = await ana.post(`${P}/${anaP1.id}/withdraw`, {});
  check("Ana withdraws P1: 200; it keeps its number, the day's proposal is free again, and the log says so", w1.status === 200 && w1.data.withdrawn === "P1" && rows().find((r) => r.number === 1).status === "withdrawn" && (await ana.get("/prop/api/day")).data.you.proposed === false, w1.text);
  const again = await ana.post(`${P}/${anaOther}/confirm`, {});
  check("...so she can confirm her other draft: it gets the next number, P4 (P1 is not reused)", again.status === 200 && again.data.proposal.n === "P4", again.text);
  check("withdrawing twice answers 409", (await ana.post(`${P}/${anaP1.id}/withdraw`, {})).status === 409);

  console.log("End turn and the lock block proposals");
  const cyP = cc.data.proposal;
  await cy.post("/prop/api/end-turn", {});
  const cw = await cy.post(`${P}/${cyP.id}/withdraw`, {}), cdr = await cy.post(P, { kind: "repeal", target: "402" });
  check("after End turn Cy can neither withdraw nor draft: 409 'Your turn has ended for today.'", [cw, cdr].every((r) => r.status === 409 && r.data.error === "Your turn has ended for today."), cw.text + cdr.text);
  const bd2 = await bo.post(P, { kind: "repeal", target: "402" }); // a draft, kept for after midnight
  check("Bo's second draft today is refused: he already confirmed", bd2.status === 409);
  const anaDraft = await ana.post(P, { kind: "repeal", target: "402" });
  check("Ana (P4 confirmed) can't draft either", anaDraft.status === 409);
  d1(state, `UPDATE proposals SET status = 'withdrawn', withdrawn_at = 'x' WHERE id = '${again.data.proposal.id}'`);
  const late = await ana.post(P, { kind: "repeal", target: "402" });
  d1(state, `UPDATE proposals SET status = 'confirmed', withdrawn_at = NULL WHERE id = '${again.data.proposal.id}'`);
  setClock("2026-03-09T07:00:00.000Z"); // midnight exactly; the cron has not run
  const lk = [await ana.post(P, { kind: "repeal", target: "402" }), await ana.post(`${P}/${late.data.proposal.id}/confirm`, {}), await ana.post(`${P}/${again.data.proposal.id}/withdraw`, {}), await ana.post("/prop/api/turn", { kind: "repeal", target: "402" })];
  check("at midnight exactly (before the cron): draft, confirm, withdraw and /api/turn all answer 423 'Chalant is processing day 1'", lk.every((r) => r.status === 423 && r.data.error === LOCK1 && r.data.processing_day === 1), lk.map((r) => r.status + " " + r.text).join(" | "));
  check("...and nothing changed", rows().find((r) => r.id === again.data.proposal.id).status === "confirmed" && rows().find((r) => r.id === late.data.proposal.id).status === "draft");

  console.log("the next day's ballot");
  await (await fetch(`${A}/__scheduled?cron=*/5+*+*+*+*`, { signal: AbortSignal.timeout(20000) })).text();
  const after = rows();
  check("the midnight run puts day 1's confirmed proposals on day 2's ballot (P2, P3, P4), the withdrawn P1 stays withdrawn, drafts stay drafts, marks unchanged",
    J(after.filter((r) => r.number).map((r) => [r.number, r.status, r.day_ballot]).sort((a, b) => a[0] - b[0])) === J([[1, "withdrawn", 2], [2, "on_ballot", 2], [3, "on_ballot", 2], [4, "on_ballot", 2]]) &&
    after.filter((r) => !r.number).every((r) => r.status === "draft") && after.find((r) => r.number === 2).mark === bc.data.proposal.mark, J(after));
  const pub = await client(A).get(P);
  check("on day 2 everyone sees the ballot (P2, P3, P4) with who proposed and the tracked change, still with no votes", pub.data.ballot.join() === "P2,P3,P4" && pub.data.proposals.every((p) => p.by && p.head && p.id === undefined && p.words === undefined) && !leak(pub.text), pub.text);
  check("?rule=102 narrows to the proposals on rule 102", J((await client(A).get(`${P}?rule=102`)).data.proposals.map((p) => p.target)) === J(["102"]));
  const ow = await ana.post(`${P}/${again.data.proposal.id}/withdraw`, {}), oc = await ana.post(`${P}/${late.data.proposal.id}/confirm`, {});
  check("on the ballot a proposal can no longer be withdrawn (409), and a draft from day 1 can't be confirmed on day 2 (409, draft it again)", ow.status === 409 && /on the ballot/.test(ow.data.error) && oc.status === 409 && /from day 1/.test(oc.data.error), ow.text + oc.text);
  const t2 = await bo.post("/prop/api/turn", { kind: "addclause", target: "401", words: "Points are whole numbers." });
  check("/api/turn is draft + confirm in one call: Bo's day-2 proposal is P5 on day 3's ballot; a bare {prompt} is refused with what to send",
    t2.status === 200 && t2.data.proposal.n === "P5" && t2.data.proposal.day_ballot === 3 && (await cy.post("/prop/api/turn", { prompt: "Make it rain." })).status === 400, t2.text);

  console.log("guards: stale drafts, the draft cap, filters, and each write's own SQL");
  const cyd2 = await cy.post(P, { kind: "repeal", target: "402" });
  d1(state, `UPDATE proposals SET base_sha = 'stale' WHERE id = '${cyd2.data.proposal.id}'`);
  const stale = await cy.post(`${P}/${cyd2.data.proposal.id}/confirm`, {});
  check("a draft made against rules that have since changed (another bundle) can't be confirmed: 409, draft it again", stale.status === 409 && /rules have changed/.test(stale.data.error), stale.text);
  const cyId = d1(state, `SELECT id FROM players WHERE display_name = 'Cy'`)[0].id;
  // The model answers after midnight: the request began before it, so only a clock read after the answer catches it.
  const end2 = d1(state, `SELECT ends_at FROM days WHERE game_id = '${gid}' AND n = 2`)[0].ends_at;
  const clockNow2 = d1(state, "SELECT value FROM dev_controls WHERE key = 'clock'")[0].value;
  const cyRows = () => d1(state, `SELECT COUNT(*) AS n FROM proposals WHERE player_id = '${cyId}' AND day_proposed = 2`)[0].n;
  const beforeSlow = cyRows();
  model.before = () => setClock(new Date(Date.parse(end2) + 1000).toISOString());
  const slowTurn = await cy.post("/prop/api/turn", { kind: "reword", target: "401", words: "16 points" });
  setClock(clockNow2);
  check("a draft whose model answer arrives after midnight meets the lock: /api/turn answers 423 and writes nothing (no draft, no proposal)",
    slowTurn.status === 423 && /processing day 2/.test(slowTurn.data.error) && cyRows() === beforeSlow, slowTurn.text);
  d1(state, `UPDATE draft_attempts SET n = 29 WHERE game_id = '${gid}' AND player_id = '${cyId}' AND day = 2`);
  model.next = { status: 200, text: "garbled" };
  const g29 = await cy.post(P, { kind: "reword", target: "401", words: "15" });
  model.next = null;
  const before30 = model.calls.length;
  const g30 = await cy.post(P, { kind: "reword", target: "401", words: "15" });
  check("every draft attempt counts toward the 30 a day, a garbled one too, and the cap is checked before the model is called (429, no model call)",
    g29.status === 502 && g30.status === 429 && model.calls.length === before30 && d1(state, `SELECT n FROM draft_attempts WHERE game_id = '${gid}' AND player_id = '${cyId}' AND day = 2`)[0].n === 30, g29.text + g30.text);
  d1(state, `UPDATE draft_attempts SET n = 29 WHERE game_id = '${gid}' AND player_id = '${cyId}' AND day = 2`);
  const callsPar = model.calls.length;
  const par = await Promise.all([cy.post(P, { kind: "reword", target: "401", words: "16" }), cy.post(P, { kind: "reword", target: "401", words: "17" })]);
  check("the cap holds under parallel drafts: at 29, two at once give exactly one draft (one model call) and one 429",
    J(par.map((r) => r.status).sort()) === J([200, 429]) && model.calls.length === callsPar + 1, par.map((r) => r.text).join(" | "));
  check("?rule= is matched exactly, not as a pattern: ?rule=%, _ and . match nothing", (await client(A).get(`${P}?rule=%25`)).data.proposals.length === 0 && (await client(A).get(`${P}?rule=_`)).data.proposals.length === 0 && (await client(A).get(`${P}?rule=.`)).data.proposals.length === 0);
  const lit = (x) => (x === null ? "NULL" : typeof x === "number" ? String(x) : `'${String(x).replace(/'/g, "''")}'`);
  const sqlRun = (q, binds) => { let i = 0; d1(state, q.replace(/\?/g, () => lit(binds[i++]))); };
  const ends2 = d1(state, `SELECT ends_at FROM days WHERE game_id = '${gid}' AND n = 2`)[0].ends_at;
  const past = new Date(Date.parse(ends2) + 1000).toISOString(), justBefore = new Date(Date.parse(ends2) - 1000).toISOString();
  const boId = d1(state, `SELECT id FROM players WHERE display_name = 'Bo'`)[0].id;
  const draftRow = (id, iso) => sqlRun(DRAFT_INSERT_SQL, [id, boId, "repeal", "rule", "402", null, null, "", null, "h", "", "", "[]", "{}", "code", "s", iso, gid, ...dayOpenBinds(2, Date.parse(iso), boId)]);
  draftRow("qa-fixture-d1", past); draftRow("qa-fixture-d2", justBefore);
  check("the draft INSERT's own guard: with a time past day 2's midnight it lands nothing; 1 s before, it lands", J(d1(state, "SELECT id FROM proposals WHERE id LIKE 'qa-fixture-%'").map((r) => r.id)) === J(["qa-fixture-d2"]));
  const p5 = t2.data.proposal.number;
  const p5id = d1(state, `SELECT id FROM proposals WHERE game_id = '${gid}' AND number = ${p5}`)[0].id;
  sqlRun(WITHDRAW_SQL, [past, p5id, 2, ...dayOpenBinds(2, Date.parse(past), boId)]);
  const w5a = d1(state, `SELECT status FROM proposals WHERE id = '${p5id}'`)[0].status;
  sqlRun(WITHDRAW_SQL, [justBefore, p5id, 2, ...dayOpenBinds(2, Date.parse(justBefore), boId)]);
  check("the withdraw UPDATE's own guard: past midnight it changes nothing; 1 s before, it withdraws", w5a === "confirmed" && d1(state, `SELECT status FROM proposals WHERE id = '${p5id}'`)[0].status === "withdrawn");
  d1(state, "DELETE FROM proposals WHERE id LIKE 'qa-fixture-%'");
  // (CONFIRM_SQL's own guard is run 1 s either side of midnight in tests/day.mjs.)

  console.log("no key: rewording is unavailable, the rest still works");
  migrate(state2);
  const g2 = await createGame(state2, { slug: "nokey", name: "No key", max: 4, rulesBase: stub.base, repo: "busterbenson/nokey" });
  srv2 = await startServer(state2, 8798, ["DEV_MODE=1", "SITE_URL=http://localhost:8798", `RULES_BASE_URL=${stub.base}`]);
  const dee = await join(srv2.base, "nokey", g2.code, { email: "dee@example.com", name: "Dee", color: "teal" });
  startPlaying(state2, "nokey");
  const calls = model.calls.length;
  const nr = await dee.post("/nokey/api/proposals", { kind: "reword", target: "401", words: "15 points" });
  const nm = await dee.post("/nokey/api/proposals", { kind: "repeal", target: "403" });
  check("without MODEL_API_KEY a reword in plain words answers 503 'drafting is unavailable' (no model call); a repeal still drafts",
    nr.status === 503 && nr.data.drafting === "unavailable" && /unavailable/.test(nr.data.error) && model.calls.length === calls && nm.status === 200 && nm.data.proposal.drafted_by === "code", nr.text + nm.text);
} catch (e) {
  fail++;
  console.log("  FAIL  harness error:", e?.stack || e, e?.cause);
  if (srv) console.log(srv.log().slice(-2500));
} finally {
  await srv?.stop(); await srv2?.stop(); await stub?.stop();
  await new Promise((r) => stubModel.close(r));
  for (const s of [state, state2]) try { rmSync(s, { recursive: true, force: true }); } catch {}
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
