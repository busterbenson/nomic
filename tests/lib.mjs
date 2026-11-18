// Test harness: a real `wrangler pages dev` on a throwaway LOCAL D1 (never a
// remote one), plus helpers. Nothing here touches Cloudflare.
import { spawn, execFile, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
const execFileP = promisify(execFile);
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

// A stub for raw.githubusercontent.com: GET /<owner>/<repo>/<ref>/<path>. Tests
// never reach GitHub. `files` maps "/owner/repo/main/RULES.md" -> text; `calls`
// counts hits per path; a path in `broken` answers 500.
export async function startRulesStub(port, files) {
  const calls = {}, broken = new Set();
  const server = createServer((req, res) => {
    calls[req.url] = (calls[req.url] || 0) + 1;
    if (broken.has(req.url)) { res.statusCode = 500; return res.end("boom"); }
    if (req.url in files) { res.setHeader("content-type", "text/plain"); return res.end(files[req.url]); }
    res.statusCode = 404; res.end("404: Not Found");
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${port}`, files, calls, broken, stop: () => new Promise((r) => server.close(r)) };
}

// Runs scripts/create-game.sh. Returns {code, link, slug} or throws with the script's stderr.
// Async on purpose: the rules stub lives in this process, and a blocking call would starve it.
export async function createGame(state, o) {
  const args = ["--slug", o.slug, "--name", o.name || `Game ${o.slug}`, "--repo", o.repo || "busterbenson/test-game"];
  if (o.rulesPath) args.push("--rules-path", o.rulesPath);
  if (o.max) args.push("--max-players", String(o.max));
  const { stdout: out } = await execFileP(pjoin(ROOT, "scripts", "create-game.sh"), args, {
    cwd: ROOT, encoding: "utf8", timeout: 60000,
    env: { ...env, NOMIC_PERSIST_TO: state, SITE_URL: o.site || "http://localhost", RULES_BASE_URL: o.rulesBase },
  });
  return { slug: o.slug, code: out.match(/Join code: (\S+)/)[1], link: out.match(/Join link: (\S+)/)[1] };
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
      const r = await fetch(base + "/", { signal: AbortSignal.timeout(3000) });
      if (r.ok) break;
    } catch {}
    if (Date.now() > deadline) { child.kill(); throw new Error("wrangler did not start in 90s:\n" + log.slice(-2000)); }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { base, log: () => log, stop: () => new Promise((res) => { child.once("exit", res); child.kill("SIGTERM"); setTimeout(() => { child.kill("SIGKILL"); res(); }, 5000); }) };
}

// A tiny cookie-aware client with a browser-like jar: a cookie is sent only to
// paths under its Path attribute, so a game's session cookie (Path=/<slug>) goes
// to that game only. `force` adds a raw Cookie header on top, to prove the SERVER
// ignores a session from another game even when a browser would not send it.
export function client(base) {
  const jar = new Map(); // "name|path" -> value
  let force = "";
  const header = (path) => [...jar].filter(([k]) => { const p = k.split("|")[1]; return path === p || path.startsWith(p.endsWith("/") ? p : p + "/"); })
    .map(([k, v]) => `${k.split("|")[0]}=${v}`).concat(force ? [force] : []).join("; ");
  const c = {
    jar,
    get force() { return force; },
    set force(v) { force = v; },
    cookieFor: (path) => header(path),
    async req(method, path, body, headers = {}, raw = null) {
      const cookie = header(new URL(path, base).pathname);
      const res = await fetch(base + path, {
        method, redirect: "manual", signal: AbortSignal.timeout(20000),
        headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
        body: raw !== null ? raw : body !== undefined ? JSON.stringify(body) : undefined,
      });
      for (const sc of res.headers.getSetCookie?.() ?? []) {
        const [pair] = sc.split(";");
        const eq = pair.indexOf("=");
        const k = pair.slice(0, eq), v = pair.slice(eq + 1);
        const cpath = /path=([^;]+)/i.exec(sc)?.[1] ?? "/";
        const maxAge = /max-age=(\d+)/i.exec(sc)?.[1];
        if (maxAge === "0" || v === "") jar.delete(`${k}|${cpath}`); else jar.set(`${k}|${cpath}`, v);
      }
      const text = await res.text();
      let data = null; try { data = JSON.parse(text); } catch {}
      return { status: res.status, headers: res.headers, text, data };
    },
    get: (p) => c.req("GET", p),
    // A browser form post (the "Continue" button on /<slug>/auth/verify).
    form: (p, fields, headers = {}) => c.req("POST", p, undefined,
      { "content-type": "application/x-www-form-urlencoded", ...headers }, new URLSearchParams(fields).toString()),
    post: (p, b = {}) => c.req("POST", p, b),
  };
  return c;
}

export const MARKERS = ["🦉", "🐙", "🦊", "🐢", "🦋"];

// Join through the real flow: request the link, follow it. Returns a client logged in to that game.
export async function join(base, slug, code, { email, name, marker }, c = client(base)) {
  const r = await c.post(`/${slug}/api/join`, { code, email, name, marker });
  if (r.status !== 200) throw new Error(`join ${email}: ${r.status} ${r.text}`);
  const v = await finish(c, r.data.dev_link);
  if (v.status !== 303) throw new Error(`verify ${email}: ${v.status}`);
  return c;
}

// Click "Continue" on the page a magic link opens: POST the token with the site's own Origin
// to the link's own path.
export const finish = (c, link, headers = {}) =>
  c.form(new URL(link).pathname, { token: new URL(link).searchParams.get("token") }, { origin: new URL(link).origin, ...headers });
