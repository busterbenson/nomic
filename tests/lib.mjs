// Test harness: a real `wrangler pages dev` on a throwaway LOCAL D1 (never a
// remote one), plus helpers. Nothing here touches Cloudflare.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pjoin, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = pjoin(dirname(fileURLToPath(import.meta.url)), "..");
const WRANGLER = pjoin(ROOT, "node_modules", ".bin", "wrangler");
const env = { ...process.env, WRANGLER_SEND_METRICS: "false", NO_COLOR: "1", CI: "1" };

export function newState() {
  return mkdtempSync(pjoin(tmpdir(), "nomic-test-"));
}

export function d1(state, sql) {
  const out = execFileSync(WRANGLER, ["d1", "execute", "DB", "--local", "--persist-to", state, "--json", "--command", sql],
    { cwd: ROOT, env, encoding: "utf8", timeout: 60000 });
  const parsed = JSON.parse(out.slice(out.indexOf("[")));
  return parsed[0]?.results ?? [];
}

export function migrate(state) {
  execFileSync(WRANGLER, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", state],
    { cwd: ROOT, env, encoding: "utf8", timeout: 60000, stdio: "pipe" });
}

// Runs scripts/create-game.sh and returns {code, link}.
export function createGame(state, opts = {}) {
  const out = execFileSync(pjoin(ROOT, "scripts", "create-game.sh"), [], {
    cwd: ROOT, encoding: "utf8", timeout: 60000,
    env: { ...env, NOMIC_PERSIST_TO: state, SITE_URL: opts.site || "http://localhost", ...(opts.max ? { MAX_PLAYERS: String(opts.max) } : {}),
      GAME_NAME: opts.name || "Nomic, game 1" },
  });
  return { code: out.match(/Join code: (\S+)/)[1], link: out.match(/Join link: (\S+)/)[1] };
}

export async function startServer(state, port, bindings = []) {
  if (!existsSync(WRANGLER)) throw new Error("Run `npm install` first.");
  const args = ["pages", "dev", ".", "--port", String(port), "--persist-to", state, "--ip", "127.0.0.1"];
  for (const b of bindings) args.push("--binding", b);
  const child = spawn(WRANGLER, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], detached: false });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90000;
  for (;;) {
    if (child.exitCode !== null) throw new Error("wrangler exited early:\n" + log.slice(-2000));
    try {
      const r = await fetch(base + "/RULES.md", { signal: AbortSignal.timeout(3000) });
      if (r.ok) break;
    } catch {}
    if (Date.now() > deadline) { child.kill(); throw new Error("wrangler did not start in 90s:\n" + log.slice(-2000)); }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { base, log: () => log, stop: () => new Promise((res) => { child.once("exit", res); child.kill("SIGTERM"); setTimeout(() => { child.kill("SIGKILL"); res(); }, 5000); }) };
}

// A tiny cookie-aware client. Redirects are never followed so tests can look at them.
export function client(base) {
  let cookie = "";
  const c = {
    get cookie() { return cookie; },
    set cookie(v) { cookie = v; },
    async req(method, path, body, headers = {}) {
      const res = await fetch(base + path, {
        method, redirect: "manual", signal: AbortSignal.timeout(20000),
        headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      for (const sc of res.headers.getSetCookie?.() ?? []) {
        const [pair] = sc.split(";");
        const [k, v] = pair.split("=");
        const maxAge = /max-age=(\d+)/i.exec(sc)?.[1];
        cookie = maxAge === "0" || v === "" ? "" : `${k}=${v}`;
      }
      const text = await res.text();
      let data = null; try { data = JSON.parse(text); } catch {}
      return { status: res.status, headers: res.headers, text, data };
    },
    get: (p) => c.req("GET", p),
    post: (p, b = {}) => c.req("POST", p, b),
  };
  return c;
}

export const MARKERS = ["🦉", "🐙", "🦊", "🐢", "🦋"];

// Join through the real flow: request the link, follow it. Returns a logged-in client.
export async function join(base, code, { email, name, marker }) {
  const c = client(base);
  const r = await c.post("/api/join", { code, email, name, marker });
  if (r.status !== 200) throw new Error(`join ${email}: ${r.status} ${r.text}`);
  const v = await c.get(new URL(r.data.dev_link).pathname + new URL(r.data.dev_link).search);
  if (v.status !== 303) throw new Error(`verify ${email}: ${v.status}`);
  return c;
}
