// The Worker's entry point and router. Static files (public/) are bound as ASSETS and
// the Worker runs first for every request (run_worker_first), so only what is routed
// here, or lives in public/ and is named below, is ever served. Everything else is 404.
//  1. Routes: /  (the list of games), /site.css, the board's scripts (/js/*.js and the pinned
//     three.js in /vendor/*.js), and under /<slug>/ : the board,
//     /<slug>/join/<code>, /<slug>/auth/verify, /<slug>/api/*.
//  2. For a /<slug>/ request, look the game up once and hand it to the handler in
//     ctx.data.game. An unknown, malformed or reserved slug is a 404 before any handler runs.
//  3. POSTs must be application/json (the CSRF guard that goes with SameSite=Lax),
//     except the /<slug>/auth/verify form post, which checks Origin instead.
//  4. Security headers on every response.
import { notFoundPage } from "./lib/pages";
import { Ctx, Env, json, validSlug } from "./lib/util";
import * as landing from "./routes/landing";
import * as joinPage from "./routes/join-page";
import * as verify from "./routes/verify";
import * as apiGame from "./routes/api-game";
import * as apiJoin from "./routes/api-join";
import * as apiLogin from "./routes/api-login";
import * as apiLogout from "./routes/api-logout";
import * as apiMe from "./routes/api-me";
import * as apiRules from "./routes/api-rules";
import * as apiTurn from "./routes/api-turn";
import * as apiBoard from "./routes/api-board";
import * as apiAction from "./routes/api-action";
import * as apiNotifications from "./routes/api-notifications";
import * as apiNotificationsRead from "./routes/api-notifications-read";

const SUBROUTES = new Set(["api", "join", "auth"]);

type Handler = (ctx: Ctx) => Promise<Response>;
type Methods = { get?: Handler; post?: Handler };

// /<slug>/api/<name>
const API: Record<string, Methods> = {
  game: apiGame, me: apiMe, join: apiJoin, login: apiLogin, logout: apiLogout,
  turn: apiTurn, rules: apiRules, notifications: apiNotifications, board: apiBoard, action: apiAction,
};

const secure = (res: Response) => {
  const out = new Response(res.body, res);
  out.headers.set("x-content-type-options", "nosniff");
  out.headers.set("x-frame-options", "DENY");
  // "same-origin", not "no-referrer": with no-referrer a browser sends "Origin: null"
  // on form posts, which would lock out the Continue button. Nothing is sent cross-site.
  out.headers.set("referrer-policy", "same-origin");
  return out;
};

const notFound = () => new Response("Not found", { status: 404 });

// A route that does not answer this method is simply not found (as before).
const run = (m: Methods | undefined, method: string, ctx: Ctx): Promise<Response> | Response => {
  const h = method === "GET" || method === "HEAD" ? m?.get : method === "POST" ? m?.post : undefined;
  return h ? h(ctx) : notFound();
};

async function route(request: Request, env: Env, execCtx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const segs = path.split("/").slice(1); // "/a/b/" -> ["a","b",""]
  if (segs.length > 1 && segs[segs.length - 1] === "") segs.pop();

  const isRoot = path === "/";
  const isCss = path === "/site.css" || path === "/theme.css";
  // The board's own scripts and the vendored three.js: one flat folder each, plain file names only.
  const isScript = /^\/(js|vendor)\/[A-Za-z0-9._-]+\.js$/.test(path) && !path.includes("..");
  const slug = segs[0];
  const sub = segs[1];
  const isGame = !isRoot && !isCss && !isScript && validSlug(slug) && (sub === undefined || SUBROUTES.has(sub));
  if (!isRoot && !isCss && !isScript && !isGame) return notFound();

  // /auth/verify is the one POST that is a browser form post (the "Continue"
  // button); it is guarded by an Origin check inside the handler instead.
  const isVerify = isGame && sub === "auth" && segs[2] === "verify" && segs.length === 3;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && !isVerify) {
    const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return json({ error: "Send application/json." }, 415);
  }

  const ctx: Ctx = { request, env, waitUntil: (p) => execCtx.waitUntil(p), params: {}, data: {} };

  if (isRoot) return run(landing, method, ctx);
  if (isCss) return method === "GET" || method === "HEAD" ? env.ASSETS.fetch(request) : notFound();
  if (isScript) return method === "GET" || method === "HEAD" ? env.ASSETS.fetch(request) : notFound();

  const game = await env.DB.prepare("SELECT * FROM games WHERE slug = ?").bind(slug).first();
  if (!game) return sub === "api" ? json({ error: "There is no game at this address." }, 404) : notFoundPage();
  ctx.data.game = game;
  // The board's relative links need the slash: /<slug> -> /<slug>/
  if (sub === undefined && !path.endsWith("/") && (method === "GET" || method === "HEAD")) {
    return new Response(null, { status: 308, headers: { location: `${path}/${url.search}` } });
  }

  if (sub === undefined) {
    if (method !== "GET" && method !== "HEAD") return notFound();
    // One static board page for every game; it reads its slug from location.pathname.
    const res = await env.ASSETS.fetch(new Request(new URL("/board.html", url), { headers: request.headers }));
    const out = new Response(res.body, res);
    out.headers.set("cache-control", "no-store");
    return out;
  }
  if (sub === "join" && segs.length === 3) {
    try { ctx.params.code = decodeURIComponent(segs[2]); } catch { return notFound(); }
    return run(joinPage, method, ctx);
  }
  if (sub === "auth" && isVerify) return run(verify, method, ctx);
  if (sub === "api" && segs.length === 3) return run(API[segs[2]] && Object.hasOwn(API, segs[2]) ? API[segs[2]] : undefined, method, ctx);
  if (sub === "api" && segs.length === 4 && segs[2] === "notifications" && segs[3] === "read") return run(apiNotificationsRead, method, ctx);
  return notFound();
}

export default {
  async fetch(request: Request, env: Env, execCtx: ExecutionContext): Promise<Response> {
    return secure(await route(request, env, execCtx));
  },
};
