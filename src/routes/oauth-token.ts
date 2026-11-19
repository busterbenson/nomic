// POST /<slug>/oauth/token (form-encoded, as OAuth defines it): trade a one-time code (with its PKCE
// verifier) or a refresh token for an access token. Public clients: no secret; the verifier is the proof.
// A code is claimed in one statement before anything else is checked, so a wrong verifier burns it.
import { Client, MCP_OFF, loadClient, mcpEnabled, mintTokens, pkceChallenge, validVerifier, withCors } from "../lib/oauth";
import { Ctx, json, nowIso, sha256Hex } from "../lib/util";

const err = (error: string, description: string, status = 400) =>
  withCors(json({ error, error_description: description }, status, { pragma: "no-cache" }));

export const post = async ({ env, request, data }: Ctx) => {
  const game = data.game!;
  if (!mcpEnabled(game)) return withCors(json({ error: "access_denied", error_description: MCP_OFF }, 403));
  let form: FormData;
  try { form = await request.formData(); } catch { return err("invalid_request", "Send a form-encoded body."); }
  const f = (k: string) => String(form.get(k) ?? "");
  const client: Client | null = await loadClient(env, game.id, f("client_id"));
  if (!client) return err("invalid_client", "Unknown client.", 401);
  const now = nowIso();

  if (f("grant_type") === "authorization_code") {
    if (!validVerifier(f("code_verifier"))) return err("invalid_request", "A code_verifier of 43 to 128 characters is required.");
    const codeHash = await sha256Hex(f("code"));
    const row: any = await env.DB.prepare(
      "UPDATE oauth_codes SET used_at = ? WHERE code_hash = ? AND game_id = ? AND used_at IS NULL AND expires_at > ? RETURNING *",
    ).bind(now, codeHash, game.id, now).first();
    if (!row) {
      // A code that was already used is being presented again: whatever was issued from it is revoked (RFC 6749 4.1.2),
      // and only that: a later sign-in of the same app and player is a different grant and stays.
      const spent: any = await env.DB.prepare("SELECT 1 AS ok FROM oauth_codes WHERE code_hash = ? AND game_id = ? AND client_id = ? AND used_at IS NOT NULL").bind(codeHash, game.id, client.id).first();
      if (spent) await env.DB.prepare("DELETE FROM oauth_tokens WHERE game_id = ? AND grant_id = ?").bind(game.id, codeHash).run();
      return err("invalid_grant", "That code is invalid, expired or already used.");
    }
    if (row.client_id !== client.id || row.redirect_uri !== f("redirect_uri")) return err("invalid_grant", "That code is invalid, expired or already used.");
    if ((await pkceChallenge(f("code_verifier"))) !== row.code_challenge) return err("invalid_grant", "The code_verifier does not match.");
    const seat = await env.DB.prepare("SELECT 1 AS ok FROM players WHERE id = ? AND game_id = ?").bind(row.player_id, game.id).first();
    if (!seat) return err("invalid_grant", "That player is no longer in this game.");
    return withCors(json(await mintTokens(env, { clientId: client.id, gameId: game.id, playerId: row.player_id, grantId: codeHash }), 200, { pragma: "no-cache" }));
  }

  if (f("grant_type") === "refresh_token") {
    // Single use: claimed (deleted) before a new pair is issued.
    const row: any = await env.DB.prepare(
      "DELETE FROM oauth_tokens WHERE token_hash = ? AND kind = 'refresh' AND game_id = ? AND client_id = ? AND expires_at > ? RETURNING player_id, grant_id",
    ).bind(await sha256Hex(f("refresh_token")), game.id, client.id, now).first();
    if (!row) return err("invalid_grant", "That refresh token is invalid or expired.");
    const seat = await env.DB.prepare("SELECT 1 AS ok FROM players WHERE id = ? AND game_id = ?").bind(row.player_id, game.id).first();
    if (!seat) return err("invalid_grant", "That player is no longer in this game.");
    return withCors(json(await mintTokens(env, { clientId: client.id, gameId: game.id, playerId: row.player_id, grantId: row.grant_id }), 200, { pragma: "no-cache" }));
  }
  return err("unsupported_grant_type", "Use authorization_code or refresh_token.");
};
