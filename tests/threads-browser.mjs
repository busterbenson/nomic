// Gremlin in a ticket's thread in real Chromium (tests/browser-threads.py): his reply under a post, the Escalated chip on the list row and the card,
// Chalant's answer; at 1280 light and 390 light and dark. A real `wrangler dev` on a throwaway LOCAL D1 with the rules from templates/RULES.md and
// a local stub that replays canned answers (tests/gremlin-stub.mjs): the live API is never called. The game is moved through three stages and the
// page is checked at each. Set THREAD_SHOTS=<dir> to keep the screenshots. Run: node tests/threads-browser.mjs
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { createStub } from "./gremlin-stub.mjs";
import { PYTHON, ROOT, createGame, d1, freePort, join, migrate, newState, startPlaying, startRulesStub, startServer } from "./lib.mjs";

const shots = process.env.THREAD_SHOTS || "";
if (shots) mkdirSync(shots, { recursive: true });
const state = newState();
const { stubModel, stubState } = createStub();
let srv = null, stub = null, failed = false;
const MODEL_PORT = await freePort();
try {
  await new Promise((r) => stubModel.listen(MODEL_PORT, "127.0.0.1", r));
  migrate(state);
  const rules = readFileSync(ROOT + "/templates/RULES.md", "utf8");
  stub = await startRulesStub(await freePort(), { "/busterbenson/shop/main/RULES.md": rules });
  const g = await createGame(state, { slug: "shop", name: "The Shop", repo: "busterbenson/shop", rulesBase: stub.base });
  srv = await startServer(state, await freePort(), ["DEV_MODE=1", `RULES_BASE_URL=${stub.base}`, "MODEL_API_KEY=stub-key-not-real", `MODEL_BASE_URL=http://127.0.0.1:${MODEL_PORT}`]);
  const ada = await join(srv.base, "shop", g.code, { email: "ada@example.com", name: "Ada", color: "teal" });
  const bo = await join(srv.base, "shop", g.code, { email: "bo@example.com", name: "Bo", color: "vermilion" });
  startPlaying(state, "shop");
  const gid = d1(state, "SELECT id FROM games WHERE slug = 'shop'")[0].id;
  const pid = (n) => d1(state, `SELECT id FROM players WHERE game_id = '${gid}' AND display_name = '${n}'`)[0].id;
  const ok = (r, what) => { if (r.status !== 200) throw new Error(`${what}: ${r.status} ${r.text}`); return r; };
  const settled = async () => { for (let i = 0; i < 100; i++) { if (d1(state, "SELECT COUNT(*) AS n FROM agent_calls WHERE outcome = 'pending'")[0].n === 0) return; await new Promise((r) => setTimeout(r, 150)); } };
  const now = new Date().toISOString();
  d1(state, `INSERT INTO tickets (id, game_id, number, player_id, title, brief, makes, estimate, price, price_reason, state, created_at, updated_at) VALUES ('tk-1', '${gid}', 1, '${pid("Bo")}', 'A bog frog', 'A frog that sits on the wall and croaks at night.', '[{"kind":"entry","name":"Bog frog","catalogKind":"creature","attrs":{},"flavor":{"sound":"croak"}}]', 1, 0, 'Flavor only.', 'Proposed', '${now}', '${now}')`);
  // Bo's post is seeded (two players talking: Gremlin would stay quiet); Ada's gets his reply, in the stub's scripted words
  d1(state, `INSERT INTO ticket_posts (ticket_id, game_id, author_kind, player_id, body, at) VALUES ('tk-1', '${gid}', 'player', '${pid("Bo")}', 'Does the frog count as a creature that moves? It only sits.', '${now}')`);
  stubState.script.push({ say: "Sitting isn't moving, so a frog that only sits is flavor: free, nothing to build. Bo can say so on the ticket." });
  ok(await ada.post("/shop/api/tickets/W1/post", { body: "It sits, so no moves, right? Then it needs no rule." }), "ada post");
  await settled();
  const cookie = (c) => [...c.jar].find(([k]) => k === "s|/shop")[1];
  const run = async (stage) => {
    const r = await promisify(execFile)(PYTHON, [ROOT + "/tests/browser-threads.py", srv.base, shots || "-", cookie(ada), stage], { timeout: 280000, maxBuffer: 1 << 24 });
    process.stdout.write(`-- ${stage}\n${r.stdout}`);
  };
  stubState.script.push({ say: "Still flavor. Walls don't care who sits on them." });   // the answer to the question the page posts itself
  await run("answered");
  stubState.script.push({ say: "Kicking this upstairs to Chalant.", escalate: { category: "ruling", reason: "Asks whether a creature on a wall tile changes what the wall does." } });
  ok(await ada.post("/shop/api/tickets/W1/post", { body: "What if the frog sits on a wall tile? Does the wall count it as blocked?" }), "ada escalates");
  await settled();
  await run("escalated");
  const TOKEN = "thread-shot-token-0123456789abcdefg";
  d1(state, `UPDATE games SET moderator_token_hash = '${createHash("sha256").update(TOKEN).digest("hex")}' WHERE id = '${gid}'`);
  const api = (path, body) => fetch(`${srv.base}/shop/api/moderator/${path}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
  const open = (await api("escalations")).escalations;
  const a = await api(`escalations/${open[0].id}/answer`, { body: "Walls stay walls. A frog sitting on one doesn't change what 801.2 says the wall does." });
  if (!a.ok) throw new Error("answer: " + JSON.stringify(a));
  await run("chalant");
} catch (e) {
  failed = true;
  if (e.stdout) process.stdout.write(e.stdout);
  console.log("  FAIL  " + (e.stderr || e.message) + (e.cause ? " cause: " + (e.cause.code || e.cause.message) : ""));
} finally {
  await srv?.stop(); await stub?.stop();
  await new Promise((r) => stubModel.close(r));
  try { if (state.includes("promptocracy-test-")) rmSync(state, { recursive: true, force: true }); } catch {}
}
process.exit(failed ? 1 : 0);
