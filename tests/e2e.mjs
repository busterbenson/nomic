// End-to-end checks against a real `wrangler dev` (Worker + static assets) with a LOCAL D1.
// Run: npm test
import { rmSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
import { ROOT, client, createGame, d1, finish, join as joinGame, migrate, newState, startRulesStub, startServer, COLORS } from "./lib.mjs";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "  -> " + detail : ""}`); }
};
const tokenOf = (link) => new URL(link).searchParams.get("token");
const verifyPath = (link) => new URL(link).pathname + new URL(link).search;
const stripLinks = (s) => JSON.stringify(s).replace(/token=[\w-]+/g, "token=X");

const RULES_ONE = "# Rules\n\nGame ONE rules.\n\n**101. Follow the rules.** Every player must.\n";
const RULES_TWO = "<!--\nStarter notes, not shown.\n-->\n\n# Rules\n\nGame TWO rules, which are different.\n";
const state = newState();
const state2 = newState();
const state3 = newState();
let main, bare, third, stub;
try {
  migrate(state);
  // A stub for GitHub's raw host: tests never reach the real one.
  stub = await startRulesStub(8890, {
    "/busterbenson/game-one/main/RULES.md": RULES_ONE,
    "/busterbenson/game-two/main/RULES.md": RULES_TWO,
    "/busterbenson/game-tiny/main/docs/RULES.md": "# Tiny rules\n",
    "/busterbenson/game-flaky/main/RULES.md": "# Flaky\n",
    "/busterbenson/game-shape/main/RULES.md": "# Shape\n",
  });
  const R = { rulesBase: stub.base };
  const game = await createGame(state, { slug: "one", name: "Game One", repo: "busterbenson/game-one", ...R });
  const two = await createGame(state, { slug: "two", name: "Game Two", repo: "busterbenson/game-two", ...R });
  const small = await createGame(state, { slug: "tiny", name: "Tiny game", repo: "busterbenson/game-tiny", rulesPath: "docs/RULES.md", max: 2, ...R });
  const flaky = await createGame(state, { slug: "flaky", name: "Flaky game", repo: "busterbenson/game-flaky", ...R });
  const shape = await createGame(state, { slug: "shape", name: "Shape game", repo: "busterbenson/game-shape", ...R });
  main = await startServer(state, 8791, ["DEV_MODE=1", "SITE_URL=http://example.test", `RULES_BASE_URL=${stub.base}`]);
  const A = main.base;
  const join = (b, code, o, c) => joinGame(b, code === small.code ? "tiny" : code === two.code ? "two" : "one", code, o, c);

  console.log("join flow");
  check("join code is 8 characters, no repo-committed code", /^[A-HJKMNP-Z2-9]{8}$/.test(game.code));
  const page = await client(A).get(`/one/join/${game.code.toLowerCase()}`);
  check("join page loads, code is case-insensitive", page.status === 200 && page.text.includes("Game One") && page.text.includes("8 of 8 seats open"));
  const bad = await client(A).get("/one/join/ZZZZZZZZ");
  check("unknown code gives a friendly page", bad.status === 404 && bad.text.includes("doesn't match this game"));

  const ada = client(A);
  const r1 = await ada.post("/one/api/join", { code: game.code.toLowerCase(), email: "Ada@Example.com", name: "Ada", color: COLORS[0] });
  check("POST /api/join accepts the right code (lowercase) and returns a dev link", r1.status === 200 && r1.data.dev_link?.includes("/one/auth/verify?token="), r1.text);
  const pre = await ada.get("/one/api/game");
  check("nobody is a player until the link is clicked", pre.data.players.length === 0);
  // A mail scanner GETs the link first. That must not spend it.
  const peek = await client(A).get(verifyPath(r1.data.dev_link));
  check("GET /auth/verify shows a Continue page and does not use the token",
    peek.status === 200 && peek.text.includes("Finish joining Game One") && peek.text.includes(">Continue<") &&
    !peek.headers.getSetCookie().length && d1(state, "SELECT COUNT(*) AS n FROM login_tokens WHERE used_at IS NOT NULL")[0].n === 0);
  await client(A).get(verifyPath(r1.data.dev_link));
  const foreign = await finish(client(A), r1.data.dev_link, { origin: "http://evil.example" });
  check("POST with a foreign Origin is refused (403) and the token survives", foreign.status === 403 && !foreign.headers.getSetCookie().length &&
    d1(state, "SELECT COUNT(*) AS n FROM login_tokens WHERE used_at IS NOT NULL")[0].n === 0);
  const noOrigin = await client(A).req("POST", "/one/auth/verify", undefined, { "content-type": "application/x-www-form-urlencoded" }, "token=" + new URL(r1.data.dev_link).searchParams.get("token"));
  check("POST with no Origin is refused (403)", noOrigin.status === 403);
  const inQuery = await client(A).req("POST", verifyPath(r1.data.dev_link), undefined, { "content-type": "application/x-www-form-urlencoded", origin: new URL(r1.data.dev_link).origin }, "");
  check("a token in the query string does not work on POST (it must be in the body)", inQuery.status === 400 && !inQuery.headers.getSetCookie().length);
  const v1 = await finish(ada, r1.data.dev_link);
  check("POST completes the join: redirects to the board and sets a session cookie", v1.status === 303 && v1.headers.get("location") === "/one/?notice=joined");
  const sc = v1.headers.getSetCookie().join("\n");
  check("cookie is `s`, scoped to Path=/one, HttpOnly, Secure, SameSite=Lax, 30 days", /^s=/.test(sc) && /Path=\/one(;|$)/i.test(sc) && /HttpOnly/i.test(sc) && /Secure/i.test(sc) && /SameSite=Lax/i.test(sc) && /Max-Age=2592000/i.test(sc), sc);
  const me = await ada.get("/one/api/me");
  check("/one/api/me returns user and player", me.status === 200 && me.data.user.name === "Ada" && me.data.player.color.key === COLORS[0] && me.data.player.is_host === true, me.text);
  check("session id is stored hashed", d1(state, "SELECT id_hash FROM sessions").every((r) => /^[0-9a-f]{64}$/.test(r.id_hash)) && !sc.includes(d1(state, "SELECT id_hash FROM sessions")[0].id_hash));
  check("token is stored hashed", d1(state, "SELECT token_hash FROM login_tokens").every((r) => /^[0-9a-f]{64}$/.test(r.token_hash)));
  check("/one/api/me without a cookie is 401", (await client(A).get("/one/api/me")).status === 401);

  // second player so there is someone to notify
  const bo = await join(A, game.code, { email: "bo@example.com", name: "Bo", color: COLORS[1] });
  const pub = await client(A).get("/one/api/game");
  check("/one/api/game lists both players in turn order", pub.data.players.map((p) => p.name).join() === "Ada,Bo" && pub.data.players[1].turn_order === 1, pub.text);
  check("/one/api/game contains no '@' anywhere", !pub.text.includes("@"), pub.text);
  check("/one/api/game has no emails, ids or join code", !/email|user_id|join_code|"id"/.test(pub.text) && !pub.text.includes(game.code));
  check("/one/api/game logs the joins", pub.data.events.length === 2 && pub.data.events[0].text.includes("Bo"));

  console.log("notifications");
  const adaNotes = await ada.get("/one/api/notifications");
  check("the earlier player was notified that Bo joined", adaNotes.data.notifications.some((n) => n.kind === "player_joined" && n.body.includes("Bo")) && adaNotes.data.unread >= 1, adaNotes.text);
  const outbox = d1(state, "SELECT to_addr, subject, body FROM outbox WHERE subject LIKE 'Game One: %'");
  check("an email notification went to the other player, not the joiner", outbox.some((o) => o.to_addr === "ada@example.com" && o.body.includes("http://example.test/")) && !outbox.some((o) => o.to_addr === "bo@example.com"), JSON.stringify(outbox));
  const boNotes = await bo.get("/one/api/notifications");
  check("the joiner gets the in-game row too (everyone does)", boNotes.data.notifications.length >= 1);
  const unauth = await client(A).get("/one/api/notifications");
  check("notifications need a session", unauth.status === 401);
  await ada.post("/one/api/notifications/read", { all: true });
  check("mark all read zeroes the unread count", (await ada.get("/one/api/notifications")).data.unread === 0);
  const otherId = boNotes.data.notifications[0].id;
  await ada.post("/one/api/notifications/read", { ids: [otherId] });
  check("you cannot mark someone else's notification read", (await bo.get("/one/api/notifications")).data.unread === boNotes.data.unread);
  check("emailed_at is recorded", d1(state, "SELECT COUNT(*) AS n FROM notifications WHERE emailed_at IS NOT NULL")[0].n >= 1);

  check("the email tells people to click the link, then Continue",
    d1(state, "SELECT body FROM outbox WHERE subject LIKE 'Finish joining%' LIMIT 1")[0].body.includes("Click the link, then press Continue"));

  console.log("rejections");
  const w = await client(A).post("/one/api/join", { code: "ZZZZZZZZ", email: "x@example.com", name: "X", color: COLORS[2] });
  check("wrong code rejected", w.status === 404);
  const taken = await client(A).post("/one/api/join", { code: game.code, email: "c@example.com", name: "Cy", color: COLORS[0] });
  check("taken color rejected", taken.status === 409 && /color/i.test(taken.data.error), taken.text);
  check("bad email rejected", (await client(A).post("/one/api/join", { code: game.code, email: "nope", name: "Cy", color: COLORS[2] })).status === 400);
  check("empty and 41-char names rejected",
    (await client(A).post("/one/api/join", { code: game.code, email: "n1@example.com", name: "  ", color: COLORS[2] })).status === 400 &&
    (await client(A).post("/one/api/join", { code: game.code, email: "n2@example.com", name: "x".repeat(41), color: COLORS[2] })).status === 400);
  check("a name made only of zero-width joiners is rejected",
    (await client(A).post("/one/api/join", { code: game.code, email: "zz@example.com", name: "\u200C\u200D", color: COLORS[3] })).status === 400);
  check("unknown color rejected", (await client(A).post("/one/api/join", { code: game.code, email: "n3@example.com", name: "Z", color: "puce" })).status === 400);
  // full game: `small` seats 2. It is not the current game (game 1 has a later created_at) but joins go by code.
  await join(A, small.code, { email: "s1@example.com", name: "S1", color: COLORS[0] });
  await join(A, small.code, { email: "s2@example.com", name: "S2", color: COLORS[1] });
  const full = await client(A).post("/tiny/api/join", { code: small.code, email: "s3@example.com", name: "S3", color: COLORS[2] });
  check("full game rejected", full.status === 409 && /full/i.test(full.data.error), full.text);
  check("full game's join page says so", (await client(A).get(`/tiny/join/${small.code}`)).text.includes("This game is full."));

  // a link requested while there was room cannot overfill the game when clicked late
  const late = await client(A).post("/one/api/join", { code: game.code, email: "late@example.com", name: "Late", color: COLORS[4] });
  const lateOk = await client(A).post("/one/api/join", { code: game.code, email: "late2@example.com", name: "Late2", color: COLORS[4] });
  const lateFirst = await finish(client(A), late.data.dev_link);
  const lateSecond = await finish(client(A), lateOk.data.dev_link);
  check("two people holding links for one color: first wins, second is told the join failed",
    lateFirst.headers.get("location") === "/one/?notice=joined" && lateSecond.headers.get("location") === "/one/?notice=join-failed" && !lateSecond.headers.getSetCookie().length);

  const ex = await client(A).post("/one/api/join", { code: game.code, email: "dup@example.com", name: "Dup", color: COLORS[2] });
  const first = await finish(client(A), ex.data.dev_link);
  const again = await finish(client(A), ex.data.dev_link);
  check("token works once", first.headers.get("location") === "/one/?notice=joined");
  check("a second POST of the same token is refused with the friendly page", again.status === 400 && again.text.includes("expired or was already used") && again.text.includes("log-in link") && !again.headers.getSetCookie().length);
  check("GET of a used token shows the same friendly page", (await client(A).get(verifyPath(ex.data.dev_link))).text.includes("expired or was already used"));
  const ex2 = await client(A).post("/one/api/login", { email: "bo@example.com" });
  d1(state, `UPDATE login_tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE token_hash = '${[...d1(state, "SELECT token_hash FROM login_tokens ORDER BY created_at DESC LIMIT 1")].map((r) => r.token_hash)[0]}'`);
  const expired = await finish(client(A), ex2.data.dev_link);
  check("expired token rejected on POST", expired.status === 400 && expired.text.includes("expired or was already used"));
  check("expired token also shows the friendly page on GET", (await client(A).get(verifyPath(ex2.data.dev_link))).text.includes("expired or was already used"));
  check("garbage token rejected", (await finish(client(A), "http://example.test/one/auth/verify?token=nope")).status === 400 && (await client(A).get("/one/auth/verify?token=nope")).status === 400);

  console.log("log-in");
  const known = client(A), unknown = client(A);
  const lk = await known.post("/one/api/login", { email: "ada@example.com" });
  const lu = await unknown.post("/one/api/login", { email: "ghost@example.com" });
  check("log-in answers identically for known and unknown emails", lk.status === lu.status && stripLinks(lk.data) === stripLinks(lu.data), `${lk.text} vs ${lu.text}`);
  const lpeek = await client(A).get(verifyPath(lk.data.dev_link));
  check("a log-in link's Continue page says Log in to Game One", lpeek.text.includes("Log in to Game One"));
  const lv = await finish(known, lk.data.dev_link);
  check("a log-in link creates a session only on POST", lv.status === 303 && (await known.get("/one/api/me")).data.user.name === "Ada");
  check("a decoy link for an unknown email logs nobody in", (await finish(unknown, lu.data.dev_link)).status === 400 && (await unknown.get("/one/api/me")).status === 401);
  check("only the known address was emailed", d1(state, "SELECT to_addr FROM outbox WHERE subject = 'Your Game One log-in link'").every((r) => r.to_addr !== "ghost@example.com"));
  const l2 = await client(A).post("/one/api/login", { email: "ada@example.com" });
  const l3 = await client(A).post("/one/api/login", { email: "ada@example.com" });
  const l4 = await client(A).post("/one/api/login", { email: "ada@example.com" });
  check("3 links per email per 15 minutes, the 4th is refused (429)", l2.status === 200 && l3.status === 429 && l4.status === 429, `${l2.status} ${l3.status} ${l4.status}`);
  const g1 = await client(A).post("/one/api/login", { email: "ghost2@example.com" });
  await client(A).post("/one/api/login", { email: "ghost2@example.com" });
  await client(A).post("/one/api/login", { email: "ghost2@example.com" });
  const g4 = await client(A).post("/one/api/login", { email: "ghost2@example.com" });
  check("the limit applies to unknown emails the same way", g1.status === 200 && g4.status === 429);

  const j1 = await client(A).post("/one/api/join", { code: game.code, email: "spam@example.com", name: "Sp", color: COLORS[3] });
  await client(A).post("/one/api/join", { code: game.code, email: "spam@example.com", name: "Sp", color: COLORS[3] });
  await client(A).post("/one/api/join", { code: game.code, email: "spam@example.com", name: "Sp", color: COLORS[3] });
  const j4 = await client(A).post("/one/api/join", { code: game.code, email: "spam@example.com", name: "Sp", color: COLORS[3] });
  check("the join form is rate limited the same way (4th link refused)", j1.status === 200 && j4.status === 429);
  const ads = await ada.post("/one/api/notifications/read", { ids: [] });
  check("marking an empty id list is a no-op, not a 500", ads.status === 200);
  check("bidi/zero-width characters are stripped from names",
    (await client(A).post("/one/api/join", { code: game.code, email: "bidi@example.com", name: "A\u202EB\u200Bc", color: COLORS[3] })).status === 200 &&
    d1(state, "SELECT display_name FROM login_tokens WHERE email = 'bidi@example.com'")[0].display_name === "ABc");
  await client(A).post("/one/api/join", { code: game.code, email: "zw@example.com", name: "\u0645\u06CC\u200C\u062E", color: COLORS[3] });
  check("ZWNJ (needed in Persian names) is kept", d1(state, "SELECT display_name FROM login_tokens WHERE email = 'zw@example.com'")[0].display_name.includes("\u200C"));

  const burst = await Promise.all(Array.from({ length: 8 }, () => client(A).post("/one/api/login", { email: "burst@example.com" })));
  check("concurrent requests cannot exceed the limit (at most 3 admitted)",
    burst.filter((r) => r.status === 200).length <= 3 && d1(state, "SELECT COUNT(*) AS n FROM login_tokens WHERE email = 'burst@example.com'")[0].n <= 3,
    burst.map((r) => r.status).join());

  console.log("logout");
  const sessionsBefore = d1(state, "SELECT COUNT(*) AS n FROM sessions")[0].n;
  const out = await known.post("/one/api/logout");
  check("logout clears the cookie and the session", out.status === 200 && (await known.get("/one/api/me")).status === 401);
  check("the session row is deleted server-side", d1(state, "SELECT COUNT(*) AS n FROM sessions")[0].n === sessionsBefore - 1);
  check("the old cookie no longer works", await (async () => { const c = client(A); c.force = `s=${"x".repeat(43)}`; return (await c.get("/one/api/me")).status === 401; })());

  console.log("guards");
  const form = await fetch(A + "/one/api/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "email=a@b.co" });
  check("POST without application/json is refused (415)", form.status === 415);
  for (const p of ["/wrangler.toml", "/.dev.vars", "/migrations/0001_init.sql", "/package.json", "/src/index.ts", "/src/lib/util.ts", "/README.md", "/DESIGN.md", "/package-lock.json", "/wrangler.preview-migrations.toml", "/public/site.css", "/public/board.html", "/site.css/", "/board.html/", "/.git/config", "/functions/[slug]/api/join.ts", "/tests/e2e.mjs", "/RULES.md", "/templates/RULES.md", "/board.html", "/board", "/index.html", "/scripts/create-game.sh", "/one/wrangler.toml", "/one/migrations/0001_init.sql", "/one/RULES.md"]) {
    const r = await client(A).get(p);
    check(`${p} is not served`, r.status === 404);
  }
  const css = await client(A).get("/site.css");
  const board = await client(A).get("/one/");
  check("the stylesheet and the board are served", css.status === 200 && /css/.test(css.headers.get("content-type")) && board.status === 200 && board.text.includes("/api/game") && board.text.includes("/api/rules"));
  check("the board page is the same file for every game", (await client(A).get("/two/")).text === board.text);
  check("site.css is served as text/css with the security headers", /^text\/css/.test(css.headers.get("content-type")) && css.headers.get("x-content-type-options") === "nosniff" && css.headers.get("referrer-policy") === "same-origin" && css.text.includes("{"));
  check("the board is text/html, no-store, with the security headers", /^text\/html/.test(board.headers.get("content-type")) && board.headers.get("cache-control") === "no-store" && board.headers.get("x-frame-options") === "DENY");
  const head = await fetch(A + "/one/", { method: "HEAD" });
  check("HEAD on the board answers 200", head.status === 200);
  const wrongMethod = await client(A).post("/one/api/game", {});
  check("a wrong method on a known route is 404", wrongMethod.status === 404 && (await client(A).post("/", {})).status === 404);
  check("odd paths are 404: bad percent-encoding, prototype names, a GET on a POST-only route, OPTIONS, a JSON POST to the board",
    (await client(A).get("/one/join/%E0")).status === 404 && (await client(A).get("/one/api/constructor")).status === 404 &&
    (await client(A).post("/one/api/__proto__", {})).status === 404 && (await client(A).get("/one/api/notifications/read")).status === 404 &&
    (await fetch(A + "/one/api/game", { method: "OPTIONS" })).status === 404 && (await client(A).post("/one/", {})).status === 404);
  console.log("preview isolation (static config)");
  {
    const prod = readFileSync(ROOT + "/wrangler.toml", "utf8"), mig = readFileSync(ROOT + "/wrangler.preview-migrations.toml", "utf8");
    const noComments = prod.replace(/^\s*#.*$/gm, "");
    const [top, prev] = noComments.split(/^\[\[previews\.d1_databases\]\]/m);
    const id = (t) => /database_id\s*=\s*"([^"]+)"/.exec(t)?.[1], dbName = (t) => /database_name\s*=\s*"([^"]+)"/.exec(t)?.[1];
    check("the preview D1 is a different database from production", id(top) && id(prev) && id(top) !== id(prev) && dbName(top) === "promptocracy" && dbName(prev) !== "promptocracy", `${id(top)} / ${id(prev)}`);
    check("previews get nothing but the preview D1: no other previews.* section, no email binding, no vars",
      [...noComments.matchAll(/^\s*\[+\s*previews[^\]]*\]+/gm)].every((m) => /^\s*\[\[previews\.d1_databases\]\]/.test(m[0])) && !/^\s*previews\s*=/m.test(noComments) && !/send_email|vars/.test(prev));
    check("the preview migrations config targets the preview database", id(mig) === id(prev) && dbName(mig) === dbName(prev));
  }
  check("a 404 carries the security headers too", (await fetch(A + "/src/index.ts")).headers.get("x-content-type-options") === "nosniff");

  console.log("turns");
  // game 1 is still in 'setup' here
  const early = await bo.post("/one/api/turn", { prompt: "Too early." });
  check("a turn in a game that has not started is refused (409)", early.status === 409, early.text);
  d1(state, "UPDATE games SET status = 'playing', round = 1, turn = 1 WHERE slug = 'one'");
  check("logged-out submit is 401", (await client(A).post("/one/api/turn", { prompt: "Hi" })).status === 401);
  const notYours = await ada.post("/one/api/turn", { prompt: "Out of turn." });
  check("a player who is not up is refused (403)", notYours.status === 403 && /not your turn/i.test(notYours.data.error), notYours.text);
  check("an empty prompt and a 2001-char prompt are refused",
    (await bo.post("/one/api/turn", { prompt: "   " })).status === 400 && (await bo.post("/one/api/turn", { prompt: "x".repeat(2001) })).status === 400);
  const before = (await ada.get("/one/api/notifications")).data.unread;
  const pub0 = await client(A).get("/one/api/game");
  check("before submitting, the board says the current player is waiting", pub0.data.turn_status === "waiting" && pub0.data.turns.length === 0);
  const mine = await bo.post("/one/api/turn", { prompt: "Anyone who proposes a rule about cats gets 5 points." });
  check("the current player can submit", mine.status === 200 && mine.data.status === "submitted", mine.text);
  const pub1 = await client(A).get("/one/api/game");
  check("the turn does NOT advance on submit", pub1.data.game.turn === 1 && pub1.data.game.round === 1);
  check("/one/api/game shows the prompt and status, still no '@' or ids",
    pub1.data.turn_status === "submitted" && pub1.data.turns[0].prompt.includes("cats") && pub1.data.turns[0].name === "Bo" && !pub1.text.includes("@") && !/user_id|"id"/.test(pub1.text), pub1.text);
  check("the log records it", pub1.data.events[0].text.includes("Bo (Saffron) took their turn"));
  const after = await ada.get("/one/api/notifications");
  check("the other players were notified in-game", after.data.unread === before + 1 && after.data.notifications[0].kind === "turn_submitted");
  check("and by email, but not the submitter", (() => { const o = d1(state, "SELECT to_addr FROM outbox WHERE subject LIKE '%took their turn%'"); return o.some((r) => r.to_addr === "ada@example.com") && !o.some((r) => r.to_addr === "bo@example.com"); })());
  const twice = await bo.post("/one/api/turn", { prompt: "A second try." });
  check("a second submit in the same round is refused (409)", twice.status === 409 && /already/i.test(twice.data.error), twice.text);
  d1(state, "UPDATE games SET round = 2 WHERE slug = 'one'");
  check("in the next round the same player can submit again", (await bo.post("/one/api/turn", { prompt: "Round two." })).status === 200);


  console.log("two games on one site");
  const pathOf = { one: "/busterbenson/game-one/main/RULES.md", two: "/busterbenson/game-two/main/RULES.md" };
  // Game two: its own code, its own people. Same email as Ada, a different account.
  check("two games have different join codes", game.code !== two.code && /^[A-HJKMNP-Z2-9]{8}$/.test(two.code));
  const wrongA = await client(A).post("/two/api/join", { code: game.code, email: "w1@example.com", name: "W", color: COLORS[2] });
  const wrongB = await client(A).post("/one/api/join", { code: two.code, email: "w2@example.com", name: "W", color: COLORS[2] });
  check("joining game two with game one's code fails (and the reverse)", wrongA.status === 404 && wrongB.status === 404, wrongA.text + wrongB.text);
  check("game one's code opens no join page on game two", (await client(A).get(`/two/join/${game.code}`)).status === 404 && (await client(A).get(`/two/join/${two.code}`)).status === 200);
  check("no token was stored for the refused joins", d1(state, "SELECT COUNT(*) AS n FROM login_tokens WHERE email IN ('w1@example.com','w2@example.com')")[0].n === 0);

  const sameEmail = await ada.post("/two/api/join", { code: two.code, email: "ADA@example.com", name: "Quill", color: COLORS[0] });
  const quillFinish = await finish(ada, sameEmail.data.dev_link);
  check("the same email can join a second game", sameEmail.status === 200 && quillFinish.status === 303 && quillFinish.headers.get("location") === "/two/?notice=joined");
  check("game two's cookie is `s` with Path=/two", /^s=/.test(quillFinish.headers.getSetCookie()[0]) && /Path=\/two(;|$)/i.test(quillFinish.headers.getSetCookie()[0]));
  const accounts = d1(state, "SELECT p.id, p.display_name, g.slug FROM players p JOIN games g ON g.id = p.game_id WHERE p.email = 'ada@example.com' ORDER BY g.slug");
  check("that is two separate accounts", accounts.length === 2 && accounts[0].id !== accounts[1].id && accounts.map((a) => a.slug).join() === "one,two" && accounts.map((a) => a.display_name).join() === "Ada,Quill", JSON.stringify(accounts));
  check("the browser keeps one session per game, each scoped to its own path", [...ada.jar.keys()].filter((k) => k.startsWith("s|")).sort().join() === "s|/one,s|/two");
  check("each game knows her by her own name", (await ada.get("/one/api/me")).data.user.name === "Ada" && (await ada.get("/two/api/me")).data.user.name === "Quill");
  const zed = await join(A, two.code, { email: "zed@example.com", name: "Zed", color: COLORS[1] });

  // A session for one game is not a session for another, even with the cookie forced across.
  const aCookie = [...ada.jar].find(([k]) => k === "s|/one")[1];
  const bCookie = [...ada.jar].find(([k]) => k === "s|/two")[1];
  const crossB = client(A); crossB.force = `s=${aCookie}`;
  const crossA = client(A); crossA.force = `s=${bCookie}`;
  check("game one's session cookie does not log you in to game two (cookie forced)",
    (await crossB.get("/two/api/me")).status === 401 && (await crossB.get("/two/api/notifications")).status === 401 &&
    (await crossB.post("/two/api/turn", { prompt: "x" })).status === 401 && (await crossB.post("/two/api/notifications/read", { all: true })).status === 401);
  check("and the same cookie still works on game one", (await crossB.get("/one/api/me")).status === 200);
  check("game two's session does not log you in to game one", (await crossA.get("/one/api/me")).status === 401 && (await crossA.get("/two/api/me")).status === 200);
  check("logging out of game two leaves game one's session alone",
    (await ada.post("/two/api/logout")).status === 200 && (await ada.get("/two/api/me")).status === 401 && (await ada.get("/one/api/me")).status === 200 && (await crossB.get("/one/api/me")).status === 200);
  const relog = await ada.post("/two/api/login", { email: "ada@example.com" });
  // A log-in link for game two does not work on game one, and is not spent by trying.
  const linkTwo = await client(A).post("/two/api/login", { email: "zed@example.com" });
  const wrongPath = new URL(linkTwo.data.dev_link); wrongPath.pathname = "/one/auth/verify";
  const tryB = client(A);
  const wrongGet = await tryB.get(wrongPath.pathname + wrongPath.search);
  const wrongPost = await finish(tryB, wrongPath.href);
  check("a game two link on game one's verify page is 'expired' on GET and POST, and not consumed",
    wrongGet.text.includes("expired or was already used") && wrongPost.status === 400 && !wrongPost.headers.getSetCookie().length &&
    d1(state, "SELECT COUNT(*) AS n FROM login_tokens WHERE game_id = (SELECT id FROM games WHERE slug='two') AND email='zed@example.com' AND used_at IS NOT NULL AND purpose='login'")[0].n === 0);
  check("then it works on game two", (await finish(client(A), linkTwo.data.dev_link)).headers.get("location") === "/two/?notice=welcome-back");
  check("a log-in on game two logs in to game two only", await (async () => { const c = client(A); const v = await finish(c, relog.data.dev_link); return v.status === 303 && (await c.get("/two/api/me")).status === 200 && (await c.get("/one/api/me")).status === 401; })());
  const stranger = await client(A).post("/two/api/login", { email: "bo@example.com" });
  check("an email with a seat only in game one gets a decoy on game two: no email, no session",
    stranger.status === 200 && (await finish(client(A), stranger.data.dev_link)).status === 400 &&
    !d1(state, "SELECT to_addr, subject FROM outbox WHERE subject LIKE 'Your Game Two log-in%'").some((o) => o.to_addr === "bo@example.com"));

  // Rate limits: 3 per (game, email) per 15 minutes; 10 per email per hour across games.
  const lim = (slug, email) => client(A).post(`/${slug}/api/login`, { email });
  const perGame = [await lim("one", "rl@example.com"), await lim("one", "rl@example.com"), await lim("one", "rl@example.com"), await lim("one", "rl@example.com")];
  check("3 links per (game, email), the 4th is refused", perGame.map((r) => r.status).join() === "200,200,200,429", perGame.map((r) => r.status).join());
  check("the same email still has its own 3 on another game", (await lim("two", "rl@example.com")).status === 200);
  const seq = [];
  for (const slug of ["one", "one", "one", "two", "two", "two", "tiny", "tiny", "tiny", "flaky", "shape"]) seq.push((await lim(slug, "hourly@example.com")).status);
  check("10 links per email per hour across all games, the 11th is refused", seq.join() === "200,200,200,200,200,200,200,200,200,200,429", seq.join());

  // Nothing crosses between games.
  const pubOne = await client(A).get("/one/api/game"), pubTwo = await client(A).get("/two/api/game");
  check("/two/api/game has only game two's players, log and name",
    pubTwo.data.players.map((p) => p.name).join() === "Quill,Zed" && pubTwo.data.game.name === "Game Two" && pubTwo.data.game.slug === "two" &&
    pubTwo.data.events.every((e) => /Quill|Zed/.test(e.text)) && pubTwo.data.turns.length === 0, pubTwo.text);
  check("/one/api/game has nothing from game two", !/Quill|Zed|Game Two/.test(pubOne.text) && pubOne.data.players.map((p) => p.name).join() === "Ada,Bo,Late,Dup");
  check("neither mentions an email or a join code", ![pubOne.text, pubTwo.text].some((t) => t.includes("@") || t.includes(game.code) || t.includes(two.code)));
  d1(state, "UPDATE games SET status = 'playing', round = 1, turn = 0 WHERE slug = 'two'");
  const aUnread = (await ada.get("/one/api/notifications")).data;
  const quill = client(A); await finish(quill, (await quill.post("/two/api/login", { email: "ada@example.com" })).data.dev_link);
  const qTurn = await quill.post("/two/api/turn", { prompt: "Game two prompt: a rule about owls." });
  check("a turn in game two is recorded", qTurn.status === 200, qTurn.text);
  const pubOne2 = await client(A).get("/one/api/game"), pubTwo2 = await client(A).get("/two/api/game");
  check("the prompt shows in game two only", pubTwo2.data.turns.length === 1 && pubTwo2.data.turns[0].prompt.includes("owls") && !pubOne2.text.includes("owls") && !pubTwo2.text.includes("cats"));
  const aAfter = (await ada.get("/one/api/notifications")).data;
  check("game one's notifications did not change and mention nothing from game two", aAfter.unread === aUnread.unread && aAfter.notifications.length === aUnread.notifications.length && !JSON.stringify(aAfter).match(/Quill|Zed|owls/));
  const zedNotes = (await zed.get("/two/api/notifications")).data;
  check("game two's notifications mention nothing from game one",
    zedNotes.notifications.length >= 2 && zedNotes.notifications.some((n) => n.body.includes("owls") || n.body.includes("Quill")) && !JSON.stringify(zedNotes).match(/Ada|Bo |Dup|Late|cats/), JSON.stringify(zedNotes));
  check("emails for game two's turn went to game two's other player and named the game",
    d1(state, "SELECT to_addr, subject, body FROM outbox WHERE subject LIKE 'Game Two: %took their turn%'").every((o) => o.to_addr === "zed@example.com" && o.body.includes("http://example.test/two/")) &&
    d1(state, "SELECT COUNT(*) AS n FROM outbox WHERE subject LIKE 'Game Two: %took their turn%'")[0].n === 1);
  check("a game one player marking 'all read' leaves game two's unread alone",
    (await ada.post("/one/api/notifications/read", { all: true })).status === 200 && (await zed.get("/two/api/notifications")).data.unread === zedNotes.unread);
  check("the database holds no cross-game row (notifications, sessions, turns point at a player of their own game)",
    ["notifications", "sessions", "turns"].every((t) => d1(state, `SELECT COUNT(*) AS n FROM ${t} x JOIN players p ON p.id = x.player_id WHERE p.game_id != x.game_id`)[0].n === 0));
  check("the database refuses a row that points at another game's player",
    (() => { try { d1(state, "INSERT INTO notifications (id, game_id, player_id, kind, body, created_at) SELECT 'x', (SELECT id FROM games WHERE slug='one'), (SELECT id FROM players WHERE display_name='Zed'), 'k', 'b', 'now'"); return false; } catch { return true; } })());
  check("game two's turn did not touch game one's turn counter", (await client(A).get("/one/api/game")).data.game.turn === 1);

  console.log("landing page and routing");
  const land = await client(A).get("/");
  check("the landing page lists both games, with status and player counts and links",
    land.status === 200 && land.text.includes("Game One") && land.text.includes("Game Two") && land.text.includes('href="/one/"') && land.text.includes('href="/two/"') &&
    /Game Two<\/strong><\/a>\s*<span class="sub">In play · 2 of 8 players/.test(land.text), land.text.slice(0, 1500));
  check("the landing page contains no '@' and no join code", !land.text.includes("@") && !land.text.includes(game.code) && !land.text.includes(two.code));
  const redirect = await client(A).get("/one");
  check("/<slug> without the slash redirects to /<slug>/", redirect.status === 308 && redirect.headers.get("location") === "/one/");
  for (const p of ["/api/game", "/rules", "/admin/", "/join/ABCDEFGH", "/auth/verify", "/assets/", "/static/", "/www/", "/mail/", "/help/", "/about/", "/Bad_Slug/", "/UPPER/", "/a/", "/-lead/", "/trail-/", "/x".repeat(1) + "y".repeat(41) + "/"]) {
    check(`reserved or malformed slug ${p.slice(0, 20)} is 404`, (await client(A).get(p)).status === 404);
  }
  check("an encoded slug and a trailing slash on a sub-route route the same way as the plain form",
    (await client(A).get("/on%65/")).status === 404 && (await client(A).get("/one/api/game/")).status === 200 && (await client(A).get("/one/auth/verify/?token=x")).status === 400);
  const ghost = await client(A).get("/nope/");
  check("an unknown slug is a friendly 404 page that lists no game", ghost.status === 404 && ghost.text.includes("no game at this address") && !ghost.text.includes("Game One"));
  const ghostApi = await client(A).get("/nope/api/game");
  check("an unknown slug on the API is a JSON 404", ghostApi.status === 404 && /no game/.test(ghostApi.data.error));
  check("unknown slug: join page, verify page, rules, login all 404",
    (await client(A).get("/nope/join/ABCDEFGH")).status === 404 && (await client(A).get("/nope/auth/verify?token=x")).status === 404 &&
    (await client(A).get("/nope/api/rules")).status === 404 && (await client(A).post("/nope/api/login", { email: "a@example.com" })).status === 404);

  console.log("create-game");
  const refuses = async (o, re) => { try { await createGame(state, { name: "X", repo: "busterbenson/game-one", ...R, ...o }); return false; } catch (e) { return re.test(String(e.stderr || e.message)); } };
  const allRefuse = async (list, f, re) => (await Promise.all(list.map((v) => refuses(f(v), re)))).every(Boolean);
  const gamesBefore = d1(state, "SELECT COUNT(*) AS n FROM games")[0].n;
  check("create-game refuses reserved slugs", await allRefuse(["api", "auth", "join", "assets", "static", "site.css", "index.html", "admin", "www", "mail", "help", "about", "rules"], (slug) => ({ slug }), /reserved|slug must/));
  check("create-game refuses malformed slugs", await allRefuse(["a", "Bad_Slug", "UPPER", "-x-", "has space", "x".repeat(41), "dots.in"], (slug) => ({ slug }), /slug must/));
  check("create-game refuses a duplicate slug", await refuses({ slug: "one" }, /already exists/));
  check("create-game refuses a bad repo shape", await allRefuse(["nope", "../x", "a/b/c", "http://x/y", "a/..", "a/.", "./b", "a b/c"], (repo) => ({ slug: "bad-repo", repo }), /owner\/name/));
  check("create-game refuses a bad rules path", await allRefuse(["../../etc/passwd", "/abs", "a/../b", "./RULES.md", "a/./b"], (rulesPath) => ({ slug: "bad-path", rulesPath }), /rules-path/));
  check("create-game refuses a repo whose RULES.md is not publicly readable", await refuses({ slug: "private-one", repo: "busterbenson/not-there" }, /cannot read/));
  check("and inserted nothing", d1(state, "SELECT COUNT(*) AS n FROM games")[0].n === gamesBefore);
  check("create-game requires slug, name and repo", (() => { try { execFileSync(ROOT + "/scripts/create-game.sh", ["--slug", "zz"], { encoding: "utf8", stdio: "pipe" }); return false; } catch (e) { return /required/.test(String(e.stderr)); } })());
  check("each game's repo and rules path are stored", (() => {
    const r = d1(state, "SELECT slug, repo, rules_path, rules_ref FROM games WHERE slug IN ('one','tiny') ORDER BY slug");
    return r[0].repo === "busterbenson/game-one" && r[0].rules_path === "RULES.md" && r[0].rules_ref === "main" && r[1].rules_path === "docs/RULES.md";
  })());

  console.log("rules from the game's repo");
  const seen0 = stub.calls[pathOf.one]; // create-game already read it once
  const rr1 = await client(A).get("/one/api/rules");
  check("/one/api/rules returns the game's RULES.md as markdown", rr1.status === 200 && /text\/markdown/.test(rr1.headers.get("content-type")) && rr1.text === RULES_ONE, rr1.text);
  await new Promise((r) => setTimeout(r, 600)); // the cache write finishes just after the response
  const rr1b = await client(A).get("/one/api/rules");
  check("a second request within 60 s is served from the cache", rr1b.status === 200 && rr1b.text === RULES_ONE && stub.calls[pathOf.one] === seen0 + 1, JSON.stringify(stub.calls));
  const rr2 = await client(A).get("/two/api/rules");
  check("each game gets its own repo's rules", rr2.status === 200 && rr2.text === RULES_TWO && !rr2.text.includes("ONE"));
  check("a custom rules path is honoured", (await client(A).get("/tiny/api/rules")).text === "# Tiny rules\n");
  stub.broken.add("/busterbenson/game-flaky/main/RULES.md");
  const rf = await client(A).get("/flaky/api/rules");
  check("when the repo cannot be read the answer is 502 with a plain message", rf.status === 502 && /unavailable/i.test(rf.text) && !rf.text.includes("boom"), rf.text);
  check("the board and its API still work then", (await client(A).get("/flaky/")).status === 200 && (await client(A).get("/flaky/api/game")).status === 200);
  const callsBefore = JSON.stringify(stub.calls);
  const shapes = [["repo", "../../etc"], ["repo", "http://evil.test/x"], ["repo", "a/b/c"], ["rules_path", "../secret"], ["rules_path", "/abs"], ["rules_path", "a/./b"], ["rules_ref", "../x"], ["rules_ref", "."]];
  const shapeResults = [];
  for (const [col, bad] of shapes) {
    d1(state, `UPDATE games SET repo = 'busterbenson/game-shape', rules_path = 'RULES.md', rules_ref = 'main' WHERE slug = 'shape'`);
    d1(state, `UPDATE games SET ${col} = '${bad}' WHERE slug = 'shape'`);
    shapeResults.push((await client(A).get("/shape/api/rules")).status);
  }
  check("a bad repo, path or ref in the database is refused (502) before any fetch", shapeResults.every((x) => x === 502) && JSON.stringify(stub.calls) === callsBefore, shapeResults.join());

  console.log("browser");
  const PY = "/usr/local/bin/python3";
  if (existsSync(PY)) {
    const board = async (slug, title, rules) => {
      try { return (await execFileAsync(PY, ["tests/browser-board.py", A, slug, title, rules], { cwd: ROOT, encoding: "utf8", timeout: 60000 })).stdout.trim(); }
      catch (e) { return String(e.stdout || "") + String(e.stderr || ""); }
    };
    const okBoard = await board("one", "Game One", "Game ONE rules");
    check("in a real browser, game one's board shows its name and its repo's rules", okBoard.startsWith("OK"), okBoard);
    const okTwo = await board("two", "Game Two", "Game TWO rules");
    check("and game two's board shows its own (an HTML comment at the top of its rules is not shown)", okTwo.startsWith("OK"), okTwo);
    const noRules = await board("flaky", "Flaky game", "-");
    check("a board whose repo is unreadable says 'Rules unavailable' and still draws", noRules.startsWith("OK"), noRules);
    // Its own server with SITE_URL unset, so the link's host is one the browser can reach.
    migrate(state3);
    const g3 = await createGame(state3, { slug: "one", name: "Game One", repo: "busterbenson/game-one", ...R });
    third = await startServer(state3, 8794, ["DEV_MODE=1", `RULES_BASE_URL=${stub.base}`]);
    const bl = await client(third.base).post("/one/api/join", { code: g3.code, email: "br@example.com", name: "Br", color: COLORS[0] });
    let out = "";
    try {
      // async: a blocked event loop would stop us draining wrangler's log pipes and stall the servers
      out = (await execFileAsync(PY, ["tests/browser-continue.py", bl.data.dev_link, third.base], { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8", timeout: 60000 })).stdout;
    } catch (e) { out = String(e.stdout || "") + String(e.stderr || ""); }
  check("the Referrer-Policy keeps browsers sending a real Origin", (await client(A).get("/")).headers.get("referrer-policy") === "same-origin");
  check("a real browser pressing Continue is let in (Origin as browsers send it)", /^OK Br/.test(out.trim()), out.trim().slice(0, 300));
  } else {
    console.log("  SKIPPED  real-browser Continue check (no playwright python at " + PY + ")");
  }

  console.log("email not configured");
  migrate(state2);
  const g2 = await createGame(state2, { slug: "one", name: "Game One", repo: "busterbenson/game-one", ...R });
  bare = await startServer(state2, 8792, ["DEV_MODE=0"]);
  const j503 = await client(bare.base).post("/one/api/join", { code: g2.code, email: "a@example.com", name: "A", color: COLORS[0] });
  check("with DEV_MODE unset and no email configured, /api/join is 503", j503.status === 503 && /not configured/i.test(j503.data.error), j503.text);
  check("so is /api/login", (await client(bare.base).post("/one/api/login", { email: "a@example.com" })).status === 503);
  check("and nothing was stored or sent", d1(state2, "SELECT COUNT(*) AS n FROM login_tokens")[0].n === 0 && d1(state2, "SELECT COUNT(*) AS n FROM outbox")[0].n === 0);
  check("the public board still works", (await client(bare.base).get("/one/api/game")).status === 200);
} catch (e) {
  fail++;
  console.log("  FAIL  harness error:", e?.stack || e);
  if (main) console.log(main.log().slice(-1500));
} finally {
  await main?.stop(); await bare?.stop(); await third?.stop(); await stub?.stop();
  for (const s of [state, state2, state3]) { try { rmSync(s, { recursive: true, force: true }); } catch {} }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
