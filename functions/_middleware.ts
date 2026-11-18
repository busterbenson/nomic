// Runs for every request, static files included.
//  1. Static allowlist. pages_build_output_dir is the repo root, so without this
//     wrangler.toml, migrations/ and the rest of the repo would be public URLs.
//  2. POSTs must be application/json (the CSRF guard that goes with SameSite=Lax),
//     except the /auth/verify form post, which checks Origin instead.
//  3. Security headers.
import { Ctx, json } from "./_lib/util";

const STATIC_OK = new Set(["/", "/index.html", "/RULES.md", "/site.css"]);
const PREFIX_OK = ["/api/", "/auth/", "/join/"];

export const onRequest = async (ctx: Ctx) => {
  const url = new URL(ctx.request.url);
  const path = url.pathname;
  const allowed = STATIC_OK.has(path) || PREFIX_OK.some((p) => path.startsWith(p));
  if (!allowed) return new Response("Not found", { status: 404 });

  const method = ctx.request.method;
  // /auth/verify is the one POST that is a browser form post (the "Continue"
  // button); it is guarded by an Origin check inside the handler instead.
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && path !== "/auth/verify") {
    const type = (ctx.request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return json({ error: "Send application/json." }, 415);
  }

  const res = await ctx.next();
  const out = new Response(res.body, res);
  out.headers.set("x-content-type-options", "nosniff");
  out.headers.set("x-frame-options", "DENY");
  // "same-origin", not "no-referrer": with no-referrer a browser sends "Origin: null"
  // on form posts, which would lock out the Continue button. Nothing is sent cross-site.
  out.headers.set("referrer-policy", "same-origin");
  return out;
};
