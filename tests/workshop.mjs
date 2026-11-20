// The Workshop, step 1 (rules 801-804): a player opens a draft ticket and fills it in by hand, confirming it is one of their
// proposals for the day (through the shared confirm and its limit), it rides tomorrow's ballot as a commission row, the count
// pays its price and approves it (queue order) or refuses it, the moderator never sees it, anyone in the game can post in its
// thread (a visitor can't), and the MCP tools read the list and post. The pure parts first, then a real `wrangler dev` on a
// LOCAL D1. Run: node tests/workshop.mjs  (migration 0009 itself is proved in tests/workshop-migration.mjs).
import { createHash } from "node:crypto";
import { client, connect, createGame, d1, join, migrate, newState, freePort, startRulesStub, startServer, tool } from "./lib.mjs";
import { LIMITS, canPost, confirmProblem, readFields, readMakes, readPost, ticketNumber } from "../src/lib/tickets.js";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name}${detail ? "  -> " + detail : ""}`); } };
const J = JSON.stringify;

// ---------------------------------------------------------------- the pure parts
console.log("a ticket's fields (rules 801.2, 801.3)");
check("a ticket number reads as W3, w3 or 3, and nothing else", ticketNumber("W3") === 3 && ticketNumber("w12") === 12 && ticketNumber(3) === 3 && ticketNumber("P3") === null && ticketNumber("W") === null && ticketNumber("W3x") === null && ticketNumber(null) === null);
check("what it makes: catalog entries by name and rules by number; duplicates fold; anything else is refused with the reason",
  J(readMakes([{ kind: "entry", name: " Dragon " }, { kind: "rule", num: "801.2" }, { kind: "entry", name: "dragon" }, { kind: "rule", num: "801.2" }]).makes) === J([{ kind: "entry", name: "Dragon" }, { kind: "rule", num: "801.2" }]) &&
  /not a rule number/.test(readMakes([{ kind: "rule", num: "x" }]).error) && /needs a name/.test(readMakes([{ kind: "entry", name: " " }]).error) && /list/.test(readMakes("dragon").error) &&
  /at most 12/.test(readMakes(Array.from({ length: 13 }, (_, i) => ({ kind: "entry", name: "e" + i }))).error) && "error" in readMakes([{ kind: "tile", name: "x" }]));
check("fields are read only when present; limits are enforced: title 80, brief 2000, estimate a whole number of nights, 20 tasks",
  J(readFields({ title: "  A  dragon ", estimate: "3", tasks: ["a", " ", { text: "b" }] }).fields) === J({ title: "A dragon", estimate: 3, tasks: ["a", "b"] }) &&
  "error" in readFields({ title: "x".repeat(81) }) && "error" in readFields({ brief: "x".repeat(2001) }) && "error" in readFields({ estimate: 0 }) && "error" in readFields({ estimate: 1.5 }) &&
  "error" in readFields({ estimate: 100 }) && "error" in readFields({ tasks: Array.from({ length: 21 }, () => "t") }) && "error" in readFields({ tasks: "no" }) && "error" in readFields(null));
check("a draft can be confirmed only with a title, a brief, and (801.3) something to make; naming nothing is a refusal, not just an unfinished form",
  confirmProblem({ title: "", brief: "b", makes: [{}] }).refuse !== true && confirmProblem({ title: "t", brief: " ", makes: [{}] }).refuse !== true &&
  confirmProblem({ title: "t", brief: "b", makes: "[]" }).refuse === true && /names nothing to make/.test(confirmProblem({ title: "t", brief: "b", makes: [] }).error) &&
  confirmProblem({ title: "t", brief: "b", makes: '[{"kind":"entry","name":"x"}]' }) === null);
check("anyone signed in to the game can post (a visitor can't); a post is 1 to 2000 characters", canPost({ id: "p" }).allowed && !canPost(null).allowed && readPost({ body: "  hi " }).body === "hi" && "error" in readPost({ body: " " }) && "error" in readPost({ body: "x".repeat(LIMITS.post + 1) }));

// ---------------------------------------------------------------- end to end
const SRV_PORT = await freePort();
const SITE = `http://localhost:${SRV_PORT}`;
const TOKEN = "mod-token-0123456789abcdefghij";
const SHA1 = "a".repeat(40);
let srv = null, stub = null;
const state = newState();
try {
  migrate(state);
  stub = await startRulesStub(await freePort(), { "/busterbenson/wk/main/RULES.md": "# Rules\n" });
  const g = await createGame(state, { slug: "wk", name: "Workshop", max: 6, rulesBase: stub.base, repo: "busterbenson/wk" });
  d1(state, "CREATE TABLE IF NOT EXISTS dev_controls (key TEXT PRIMARY KEY, value TEXT)");
  const dev = (k, v) => d1(state, `INSERT INTO dev_controls (key, value) VALUES ('${k}', '${v}') ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
  dev("clock", "2026-11-10T19:00:00.000Z");
  srv = await startServer(state, SRV_PORT, ["DEV_MODE=1", `SITE_URL=${SITE}`, `RULES_BASE_URL=${stub.base}`]);
  const A = srv.base;
  const gid = d1(state, "SELECT id FROM games WHERE slug = 'wk'")[0].id;
  const names = ["Ana", "Bo", "Cy"];
  const who = {};
  for (let i = 0; i < 3; i++) who[names[i]] = await join(A, "wk", g.code, { email: `${names[i].toLowerCase()}@example.com`, name: names[i], color: ["teal", "cobalt", "jade"][i] });
  const { Ana, Bo, Cy } = who;
  const visitor = client(A);
  const id = Object.fromEntries(names.map((n) => [n, d1(state, `SELECT id FROM players WHERE game_id = '${gid}' AND display_name = '${n}'`)[0].id]));
  const score = (n) => d1(state, `SELECT score FROM players WHERE id = '${id[n]}'`)[0].score;
  const cron = async () => { const r = await fetch(`${A}/__scheduled?cron=*/5+*+*+*+*`, { signal: AbortSignal.timeout(20000) }); await r.text(); return r.status; };
  const day = (n) => d1(state, `SELECT n, status, ends_at, deadline_at FROM days WHERE game_id = '${gid}' AND n = ${n}`)[0];
  const game = () => d1(state, `SELECT status, day, phase FROM games WHERE id = '${gid}'`)[0];
  const plus = (iso, min) => new Date(Date.parse(iso) + min * 60_000).toISOString();
  const midnight = async () => { const d = day(game().day); dev("clock", plus(d.ends_at, 1)); await cron(); return day(d.n); };
  const tk = (n) => d1(state, `SELECT * FROM tickets WHERE game_id = '${gid}' AND number = ${n}`)[0];
  const prop = (n) => d1(state, `SELECT number, kind, scope, target, status, mark, day_ballot, title, words, decided_at FROM proposals WHERE game_id = '${gid}' AND number = ${n}`)[0];
  // a kept-alive socket the dev server closed while a blocking d1() call ran resets on reuse: retry once, as the client does
  const rf = (u, o) => fetch(u, o).catch(() => fetch(u, o));
  const T = "/wk/api/tickets";
  const good = (o = {}) => ({ title: "A dragon", brief: "A dragon that sleeps on the north hill.", makes: [{ kind: "entry", name: "Dragon" }, { kind: "rule", num: "801.2" }], estimate: 2, running_cost: "Nothing.", tasks: ["Draw the dragon", "Give it a tile"], ...o });
  // Open a draft, fill it in and confirm it: the ticket's own number, the proposal's number.
  const commission = async (c, fields = good(), existing = null) => {
    const o = existing ? null : await c.post(T, {});
    const n = existing || o.data?.ticket;
    const e = await c.post(`${T}/${n}/edit`, fields);
    const k = await c.post(`${T}/${n}/confirm`, {});
    return { n, o, e, k };
  };

  d1(state, `UPDATE games SET status = 'playing' WHERE id = '${gid}'`);
  await client(A).get("/wk/api/day");

  console.log("opening a draft (rule 801.2): Commission something");
  check("signed out: 401; the list is public and empty", (await visitor.post(T, {})).status === 401 && (await visitor.get(T)).data?.tickets?.length === 0);
  const o1 = await Ana.post(T, {});
  check("Ana's first ticket is W1, a draft with no title, price 0 and the reason 'No Gremlin yet.'", o1.status === 200 && o1.data.ticket === "W1" && o1.data.existing === false && tk(1).state === "Draft" && tk(1).price === 0 && tk(1).price_reason === "No Gremlin yet." && tk(1).proposal_id === null, o1.text);
  const o1b = await Ana.post(T, {});
  check("opening again gives the same blank draft: no W2, no wasted number", o1b.data.ticket === "W1" && o1b.data.existing === true && d1(state, "SELECT COUNT(*) AS n FROM tickets")[0].n === 1);
  const racing = await Promise.all([Bo.post(T, {}), Bo.post(T, {})]);
  check("two clicks racing make one blank draft", racing.every((r) => r.status === 200 && r.data.ticket === "W2") && d1(state, "SELECT COUNT(*) AS n FROM tickets")[0].n === 2, racing.map((r) => r.text).join(" | "));
  check("a draft is its requester's alone: another player and a visitor get 404 on its page and don't see it in the list; Ana does",
    (await Bo.get(`${T}/W1`)).status === 404 && (await visitor.get(`${T}/W1`)).status === 404 && (await Bo.get(T)).data.tickets.map((t) => t.n).join() === "W2" && (await Ana.get(T)).data.tickets.map((t) => t.n).join() === "W1");
  check("a ticket page that does not exist, or a malformed number, is a 404", (await Ana.get(`${T}/W99`)).status === 404 && (await Ana.get(`${T}/banana`)).status === 404);

  console.log("filling it in by hand");
  const bad = await Promise.all([
    Ana.post(`${T}/W1/edit`, { makes: [{ kind: "rule", num: "nope" }] }), Ana.post(`${T}/W1/edit`, { estimate: 0 }), Ana.post(`${T}/W1/edit`, { title: "x".repeat(81) }),
    Ana.post(`${T}/W1/edit`, { tasks: "no" }), Ana.post(`${T}/W1/edit`, "not an object"),
  ]);
  check("a bad field is a 400 with the reason, and nothing is written", bad.every((r) => r.status === 400 && r.data.error) && tk(1).title === "" && tk(1).estimate === 1);
  check("another player's draft can't be edited (404), nor can a visitor's request (401)", (await Bo.post(`${T}/W1/edit`, { title: "mine now" })).status === 404 && (await visitor.post(`${T}/W1/edit`, { title: "x" })).status === 401 && tk(1).title === "");
  const ed = await Ana.post(`${T}/W1/edit`, good({ title: "Placeholder" }));
  check("edit writes the fields and the tasks in order, and the page shows them", ed.status === 200 && ed.data.ticket.title === "Placeholder" && J(ed.data.ticket.makes) === J(good().makes) && ed.data.ticket.estimate === 2 && ed.data.ticket.tasks.map((t) => t.text).join("|") === "Draw the dragon|Give it a tile" && ed.data.ticket.can.confirm.allowed === true, ed.text);
  const ed2 = await Ana.post(`${T}/W1/edit`, { title: "A dragon", tasks: ["Only one"] });
  check("an edit changes only the fields it names; tasks are replaced as a list", ed2.data.ticket.title === "A dragon" && ed2.data.ticket.brief.startsWith("A dragon that") && ed2.data.ticket.tasks.length === 1);

  console.log("801.3: a commission that names nothing to make is refused");
  await Ana.post(`${T}/W1/edit`, good({ makes: [] }));
  const miss = await Ana.post(`${T}/W1/edit`, { title: "" });
  const noTitle = await Ana.post(`${T}/W1/confirm`, {});
  check("no title: 400, still a draft, no proposal made", miss.status === 200 && noTitle.status === 400 && tk(1).state === "Draft" && d1(state, "SELECT COUNT(*) AS n FROM proposals")[0].n === 0, noTitle.text);
  await Ana.post(`${T}/W1/edit`, { title: "Nothing dragon" });
  const refused = await Ana.post(`${T}/W1/confirm`, {});
  check("naming nothing to make: 422 with the reason, the ticket Refused and logged, and no proposal is made", refused.status === 422 && /names nothing to make/.test(refused.data.error) && tk(1).state === "Refused" && d1(state, `SELECT text FROM ticket_log WHERE ticket_id = '${tk(1).id}'`)[0].text === "Refused: it names nothing to make." && d1(state, "SELECT COUNT(*) AS n FROM proposals")[0].n === 0, refused.text);
  check("a refused ticket can't be edited or confirmed again (409), and Ana is free to open a new draft", (await Ana.post(`${T}/W1/edit`, { title: "x" })).status === 409 && (await Ana.post(`${T}/W1/confirm`, {})).status === 409);

  console.log("801.1: confirming is one of your proposals for the day");
  const a = await commission(Ana, good());
  check("Ana's next ticket is W3 (numbers are never reused); confirming makes P1: a commission proposal on block 800, majority, on tomorrow's ballot",
    a.n === "W3" && a.k.status === 200 && a.k.data.ticket.state === "Proposed" && a.k.data.ticket.proposal === "P1" && /W3 is P1 on tomorrow's ballot/.test(a.k.data.message), a.k.text);
  const p1 = prop(1);
  check("the proposal row: kind commission, scope block, target 800, mark majority, ballot day 2, titled and worded from the ticket; the ticket points at it",
    p1.kind === "commission" && p1.scope === "block" && p1.target === "800" && p1.mark === "majority" && p1.day_ballot === 2 && p1.status === "confirmed" && p1.title === "A dragon" && p1.words.startsWith("A dragon that") && tk(3).proposal_id === d1(state, "SELECT id FROM proposals WHERE number = 1")[0].id && tk(3).state === "Proposed");
  check("the ticket log says it was put on the ballot; a proposed ticket can't be edited (409)", d1(state, `SELECT text FROM ticket_log WHERE ticket_id = '${tk(3).id}'`).map((r) => r.text).join() === "Put on tomorrow's ballot as P1." && (await Ana.post(`${T}/W3/edit`, { title: "x" })).status === 409);
  const mineList = (await Ana.get("/wk/api/proposals")).data;
  const hidden = (await Bo.get("/wk/api/proposals")).data;
  check("it is hidden from others until it is on the ballot (like any proposal), and Ana sees her own with its ticket", hidden.proposals.length === 0 && mineList.proposals.length === 1 && mineList.proposals[0].kind === "commission" && mineList.proposals[0].ticket.n === "W3");
  console.log("the day's limit is the proposals' own (rule 103.2)");
  const second = await commission(Ana, good({ title: "A second thing" }));
  check("a second commission the same day is refused with the proposals' own sentence, and leaves no stray proposal row", second.k.status === 409 && /already proposed today/.test(second.k.data.error) && d1(state, "SELECT COUNT(*) AS n FROM proposals WHERE kind = 'commission'")[0].n === 1 && tk(4).state === "Draft" && tk(4).proposal_id === null, second.k.text);
  const ordinary = await Ana.post("/wk/api/proposals", { kind: "repeal", target: "403" });
  check("and an ordinary proposal the same day is refused too: a commission counts as the day's proposal", ordinary.status === 409 && /already proposed today/.test(ordinary.data.error), ordinary.text);
  console.log("withdrawing a commission");
  const wd = await Ana.post(`/wk/api/proposals/${d1(state, "SELECT id FROM proposals WHERE number = 1")[0].id}/withdraw`, {});
  check("withdrawing it sends the ticket back to a draft, unlinked, with a log line", wd.status === 200 && tk(3).state === "Draft" && tk(3).proposal_id === null && d1(state, `SELECT kind FROM ticket_log WHERE ticket_id = '${tk(3).id}' ORDER BY id`).map((r) => r.kind).join() === "proposed,withdrawn", wd.text);
  check("her draft W4 and W3 are both drafts now, so confirming W3 again is P2 (P1 keeps its number, withdrawn)", (await Ana.post(`${T}/W3/confirm`, {})).data?.ticket?.proposal === "P2" && prop(1).status === "withdrawn");

  console.log("day 1: Bo's commission with a price, Cy's ordinary proposal");
  const b = await commission(Bo, good({ title: "A lantern", brief: "A lantern that never goes out.", makes: [{ kind: "entry", name: "Lantern" }], estimate: 1, tasks: [] }));
  check("Bo's W2 is P3", b.n === "W2" && b.k.data.ticket.proposal === "P3");
  const cyp = await Cy.post("/wk/api/proposals", { kind: "repeal", target: "403" });
  await Cy.post(`/wk/api/proposals/${cyp.data.proposal.id}/confirm`, {});
  check("Cy's ordinary proposal is P4", prop(4)?.kind === "repeal");
  // The prices: Gremlin sets them later; for the count's sake Ana's commission costs 3 and she has 5.
  d1(state, `UPDATE tickets SET price = 3, price_reason = 'Test price.' WHERE number = 3; UPDATE players SET score = 5 WHERE id = '${id.Ana}'`);

  console.log("midnight: the ballot");
  await midnight();
  const bal = (await Ana.get("/wk/api/ballot")).data;
  const row = bal.items.find((i) => i.kind === "commission" && i.ticket.n === "W3");
  check("the commission is a row on day 2's ballot with its title, brief, estimate and price (and the votes it needs, majority 2 of 3)",
    bal.items.length === 3 && row && row.n === "P2" && row.ticket.title === "A dragon" && row.ticket.brief.startsWith("A dragon that") && row.ticket.estimate === 2 && row.ticket.price === 3 && row.ticket.price_reason === "Test price." && J(row.needs) === J({ mark: "majority", needed: 2, of: 3 }) && row.can_vote.allowed, J(row));
  check("the ballot row carries no player id or email", !/@example\.com/.test(J(bal)) && !J(bal).includes(id.Ana));
  const yes = async (c, n, v = "yes") => (await c.post("/wk/api/votes", { proposal: n, vote: v })).status;
  // P2 (Ana's W3, price 3): yes x3. P3 (Bo's W2): yes from Ana and Bo, no from Cy. P4 (Cy's ordinary): yes x2.
  const votes = [];
  for (const c of [Ana, Bo, Cy]) votes.push(await yes(c, "P2"));
  votes.push(await yes(Ana, "P3"), await yes(Bo, "P3"), await yes(Cy, "P3", "no"), await yes(Ana, "P4"), await yes(Bo, "P4"));
  check("a commission is voted on like any proposal", votes.every((s) => s === 200));

  console.log("the count: the price is paid, the tickets are approved in the order passed, the moderator sees only the ordinary change");
  d1(state, `UPDATE games SET moderator_token_hash = '${createHash("sha256").update(TOKEN).digest("hex")}' WHERE id = '${gid}'`);
  const d2 = await midnight();
  check("P2 and P3 are approved (not 'passed': nothing for the moderator to apply); P4 passed", prop(2).status === "approved" && prop(3).status === "approved" && prop(4).status === "passed", J([prop(2), prop(3), prop(4)]));
  check("W3 is Approved, first in the queue; W2 second; each with its log line", tk(3).state === "Approved" && tk(3).queue_pos === 1 && tk(2).state === "Approved" && tk(2).queue_pos === 2 &&
    /Approved: P2 passed\. Paid 3 points\. Place 1 in the queue\./.test(d1(state, `SELECT text FROM ticket_log WHERE ticket_id = '${tk(3).id}' AND kind = 'approved'`)[0].text) &&
    /Approved: P3 passed\. Place 2 in the queue\./.test(d1(state, `SELECT text FROM ticket_log WHERE ticket_id = '${tk(2).id}' AND kind = 'approved'`)[0].text));
  check("the price came out of Ana's points (5 to 2), once; Bo's free commission cost nothing", score("Ana") === 2 && tk(3).paid === 3 && !!tk(3).paid_at && score("Bo") === 0 && tk(2).paid === 0, `${score("Ana")}`);
  check("the day's log says W3 was approved and who paid", d1(state, `SELECT text FROM events WHERE game_id = '${gid}' AND kind = 'commission_approved' ORDER BY id`).map((r) => r.text).join("|") === "W3 was approved. Ana paid 3 points.|W2 was approved.");
  const pend = await rf(`${A}/wk/api/moderator/pending`, { headers: { authorization: `Bearer ${TOKEN}` } }).then((r) => r.json());
  check("the moderator's pending list has only P4: the commissions are left out", d2.status === "processing" && J(pend.job.passed.map((p) => p.number)) === J([4]) && !J(pend).includes("commission"), J(pend.job.passed.map((p) => [p.number, p.kind])));
  const claim = await rf(`${A}/wk/api/moderator/days/2/claim`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: J({ sha: SHA1, outcomes: [{ number: 4, seq: 1, applied: true, commit: SHA1 }] }) });
  check("a claim names only P4 (naming a commission is refused: it is not a passed proposal)", claim.status === 200);
  const wrong = await rf(`${A}/wk/api/moderator/days/2/claim`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: J({ sha: "b".repeat(40), outcomes: [{ number: 4, seq: 1, applied: true, commit: "b".repeat(40) }, { number: 2, seq: 2, applied: true, commit: "b".repeat(40) }] }) });
  check("a claim that names a commission is refused (400)", wrong.status === 400 || wrong.status === 409);
  dev("bundle_sha:wk", SHA1);
  await cron();
  check("the night completes on P4 alone: P4 enacted, day 2 done, day 3 open; nothing waits on the commissions", prop(4).status === "enacted" && day(2).status === "done" && game().day === 3 && prop(2).status === "approved" && tk(3).state === "Approved", J([day(2), game()]));
  await cron();
  check("the cron again pays and approves nothing twice (Ana stays at 2; P4's 10 points were Cy's)", score("Ana") === 2 && score("Cy") === 10 && tk(3).queue_pos === 1 && d1(state, `SELECT COUNT(*) AS n FROM ticket_log WHERE kind = 'approved'`)[0].n === 2, `${score("Ana")}`);
  const hist = (await Ana.get("/wk/api/ballot?day=2")).data.items.find((i) => i.kind === "commission" && i.ticket.n === "W3");
  check("the counted ballot shows the commission's result (passed, nothing applied) and the ticket's state", hist.status === "approved" && hist.result.passed === true && hist.result.applied === null && hist.ticket.state === "Approved" && hist.ticket.queue === 1, J(hist));

  console.log("day 2: a commission that fails goes Refused; a commission alone on a ballot needs no moderator; the queue continues");
  const c1 = await commission(Ana, good({ title: "A drum", makes: [{ kind: "entry", name: "Drum" }] }), "W4");   // her draft from the refused second attempt
  const c2 = await commission(Cy, good({ title: "A bell", makes: [{ kind: "entry", name: "Bell" }] }));
  check("W4 and W5 are confirmed as P5 and P6", c1.k.data.ticket.proposal === "P5" && c2.k.data.ticket.proposal === "P6", J([c1.k.text, c2.k.text]));
  await midnight();
  for (const c of [Ana, Bo, Cy]) await yes(c, "P5");
  await yes(Ana, "P6", "no"); await yes(Bo, "P6", "no");
  const d3 = await midnight();
  check("P5 approved, P6 failed", prop(5).status === "approved" && prop(6).status === "failed", J([prop(5), prop(6)]));
  check("the passed commission is third in the queue (first approved, first built, across nights); the failed one is Refused with the count's sentence",
    tk(4).state === "Approved" && tk(4).queue_pos === 3 && tk(5).state === "Refused" && /Refused: P6 did not pass\. 0 of 3 voted yes; it needed 2\./.test(d1(state, `SELECT text FROM ticket_log WHERE ticket_id = '${tk(5).id}' AND kind = 'refused'`)[0].text), J([tk(4).queue_pos, tk(5).state]));
  check("a ballot with only commissions on it ends the night with no moderator: day 4 done, day 5 open, never 'processing'", d3.status === "done" && game().day === 5 && game().phase === "open", J([d3, game()]));
  check("a refused ticket's requester paid nothing (Cy keeps the 10 points P4 gave)", score("Cy") === 10 && tk(5).paid === null);

  console.log("the list and the page");
  const list = (await visitor.get(T)).data.tickets;
  check("the list (public): newest first; number, title, requester, state, estimate, price; no ids or emails", list.map((t) => t.n).join() === "W5,W4,W3,W2,W1" && list[2].title === "A dragon" && list[2].state === "Approved" && list[2].estimate === 2 && list[2].price === 3 && list[2].by.name === "Ana" && !/@example\.com/.test(J(list)) && !J(list).includes(id.Ana) && !J(list).includes("proposal_id"), J(list[2]));
  const pg = (await visitor.get(`${T}/w3`)).data.ticket;
  check("a ticket page (public): every field, tasks, log; a visitor can't post and can't edit", pg.n === "W3" && pg.makes.length === 2 && pg.running_cost === "Nothing." && pg.price_reason === "Test price." && pg.queue === 1 && pg.proposal === "P2" && pg.tasks.length === 2 && pg.log.map((l) => l.kind).join() === "proposed,withdrawn,proposed,approved" && pg.can.post.allowed === false && pg.can.edit.allowed === false, J(pg));

  console.log("804.1: anyone in the game can post");
  const p1x = await Ana.post(`${T}/W3/post`, { body: "Can it breathe fire?" });
  const p2x = await Bo.post(`${T}/W3/post`, { body: "  Only on Tuesdays.  " });
  const pv = await visitor.post(`${T}/W3/post`, { body: "hello" });
  check("two players post; a visitor can't (401) and nothing is written for them", p1x.status === 200 && p2x.status === 200 && pv.status === 401 && d1(state, "SELECT COUNT(*) AS n FROM ticket_posts")[0].n === 2, pv.text);
  const th = (await visitor.get(`${T}/W3`)).data.ticket.posts;
  check("the thread reads in order, each post by its player (a pill's name and color), trimmed; the page is public", th.map((x) => `${x.by.name}: ${x.body}`).join("|") === "Ana: Can it breathe fire?|Bo: Only on Tuesdays." && th.every((x) => x.author === "player" && x.by.color.key) && !J(th).includes(id.Ana));
  check("an empty post is 400; a post over 2000 characters is 400; a post on a ticket you can't see is 404; a post on a missing ticket is 404",
    (await Ana.post(`${T}/W3/post`, { body: " " })).status === 400 && (await Ana.post(`${T}/W3/post`, { body: "x".repeat(2001) })).status === 400 && (await Cy.post(`${T}/W99/post`, { body: "x" })).status === 404);
  const post4 = await Cy.post(`${T}/W4/post`, { body: "A drum! Yes." });
  check("any player may post on an approved ticket they did not ask for", post4.status === 200 && post4.data.ticket.posts.length === 1);
  d1(state, `INSERT INTO ticket_posts (ticket_id, game_id, author_kind, body, at) VALUES ('${tk(3).id}', '${gid}', 'gremlin', 'Kicking this upstairs.', 'x'), ('${tk(3).id}', '${gid}', 'chalant', 'Noted.', 'y')`);
  const th2 = (await Ana.get(`${T}/W3`)).data.ticket.posts;
  check("the thread already holds Gremlin's and Chalant's posts for the later steps: they read as their own authors", th2.slice(2).map((x) => x.author).join() === "gremlin,chalant" && th2[2].by === undefined);
  check("a ticket can't be given a post by a player id that isn't in the game (the database refuses it)", (() => { try { d1(state, `INSERT INTO ticket_posts (ticket_id, game_id, author_kind, player_id, body, at) VALUES ('${tk(3).id}', '${gid}', 'player', 'nobody', 'x', 'x')`); return false; } catch { return true; } })());

  console.log("the midnight lock (rule 107.1)");
  dev("clock", plus(day(game().day).ends_at, 1));
  const lk = [await Ana.post(T, {}), await Cy.post(`${T}/W3/edit`, { title: "x" }), await Ana.post(`${T}/W3/confirm`, {})];
  check("opening, editing and confirming are refused during the lock, with the lock's sentence", lk.every((r) => r.status === 423 && /processing day 5/.test(r.data.error)), lk.map((r) => r.status + " " + r.text).join(" | "));
  check("posting in a thread is not a move of the day: allowed during the lock", (await Bo.post(`${T}/W3/post`, { body: "Still here." })).status === 200);

  console.log("MCP: list_tickets, read_ticket, post_to_ticket");
  dev("clock", "2026-11-14T19:00:00.000Z");
  await cron();
  const tok = await connect(A, "wk", Bo, SITE);
  const lt = await tool(A, "wk", tok.access_token, "list_tickets");
  const lt2 = JSON.parse(lt.text);
  check("list_tickets returns the list: newest first, with title, state, estimate and price", !lt.isError && lt2.tickets.map((t) => t.n).join() === "W5,W4,W3,W2,W1" && lt2.tickets[2].price === 3, lt.text.slice(0, 200));
  const rt = await tool(A, "wk", tok.access_token, "read_ticket", { ticket: "W3" });
  const rt2 = JSON.parse(rt.text).ticket;
  check("read_ticket returns the page: brief, makes, tasks, log and the thread", !rt.isError && rt2.brief.startsWith("A dragon that") && rt2.posts.length >= 2 && rt2.log.length === 4, rt.text.slice(0, 200));
  const pt = await tool(A, "wk", tok.access_token, "post_to_ticket", { ticket: "W3", body: "From my AI client." });
  check("post_to_ticket posts as the player", !pt.isError && /Posted in W3/.test(pt.text) && d1(state, `SELECT body FROM ticket_posts WHERE player_id = '${id.Bo}' ORDER BY id DESC LIMIT 1`)[0].body === "From my AI client.", pt.text);
  const bad1 = await tool(A, "wk", tok.access_token, "read_ticket", { ticket: "W99" });
  const bad2 = await tool(A, "wk", tok.access_token, "post_to_ticket", { ticket: "W3", body: " " });
  check("a missing ticket and an empty post are tool errors with the reason", bad1.isError && /no such ticket/.test(bad1.text) && bad2.isError && /Write something/.test(bad2.text));
  const names2 = JSON.stringify((await (await rf(`${A}/wk/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${tok.access_token}` }, body: J({ jsonrpc: "2.0", id: 1, method: "tools/list" }) })).json()));
  check("the tool list names the three workshop tools", ["list_tickets", "read_ticket", "post_to_ticket"].every((n) => names2.includes(`"${n}"`)));
} catch (e) {
  fail++; console.log("  FAIL  harness:", e?.stack || e);
  if (srv) console.log(srv.log().slice(-3000));
} finally {
  if (srv) await srv.stop();
  if (stub) await stub.stop();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
