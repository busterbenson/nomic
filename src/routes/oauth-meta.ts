// The two discovery documents an MCP client reads after its first 401:
//   /.well-known/oauth-protected-resource/<slug>/mcp   (RFC 9728) says which server signs players in
//   /.well-known/oauth-authorization-server/<slug>     (RFC 8414) says where its endpoints are
// (also served at /<slug>/.well-known/oauth-authorization-server for clients that look under the issuer).
import { MCP_OFF, issuerOf, mcpEnabled, withCors } from "../lib/oauth";
import { Ctx, json } from "../lib/util";

const off = () => withCors(json({ error: MCP_OFF }, 403));

export const protectedResource = async ({ env, request, data }: Ctx) => {
  const g = data.game!;
  if (!mcpEnabled(g)) return off();
  const issuer = issuerOf(env, request, g);
  return withCors(json({ resource: `${issuer}/mcp`, authorization_servers: [issuer], bearer_methods_supported: ["header"] }, 200, { "cache-control": "public, max-age=300" }));
};

export const authorizationServer = async ({ env, request, data }: Ctx) => {
  const g = data.game!;
  if (!mcpEnabled(g)) return off();
  const issuer = issuerOf(env, request, g);
  return withCors(json({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  }, 200, { "cache-control": "public, max-age=300" }));
};
