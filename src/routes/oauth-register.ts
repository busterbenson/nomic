// POST /<slug>/oauth/register (JSON): dynamic client registration (RFC 7591), public clients only. A client
// is just a name and its return addresses; it holds no power until a player says Allow. Registrations are
// capped per address and per game per hour, and unused old ones are swept.
import { MCP_OFF, mcpEnabled, validRedirectUri, withCors } from "../lib/oauth";
import { Ctx, cleanName, json, nowIso, randomToken, readJson, sha256Hex } from "../lib/util";

// Registration is open (an AI app has no way to ask first), so it is capped: per address, so one script cannot
// use up the whole game's allowance, and per game as a backstop.
const MAX_PER_IP_HOUR = 20;
const MAX_PER_GAME_HOUR = 100;

export const post = async ({ env, request, data, waitUntil }: Ctx) => {
  const game = data.game!;
  const bad = (error: string, description: string, status = 400) => withCors(json({ error, error_description: description }, status));
  if (!mcpEnabled(game)) return withCors(json({ error: "access_denied", error_description: MCP_OFF }, 403));
  const body = await readJson(request);
  if (!body) return bad("invalid_client_metadata", "Send a JSON body.");
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 5 || !uris.every(validRedirectUri)) {
    return bad("invalid_redirect_uri", "redirect_uris must list 1 to 5 https addresses (or http on localhost).");
  }
  if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== "none") {
    return bad("invalid_client_metadata", "Only public clients (token_endpoint_auth_method none) are supported.");
  }
  const name = cleanName(body.client_name ?? "An AI app");
  if (!name) return bad("invalid_client_metadata", "client_name must be 1 to 40 characters.");
  const now = Date.now();
  const id = randomToken(24);
  const ipHash = await sha256Hex(`${game.id}:${request.headers.get("cf-connecting-ip") ?? "no-address"}`);
  // The cap and the insert are one statement, so concurrent registrations cannot all slip under it.
  const ins = await env.DB.prepare(
    `INSERT INTO oauth_clients (id, game_id, name, redirect_uris, ip_hash, created_at)
     SELECT ?, ?, ?, ?, ?, ?
     WHERE (SELECT COUNT(*) FROM oauth_clients WHERE game_id = ? AND created_at > ?) < ?
       AND (SELECT COUNT(*) FROM oauth_clients WHERE game_id = ? AND ip_hash = ? AND created_at > ?) < ?`,
  ).bind(id, game.id, name, JSON.stringify([...new Set(uris)]), ipHash, nowIso(now),
    game.id, nowIso(now - 3600 * 1000), MAX_PER_GAME_HOUR, game.id, ipHash, nowIso(now - 3600 * 1000), MAX_PER_IP_HOUR).run();
  if (!(ins.meta?.changes > 0)) return bad("temporarily_unavailable", "Too many apps registered recently. Try again later.", 429);
  // Housekeeping: spent codes and tokens, and clients that were registered long ago and never used.
  waitUntil(env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_codes WHERE expires_at < ?").bind(nowIso(now - 24 * 3600 * 1000)),
    env.DB.prepare("DELETE FROM oauth_tokens WHERE expires_at < ?").bind(nowIso(now)),
    env.DB.prepare(
      `DELETE FROM oauth_clients WHERE created_at < ? AND NOT EXISTS (SELECT 1 FROM oauth_tokens t WHERE t.client_id = oauth_clients.id)
         AND NOT EXISTS (SELECT 1 FROM oauth_codes c WHERE c.client_id = oauth_clients.id)`,
    ).bind(nowIso(now - 7 * 24 * 3600 * 1000)),
  ]).catch(() => {}));
  return withCors(json({
    client_id: id, client_name: name, redirect_uris: [...new Set(uris)], token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
  }, 201));
};
