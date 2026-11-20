// The Worker's entry point and router. Static files (public/) are bound as ASSETS and
// the Worker runs first for every request (run_worker_first), so only what is routed
// here, or lives in public/ and is named below, is ever served. Everything else is 404.
//  1. Routes: /  (the list of games), /site.css, /theme.css, the page scripts (/js/*.js), and under /<slug>/ : the board,
//     /<slug>/join/<code>, /<slug>/auth/verify, /<slug>/api/*.
//  2. For a /<slug>/ request, look the game up once and hand it to the handler in
//     ctx.data.game. An unknown, malformed or reserved slug is a 404 before any handler runs.
//  3. POSTs must be application/json (the CSRF guard that goes with SameSite=Lax),
//     except the /<slug>/auth/verify form post, which checks Origin instead.
//  4. The game's MCP server and its OAuth sign-in: /<slug>/mcp, /<slug>/oauth/{authorize,token,register}, and the
//     two discovery documents under /.well-known/ (they name the game in the path).
//  5. Security headers on every response.
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
import * as apiProposals from "./routes/api-proposals";
import * as apiBoard from "./routes/api-board";
import * as apiAction from "./routes/api-action";
import * as apiDay from "./routes/api-day";
import * as apiEndTurn from "./routes/api-end-turn";
import * as apiVotes from "./routes/api-votes";
import * as apiBallot from "./routes/api-ballot";
import { clockNow, runMidnight } from "./lib/day";
import * as apiNotifications from "./routes/api-notifications";
import * as apiNotificationsRead from "./routes/api-notifications-read";
import * as mcp from "./routes/mcp";
import * as oauthAuthorize from "./routes/oauth-authorize";
import * as oauthMeta from "./routes/oauth-meta";
import * as oauthRegister from "./routes/oauth-register";
import * as oauthToken from "./routes/oauth-token";
import { preflight, withCors } from "./lib/oauth";

const SUBROUTES = new Set(["api", "join", "auth", "mcp", "oauth", ".well-known"]);

type Handler = (ctx: Ctx) => Promise<Response>;
type Methods = { get?: Handler; post?: Handler };

// /<slug>/api/<name>
const API: Record<string, Methods> = {
  game: apiGame, me: apiMe, join: apiJoin, login: apiLogin, logout: apiLogout,
  turn: apiTurn, rules: apiRules, notifications: apiNotifications, board: apiBoard, action: apiAction,
  day: apiDay, "end-turn": apiEndTurn, proposals: apiProposals, votes: apiVotes, ballot: apiBallot,
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

// The OAuth endpoints the browser-based clients call (authorize is a page, not one of them).
const OAUTH: Record<string, Methods> = { token: oauthToken, register: oauthRegister };

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

  // Discovery documents: /.well-known/oauth-protected-resource/<slug>/mcp and /.well-known/oauth-authorization-server/<slug>
  const wk = /^\/\.well-known\/(oauth-protected-resource|oauth-authorization-server)\/([^/]+)(\/mcp)?$/.exec(path);
  if (wk && (method === "GET" || method === "HEAD" || method === "OPTIONS")) {
    if (method === "OPTIONS") return preflight();
    const wkSlug = wk[2];
    if (!validSlug(wkSlug) || (wk[1] === "oauth-protected-resource") !== !!wk[3]) return notFound();
    const g = await env.DB.prepare("SELECT * FROM games WHERE slug = ?").bind(wkSlug).first();
    if (!g) return withCors(json({ error: "There is no game at this address." }, 404));
    const ctx: Ctx = { request, env, waitUntil: (p) => execCtx.waitUntil(p), params: {}, data: { game: g } };
    return wk[1] === "oauth-protected-resource" ? oauthMeta.protectedResource(ctx) : oauthMeta.authorizationServer(ctx);
  }

  const isRoot = path === "/";
  const isCss = path === "/site.css" || path === "/theme.css";
  // The pages' own scripts: one flat folder, plain file names only.
  const isScript = /^\/js\/[A-Za-z0-9._-]+\.js$/.test(path) && !path.includes("..");
  const slug = segs[0];
  const sub = segs[1];
  const isGame = !isRoot && !isCss && !isScript && validSlug(slug) && (sub === undefined || SUBROUTES.has(sub));
  if (!isRoot && !isCss && !isScript && !isGame) return notFound();

  // /auth/verify is the one POST that is a browser form post (the "Continue"
  // button); it is guarded by an Origin check inside the handler instead.
  const isVerify = isGame && sub === "auth" && segs[2] === "verify" && segs.length === 3;
  // The two OAuth endpoints that take a form post: the consent page (Origin-checked like verify) and the token
  // endpoint (OAuth defines it as form-encoded; no cookie is read there, so there is nothing for CSRF to ride on).
  const isOauthForm = isGame && sub === "oauth" && segs.length === 3 && (segs[2] === "authorize" || segs[2] === "token");
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && !isVerify && !isOauthForm) {
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
  if (sub === "mcp" && segs.length === 2) return mcp.handle(ctx);
  if (sub === "oauth" && segs.length === 3) {
    const name = segs[2];
    if (name === "authorize") return run(oauthAuthorize, method, ctx);
    if (!Object.hasOwn(OAUTH, name)) return notFound();
    return method === "OPTIONS" ? preflight() : run(OAUTH[name], method, ctx);
  }
  if (sub === ".well-known" && segs.length === 3 && segs[2] === "oauth-authorization-server") return method === "OPTIONS" ? preflight() : run({ get: oauthMeta.authorizationServer }, method, ctx);
  if (sub === "api" && segs.length === 3) return run(API[segs[2]] && Object.hasOwn(API, segs[2]) ? API[segs[2]] : undefined, method, ctx);
  if (sub === "api" && segs.length === 4 && segs[2] === "notifications" && segs[3] === "read") return run(apiNotificationsRead, method, ctx);
  // /api/proposals/<id>/confirm and /withdraw (rule 103)
  if (sub === "api" && segs.length === 5 && segs[2] === "proposals" && (segs[4] === "confirm" || segs[4] === "withdraw")) {
    ctx.params.id = segs[3];
    return run({ post: apiProposals.action(segs[4]) }, method, ctx);
  }
  return notFound();
}

export default {
  async fetch(request: Request, env: Env, execCtx: ExecutionContext): Promise<Response> {
    return secure(await route(request, env, execCtx));
  },
  // The midnight run (wrangler.toml [triggers], every 5 minutes): lock the days that have ended, process them, open the
  // next (src/lib/day.ts). Idempotent, so a late or doubled tick is harmless.
  /** @rule 107.1, 203.1 */
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await runMidnight(env, await clockNow(env));
  },
};
