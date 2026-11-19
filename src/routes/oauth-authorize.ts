// GET/POST /<slug>/oauth/authorize: where an AI client sends the player to say yes.
//  - A player with no session on this game is asked for their email, and gets the game's ordinary
//    magic-link log-in (the same tokens, limits and decoys as /api/login). The link carries this page's
//    address as `next`, so after "Continue" they land back here, signed in.
//  - A signed-in player sees one question, Allow or Deny. Allow hands the client a one-time code (PKCE-bound).
// Nothing is stored for the request itself: it travels in the URL and in hidden fields, and is checked again
// on the POST. The redirect address must be one the client registered, exactly, or no redirect happens.
import { getPlayer } from "../lib/auth";
import { emailMode } from "../lib/email";
import { issueLink, tooManyLinks } from "../lib/links";
import { CODE_TTL_MS, Client, MCP_OFF, issuerOf, loadClient, mcpEnabled, validChallenge } from "../lib/oauth";
import { page } from "../lib/pages";
import { Ctx, esc, nowIso, normEmail, randomToken, sha256Hex, siteUrl, validEmail } from "../lib/util";

type Req = { client: Client; redirect_uri: string; code_challenge: string; state: string; resource: string };
const FIELDS = ["client_id", "redirect_uri", "code_challenge", "code_challenge_method", "response_type", "state", "resource"] as const;

const fail = (message: string, status = 400) => page("Promptocracy", `<h1>Promptocracy</h1><div class="now">${esc(message)}</div>`, status);
const redirectBack = (uri: string, params: Record<string, string>) => {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return new Response(null, { status: 303, headers: { location: u.toString(), "cache-control": "no-store" } });
};

// Returns the checked request, or a response to send. Until the client and redirect address check out,
// problems are shown here; after that they go back to the client as an OAuth error.
async function parse(ctx: Ctx, get: (k: string) => string): Promise<Req | Response> {
  const game = ctx.data.game!;
  const client = await loadClient(ctx.env, game.id, get("client_id"));
  const redirect_uri = get("redirect_uri");
  if (!client) return fail("This app is not registered with this game.");
  if (!client.redirect_uris.includes(redirect_uri)) return fail("That return address is not one this app registered.");
  const state = get("state");
  const bad = (error: string) => redirectBack(redirect_uri, { error, state: state.length <= 500 ? state : "" });
  if (state.length > 500) return bad("invalid_request");
  if (get("response_type") !== "code") return bad("unsupported_response_type");
  if (get("code_challenge_method") !== "S256" || !validChallenge(get("code_challenge"))) return bad("invalid_request");
  const resource = get("resource");
  if (resource && resource !== `${issuerOf(ctx.env, ctx.request, game)}/mcp`) return bad("invalid_target");
  return { client, redirect_uri, code_challenge: get("code_challenge"), state, resource };
}

const hidden = (r: Req) =>
  [["client_id", r.client.id], ["redirect_uri", r.redirect_uri], ["code_challenge", r.code_challenge], ["code_challenge_method", "S256"],
   ["response_type", "code"], ["state", r.state], ["resource", r.resource]]
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join("");

const nextPath = (slug: string, r: Req) => {
  const q = new URLSearchParams({ response_type: "code", client_id: r.client.id, redirect_uri: r.redirect_uri, code_challenge: r.code_challenge, code_challenge_method: "S256" });
  if (r.state) q.set("state", r.state);
  if (r.resource) q.set("resource", r.resource);
  return `/${slug}/oauth/authorize?${q}`;
};

export const get = async (ctx: Ctx) => {
  const game = ctx.data.game!;
  if (!mcpEnabled(game)) return fail(MCP_OFF, 403);
  const url = new URL(ctx.request.url);
  const r = await parse(ctx, (k) => url.searchParams.get(k) ?? "");
  if (r instanceof Response) return r;
  const player = await getPlayer(ctx.env, ctx.request, game);
  const action = `/${esc(game.slug)}/oauth/authorize`;
  if (!player) {
    return page(game.name, `<h1>${esc(game.name)}</h1><div class="now">Log in to connect ${esc(r.client.name)}.</div>
<form method="POST" action="${action}" class="stack">${hidden(r)}<input type="hidden" name="step" value="login">
  <label>Email you joined with<input type="email" name="email" required autocomplete="email"></label>
  <button class="primary" type="submit">Email me a log-in link</button>
</form>`);
  }
  // The host the code would be sent to comes first: the name is whatever the app called itself.
  const host = new URL(r.redirect_uri).host;
  return page(game.name, `<h1>${esc(game.name)}</h1><div class="now">${esc(host)} (${esc(r.client.name)}) wants to play as ${esc(player.display_name)}.</div>
<form method="POST" action="${action}" class="stack">${hidden(r)}<input type="hidden" name="step" value="decide">
  <button class="primary" type="submit" name="decision" value="allow">Allow</button>
  <button type="submit" name="decision" value="deny">Deny</button>
</form>`);
};

export const post = async (ctx: Ctx) => {
  const { env, request } = ctx;
  const game = ctx.data.game!;
  // CSRF: the same Origin check as the log-in "Continue" form.
  if (request.headers.get("origin") !== new URL(siteUrl(env, request)).origin) {
    return new Response("Forbidden: this form must be submitted from the site itself.", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  if (!mcpEnabled(game)) return fail(MCP_OFF, 403);
  let form: FormData;
  try { form = await request.formData(); } catch { return fail("That form could not be read."); }
  const f = (k: string) => String(form.get(k) ?? "");
  const r = await parse(ctx, f);
  if (r instanceof Response) return r;

  if (f("step") === "login") {
    if (!emailMode(env)) return fail("Email is not configured, so log-in is unavailable.", 503);
    const email = validEmail(f("email")) ? normEmail(f("email")) : null;
    if (!email) return fail("That doesn't look like an email address.");
    if (await tooManyLinks(env, game.id, email)) return fail("Too many links requested. Wait 15 minutes and try again.", 429);
    const player = await env.DB.prepare("SELECT id FROM players WHERE game_id = ? AND email = ?").bind(game.id, email).first();
    // Same as /api/login: a token row is written either way, only a real player is emailed, the answer never says which.
    const link = await issueLink(ctx, game, {
      email, purpose: "login", send: !!player, next: nextPath(game.slug, r),
      subject: `Your ${game.name} log-in link`, intro: `Click to log in to ${game.name} and connect an AI client at ${new URL(r.redirect_uri).host}.`,
    });
    if (!link) return fail("Too many links requested. Wait 15 minutes and try again.", 429);
    const dev = emailMode(env) === "dev" ? `<p><a href="${esc(link)}">Log-in link</a></p>` : "";
    return page(game.name, `<h1>${esc(game.name)}</h1><div class="now">If that address has a seat in this game, a log-in link is on its way.</div>${dev}`);
  }

  const player = await getPlayer(env, request, game);
  if (!player) return new Response(null, { status: 303, headers: { location: nextPath(game.slug, r), "cache-control": "no-store" } });
  if (f("decision") !== "allow") return redirectBack(r.redirect_uri, { error: "access_denied", state: r.state });
  const code = randomToken(32);
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO oauth_codes (code_hash, client_id, game_id, player_id, redirect_uri, code_challenge, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(await sha256Hex(code), r.client.id, game.id, player.id, r.redirect_uri, r.code_challenge, nowIso(now), nowIso(now + CODE_TTL_MS)).run();
  return redirectBack(r.redirect_uri, { code, state: r.state });
};
