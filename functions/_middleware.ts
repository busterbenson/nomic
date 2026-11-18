// Runs for every request, static files included.
//  1. Route allowlist. pages_build_output_dir is the repo root, so without this
//     wrangler.toml, migrations/ and the rest of the repo would be public URLs.
//     Only these answer: /  (the list of games), /site.css, and everything under
//     /<slug>/ : the board, /<slug>/join/<code>, /<slug>/auth/verify, /<slug>/api/*.
//  2. For a /<slug>/ request, look the game up once and pass it on in ctx.data.game.
//     An unknown, malformed or reserved slug is a 404 before any handler runs.
//  3. POSTs must be application/json (the CSRF guard that goes with SameSite=Lax),
//     except the /<slug>/auth/verify form post, which checks Origin instead.
//  4. Security headers.
import { notFoundPage } from "./_lib/pages";
import { Ctx, json, validSlug } from "./_lib/util";

const SUBROUTES = new Set(["api", "join", "auth"]);

const secure = (res: Response) => {
  const out = new Response(res.body, res);
  out.headers.set("x-content-type-options", "nosniff");
  out.headers.set("x-frame-options", "DENY");
  // "same-origin", not "no-referrer": with no-referrer a browser sends "Origin: null"
  // on form posts, which would lock out the Continue button. Nothing is sent cross-site.
  out.headers.set("referrer-policy", "same-origin");
  return out;
};

export const onRequest = async (ctx: Ctx) => {
  const url = new URL(ctx.request.url);
  const path = url.pathname;
  const method = ctx.request.method;
  const segs = path.split("/").slice(1); // "/a/b/" -> ["a","b",""]
  if (segs.length > 1 && segs[segs.length - 1] === "") segs.pop();

  const isRoot = path === "/";
  const isCss = path === "/site.css";
  const slug = segs[0];
  const sub = segs[1];
  const isGame = !isRoot && !isCss && validSlug(slug) && (sub === undefined || SUBROUTES.has(sub));
  if (!isRoot && !isCss && !isGame) return secure(new Response("Not found", { status: 404 }));

  // /auth/verify is the one POST that is a browser form post (the "Continue"
  // button); it is guarded by an Origin check inside the handler instead.
  const isVerify = isGame && sub === "auth" && segs[2] === "verify" && segs.length === 3;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && !isVerify) {
    const type = (ctx.request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return secure(json({ error: "Send application/json." }, 415));
  }

  if (isGame) {
    const game = await ctx.env.DB.prepare("SELECT * FROM games WHERE slug = ?").bind(slug).first();
    if (!game) return secure(sub === "api" ? json({ error: "There is no game at this address." }, 404) : notFoundPage());
    ctx.data.game = game;
    // The board's relative links need the slash: /<slug> -> /<slug>/
    if (sub === undefined && !path.endsWith("/") && (method === "GET" || method === "HEAD")) {
      return secure(new Response(null, { status: 308, headers: { location: `${path}/${url.search}` } }));
    }
  }
  return secure(await ctx.next());
};
