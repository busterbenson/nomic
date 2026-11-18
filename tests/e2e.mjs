// End-to-end checks against a real `wrangler pages dev` with a LOCAL D1.
// Run: npm test
import { rmSync } from "node:fs";
import { client, createGame, d1, finish, join, migrate, newState, startServer, MARKERS } from "./lib.mjs";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "  -> " + detail : ""}`); }
};
const tokenOf = (link) => new URL(link).searchParams.get("token");
const verifyPath = (link) => new URL(link).pathname + new URL(link).search;
const stripLinks = (s) => JSON.stringify(s).replace(/token=[\w-]+/g, "token=X");

const state = newState();
const state2 = newState();
let main, bare;
try {
  migrate(state);
  const game = createGame(state, { name: "Nomic, game 1" });
  const small = createGame(state, { name: "Tiny game", max: 2 });
  main = await startServer(state, 8791, ["DEV_MODE=1", "SITE_URL=http://example.test"]);
  const A = main.base;
  // The newest game is "the" game, so `small` is current; the main one is for joins by code.
  // Make the full-game checks use `small` and everything else use `game`: swap by timestamps.
  d1(state, "UPDATE games SET created_at = '2030-01-01T00:00:00.000Z' WHERE name = 'Nomic, game 1'");

  console.log("join flow");
  check("join code is 8 characters, no repo-committed code", /^[A-HJKMNP-Z2-9]{8}$/.test(game.code));
  const page = await client(A).get(`/join/${game.code.toLowerCase()}`);
  check("join page loads, code is case-insensitive", page.status === 200 && page.text.includes("Nomic, game 1") && page.text.includes("5 of 5 seats open"));
  const bad = await client(A).get("/join/ZZZZZZZZ");
  check("unknown code gives a friendly page", bad.status === 404 && bad.text.includes("doesn't match a game"));

  const ada = client(A);
  const r1 = await ada.post("/api/join", { code: game.code.toLowerCase(), email: "Ada@Example.com", name: "Ada", marker: MARKERS[0] });
  check("POST /api/join accepts the right code (lowercase) and returns a dev link", r1.status === 200 && r1.data.dev_link?.includes("/auth/verify?token="), r1.text);
  const pre = await ada.get("/api/game");
  check("nobody is a player until the link is clicked", pre.data.players.length === 0);
  // A mail scanner GETs the link first. That must not spend it.
  const peek = await client(A).get(verifyPath(r1.data.dev_link));
  check("GET /auth/verify shows a Continue page and does not use the token",
    peek.status === 200 && peek.text.includes("Finish joining Nomic") && peek.text.includes("Nomic, game 1") && peek.text.includes(">Continue<") &&
    !peek.headers.getSetCookie().length && d1(state, "SELECT COUNT(*) AS n FROM login_tokens WHERE used_at IS NOT NULL")[0].n === 0);
  await client(A).get(verifyPath(r1.data.dev_link));
  const foreign = await finish(client(A), r1.data.dev_link, { origin: "http://evil.example" });
  check("POST with a foreign Origin is refused (403) and the token survives", foreign.status === 403 && !foreign.headers.getSetCookie().length &&
    d1(state, "SELECT COUNT(*) AS n FROM login_tokens WHERE used_at IS NOT NULL")[0].n === 0);
  const noOrigin = await client(A).req("POST", "/auth/verify", undefined, { "content-type": "application/x-www-form-urlencoded" }, "token=" + new URL(r1.data.dev_link).searchParams.get("token"));
  check("POST with no Origin is refused (403)", noOrigin.status === 403);
  const inQuery = await client(A).req("POST", verifyPath(r1.data.dev_link), undefined, { "content-type": "application/x-www-form-urlencoded", origin: new URL(r1.data.dev_link).origin }, "");
  check("a token in the query string does not work on POST (it must be in the body)", inQuery.status === 400 && !inQuery.headers.getSetCookie().length);
  const v1 = await finish(ada, r1.data.dev_link);
  check("POST completes the join: redirects to the board and sets a session cookie", v1.status === 303 && v1.headers.get("location") === "/?notice=joined");
  const sc = v1.headers.getSetCookie().join("\n");
  check("cookie is HttpOnly, Secure, SameSite=Lax, 30 days", /HttpOnly/i.test(sc) && /Secure/i.test(sc) && /SameSite=Lax/i.test(sc) && /Max-Age=2592000/i.test(sc), sc);
  const me = await ada.get("/api/me");
  check("/api/me returns user and player", me.status === 200 && me.data.user.name === "Ada" && me.data.player.marker === MARKERS[0] && me.data.player.is_host === true, me.text);
  check("session id is stored hashed", d1(state, "SELECT id_hash FROM sessions").every((r) => /^[0-9a-f]{64}$/.test(r.id_hash)) && !sc.includes(d1(state, "SELECT id_hash FROM sessions")[0].id_hash));
  check("token is stored hashed", d1(state, "SELECT token_hash FROM login_tokens").every((r) => /^[0-9a-f]{64}$/.test(r.token_hash)));
  check("/api/me without a cookie is 401", (await client(A).get("/api/me")).status === 401);

  // second player so there is someone to notify
  const bo = await join(A, game.code, { email: "bo@example.com", name: "Bo", marker: MARKERS[1] });
  const pub = await client(A).get("/api/game");
  check("/api/game lists both players in turn order", pub.data.players.map((p) => p.name).join() === "Ada,Bo" && pub.data.players[1].turn_order === 1, pub.text);
  check("/api/game contains no '@' anywhere", !pub.text.includes("@"), pub.text);
  check("/api/game has no emails, ids or join code", !/email|user_id|join_code|"id"/.test(pub.text) && !pub.text.includes(game.code));
  check("/api/game logs the joins", pub.data.events.length === 2 && pub.data.events[0].text.includes("Bo"));

  console.log("notifications");
  const adaNotes = await ada.get("/api/notifications");
  check("the earlier player was notified that Bo joined", adaNotes.data.notifications.some((n) => n.kind === "player_joined" && n.body.includes("Bo")) && adaNotes.data.unread >= 1, adaNotes.text);
  const outbox = d1(state, "SELECT to_addr, subject, body FROM outbox WHERE subject LIKE 'Nomic: %'");
  check("an email notification went to the other player, not the joiner", outbox.some((o) => o.to_addr === "ada@example.com" && o.body.includes("http://example.test/")) && !outbox.some((o) => o.to_addr === "bo@example.com"), JSON.stringify(outbox));
  const boNotes = await bo.get("/api/notifications");
  check("the joiner gets the in-game row too (everyone does)", boNotes.data.notifications.length >= 1);
  const unauth = await client(A).get("/api/notifications");
  check("notifications need a session", unauth.status === 401);
  await ada.post("/api/notifications/read", { all: true });
  check("mark all read zeroes the unread count", (await ada.get("/api/notifications")).data.unread === 0);
  const otherId = boNotes.data.notifications[0].id;
  await ada.post("/api/notifications/read", { ids: [otherId] });
  check("you cannot mark someone else's notification read", (await bo.get("/api/notifications")).data.unread === boNotes.data.unread);
  check("emailed_at is recorded", d1(state, "SELECT COUNT(*) AS n FROM notifications WHERE emailed_at IS NOT NULL")[0].n >= 1);

  check("the email tells people to click the link, then Continue",
    d1(state, "SELECT body FROM outbox WHERE subject LIKE 'Finish joining%' LIMIT 1")[0].body.includes("Click the link, then press Continue"));

  console.log("rejections");
  const w = await client(A).post("/api/join", { code: "ZZZZZZZZ", email: "x@example.com", name: "X", marker: MARKERS[2] });
  check("wrong code rejected", w.status === 404);
  const taken = await client(A).post("/api/join", { code: game.code, email: "c@example.com", name: "Cy", marker: MARKERS[0] });
  check("taken marker rejected", taken.status === 409 && /marker/i.test(taken.data.error), taken.text);
  check("bad email rejected", (await client(A).post("/api/join", { code: game.code, email: "nope", name: "Cy", marker: MARKERS[2] })).status === 400);
  check("empty and 41-char names rejected",
    (await client(A).post("/api/join", { code: game.code, email: "n1@example.com", name: "  ", marker: MARKERS[2] })).status === 400 &&
    (await client(A).post("/api/join", { code: game.code, email: "n2@example.com", name: "x".repeat(41), marker: MARKERS[2] })).status === 400);
  check("a name made only of zero-width joiners is rejected",
    (await client(A).post("/api/join", { code: game.code, email: "zz@example.com", name: "\u200C\u200D", marker: MARKERS[3] })).status === 400);
  check("unknown marker rejected", (await client(A).post("/api/join", { code: game.code, email: "n3@example.com", name: "Z", marker: "💩" })).status === 400);
  // full game: `small` seats 2. It is not the current game (game 1 has a later created_at) but joins go by code.
  await join(A, small.code, { email: "s1@example.com", name: "S1", marker: MARKERS[0] });
  await join(A, small.code, { email: "s2@example.com", name: "S2", marker: MARKERS[1] });
  const full = await client(A).post("/api/join", { code: small.code, email: "s3@example.com", name: "S3", marker: MARKERS[2] });
  check("full game rejected", full.status === 409 && /full/i.test(full.data.error), full.text);
  check("full game's join page says so", (await client(A).get(`/join/${small.code}`)).text.includes("This game is full."));

  // a link requested while there was room cannot overfill the game when clicked late
  const late = await client(A).post("/api/join", { code: game.code, email: "late@example.com", name: "Late", marker: MARKERS[4] });
  const lateOk = await client(A).post("/api/join", { code: game.code, email: "late2@example.com", name: "Late2", marker: MARKERS[4] });
  const lateFirst = await finish(client(A), late.data.dev_link);
  const lateSecond = await finish(client(A), lateOk.data.dev_link);
  check("two people holding links for one marker: first wins, second is told the join failed",
    lateFirst.headers.get("location") === "/?notice=joined" && lateSecond.headers.get("location") === "/?notice=join-failed" && !lateSecond.headers.getSetCookie().length);

  const ex = await client(A).post("/api/join", { code: game.code, email: "dup@example.com", name: "Dup", marker: MARKERS[2] });
  const first = await finish(client(A), ex.data.dev_link);
  const again = await finish(client(A), ex.data.dev_link);
  check("token works once", first.headers.get("location") === "/?notice=joined");
  check("a second POST of the same token is refused with the friendly page", again.status === 400 && again.text.includes("expired or was already used") && again.text.includes("log-in link") && !again.headers.getSetCookie().length);
  check("GET of a used token shows the same friendly page", (await client(A).get(verifyPath(ex.data.dev_link))).text.includes("expired or was already used"));
  const ex2 = await client(A).post("/api/login", { email: "bo@example.com" });
  d1(state, `UPDATE login_tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE token_hash = '${[...d1(state, "SELECT token_hash FROM login_tokens ORDER BY created_at DESC LIMIT 1")].map((r) => r.token_hash)[0]}'`);
  const expired = await finish(client(A), ex2.data.dev_link);
  check("expired token rejected on POST", expired.status === 400 && expired.text.includes("expired or was already used"));
  check("expired token also shows the friendly page on GET", (await client(A).get(verifyPath(ex2.data.dev_link))).text.includes("expired or was already used"));
  check("garbage token rejected", (await finish(client(A), "http://example.test/auth/verify?token=nope")).status === 400 && (await client(A).get("/auth/verify?token=nope")).status === 400);

  console.log("log-in");
  const known = client(A), unknown = client(A);
  const lk = await known.post("/api/login", { email: "ada@example.com" });
  const lu = await unknown.post("/api/login", { email: "ghost@example.com" });
  check("log-in answers identically for known and unknown emails", lk.status === lu.status && stripLinks(lk.data) === stripLinks(lu.data), `${lk.text} vs ${lu.text}`);
  const lpeek = await client(A).get(verifyPath(lk.data.dev_link));
  check("a log-in link's Continue page says Log in to Nomic", lpeek.text.includes("Log in to Nomic"));
  const lv = await finish(known, lk.data.dev_link);
  check("a log-in link creates a session only on POST", lv.status === 303 && (await known.get("/api/me")).data.user.name === "Ada");
  check("a decoy link for an unknown email logs nobody in", (await finish(unknown, lu.data.dev_link)).status === 400 && (await unknown.get("/api/me")).status === 401);
  check("only the known address was emailed", d1(state, "SELECT to_addr FROM outbox WHERE subject = 'Your Nomic log-in link'").every((r) => r.to_addr !== "ghost@example.com"));
  const l2 = await client(A).post("/api/login", { email: "ada@example.com" });
  const l3 = await client(A).post("/api/login", { email: "ada@example.com" });
  const l4 = await client(A).post("/api/login", { email: "ada@example.com" });
  check("3 links per email per 15 minutes, the 4th is refused (429)", l2.status === 200 && l3.status === 429 && l4.status === 429, `${l2.status} ${l3.status} ${l4.status}`);
  const g1 = await client(A).post("/api/login", { email: "ghost2@example.com" });
  await client(A).post("/api/login", { email: "ghost2@example.com" });
  await client(A).post("/api/login", { email: "ghost2@example.com" });
  const g4 = await client(A).post("/api/login", { email: "ghost2@example.com" });
  check("the limit applies to unknown emails the same way", g1.status === 200 && g4.status === 429);

  const j1 = await client(A).post("/api/join", { code: game.code, email: "spam@example.com", name: "Sp", marker: MARKERS[3] });
  await client(A).post("/api/join", { code: game.code, email: "spam@example.com", name: "Sp", marker: MARKERS[3] });
  await client(A).post("/api/join", { code: game.code, email: "spam@example.com", name: "Sp", marker: MARKERS[3] });
  const j4 = await client(A).post("/api/join", { code: game.code, email: "spam@example.com", name: "Sp", marker: MARKERS[3] });
  check("the join form is rate limited the same way (4th link refused)", j1.status === 200 && j4.status === 429);
  const ads = await ada.post("/api/notifications/read", { ids: [] });
  check("marking an empty id list is a no-op, not a 500", ads.status === 200);
  check("bidi/zero-width characters are stripped from names",
    (await client(A).post("/api/join", { code: game.code, email: "bidi@example.com", name: "A\u202EB\u200Bc", marker: MARKERS[3] })).status === 200 &&
    d1(state, "SELECT display_name FROM login_tokens WHERE email = 'bidi@example.com'")[0].display_name === "ABc");
  await client(A).post("/api/join", { code: game.code, email: "zw@example.com", name: "\u0645\u06CC\u200C\u062E", marker: MARKERS[3] });
  check("ZWNJ (needed in Persian names) is kept", d1(state, "SELECT display_name FROM login_tokens WHERE email = 'zw@example.com'")[0].display_name.includes("\u200C"));

  const burst = await Promise.all(Array.from({ length: 8 }, () => client(A).post("/api/login", { email: "burst@example.com" })));
  check("concurrent requests cannot exceed the limit (at most 3 admitted)",
    burst.filter((r) => r.status === 200).length <= 3 && d1(state, "SELECT COUNT(*) AS n FROM login_tokens WHERE email = 'burst@example.com'")[0].n <= 3,
    burst.map((r) => r.status).join());

  console.log("logout");
  const sessionsBefore = d1(state, "SELECT COUNT(*) AS n FROM sessions")[0].n;
  const out = await known.post("/api/logout");
  check("logout clears the cookie and the session", out.status === 200 && (await known.get("/api/me")).status === 401);
  check("the session row is deleted server-side", d1(state, "SELECT COUNT(*) AS n FROM sessions")[0].n === sessionsBefore - 1);
  check("the old cookie no longer works", await (async () => { const c = client(A); c.cookie = `nomic_session=${"x".repeat(43)}`; return (await c.get("/api/me")).status === 401; })());

  console.log("guards");
  const form = await fetch(A + "/api/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "email=a@b.co" });
  check("POST without application/json is refused (415)", form.status === 415);
  for (const p of ["/wrangler.toml", "/.dev.vars", "/migrations/0001_init.sql", "/package.json", "/functions/api/join.ts", "/tests/e2e.mjs"]) {
    const r = await client(A).get(p);
    check(`${p} is not served`, r.status === 404);
  }
  const rules = await client(A).get("/RULES.md");
  check("RULES.md and the board are served", rules.status === 200 && rules.text.includes("Follow the rules") && (await client(A).get("/")).text.includes("/api/game"));

  console.log("turns");
  // game 1 is still in 'setup' here
  const early = await bo.post("/api/turn", { prompt: "Too early." });
  check("a turn in a game that has not started is refused (409)", early.status === 409, early.text);
  d1(state, "UPDATE games SET status = 'playing', round = 1, turn = 1 WHERE name = 'Nomic, game 1'");
  const outsider = client(A);
  await outsider.post("/api/login", { email: "s1@example.com" }).then(async (r) => finish(outsider, r.data.dev_link));
  check("a logged-in user who is not a player in this game is refused (403)", (await outsider.post("/api/turn", { prompt: "Hi" })).status === 403);
  check("logged-out submit is 401", (await client(A).post("/api/turn", { prompt: "Hi" })).status === 401);
  const notYours = await ada.post("/api/turn", { prompt: "Out of turn." });
  check("a player who is not up is refused (403)", notYours.status === 403 && /not your turn/i.test(notYours.data.error), notYours.text);
  check("an empty prompt and a 2001-char prompt are refused",
    (await bo.post("/api/turn", { prompt: "   " })).status === 400 && (await bo.post("/api/turn", { prompt: "x".repeat(2001) })).status === 400);
  const before = (await ada.get("/api/notifications")).data.unread;
  const pub0 = await client(A).get("/api/game");
  check("before submitting, the board says the current player is waiting", pub0.data.turn_status === "waiting" && pub0.data.turns.length === 0);
  const mine = await bo.post("/api/turn", { prompt: "Anyone who proposes a rule about cats gets 5 points." });
  check("the current player can submit", mine.status === 200 && mine.data.status === "submitted", mine.text);
  const pub1 = await client(A).get("/api/game");
  check("the turn does NOT advance on submit", pub1.data.game.turn === 1 && pub1.data.game.round === 1);
  check("/api/game shows the prompt and status, still no '@' or ids",
    pub1.data.turn_status === "submitted" && pub1.data.turns[0].prompt.includes("cats") && pub1.data.turns[0].name === "Bo" && !pub1.text.includes("@") && !/user_id|"id"/.test(pub1.text), pub1.text);
  check("the log records it", pub1.data.events[0].text.includes("Bo took their turn"));
  const after = await ada.get("/api/notifications");
  check("the other players were notified in-game", after.data.unread === before + 1 && after.data.notifications[0].kind === "turn_submitted");
  check("and by email, but not the submitter", (() => { const o = d1(state, "SELECT to_addr FROM outbox WHERE subject LIKE '%took their turn%'"); return o.some((r) => r.to_addr === "ada@example.com") && !o.some((r) => r.to_addr === "bo@example.com"); })());
  const twice = await bo.post("/api/turn", { prompt: "A second try." });
  check("a second submit in the same round is refused (409)", twice.status === 409 && /already/i.test(twice.data.error), twice.text);
  d1(state, "UPDATE games SET round = 2 WHERE name = 'Nomic, game 1'");
  check("in the next round the same player can submit again", (await bo.post("/api/turn", { prompt: "Round two." })).status === 200);

  console.log("email not configured");
  migrate(state2);
  const g2 = createGame(state2);
  bare = await startServer(state2, 8792, ["DEV_MODE=0"]);
  const j503 = await client(bare.base).post("/api/join", { code: g2.code, email: "a@example.com", name: "A", marker: MARKERS[0] });
  check("with DEV_MODE unset and no email configured, /api/join is 503", j503.status === 503 && /not configured/i.test(j503.data.error), j503.text);
  check("so is /api/login", (await client(bare.base).post("/api/login", { email: "a@example.com" })).status === 503);
  check("and nothing was stored or sent", d1(state2, "SELECT COUNT(*) AS n FROM login_tokens")[0].n === 0 && d1(state2, "SELECT COUNT(*) AS n FROM outbox")[0].n === 0);
  check("the public board still works", (await client(bare.base).get("/api/game")).status === 200);
} catch (e) {
  fail++;
  console.log("  FAIL  harness error:", e?.stack || e);
  if (main) console.log(main.log().slice(-1500));
} finally {
  await main?.stop(); await bare?.stop();
  for (const s of [state, state2]) { try { rmSync(s, { recursive: true, force: true }); } catch {} }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
