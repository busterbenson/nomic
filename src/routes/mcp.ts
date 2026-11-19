// /<slug>/mcp: the game's MCP server (Streamable HTTP, stateless: every POST is complete in itself and
// answered as plain JSON). A player connects an AI client here as themselves; sign-in is OAuth, see
// routes/oauth-*.ts. The tools are in lib/mcp-tools.ts and call the web routes' own handlers.
// Order matters: the rules decide first (mcp_enabled is read from the game's row on every request), then
// the bearer token, then the protocol.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerTools } from "../lib/mcp-tools";
import { MCP_OFF, bearerOf, issuerOf, mcpEnabled, playerForToken, preflight, withCors } from "../lib/oauth";
import { Ctx, json } from "../lib/util";

const rpcError = (message: string, status: number, headers: Record<string, string> = {}) =>
  withCors(json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }, status, headers));

export const handle = async (ctx: Ctx): Promise<Response> => {
  const { env, request } = ctx;
  const game = ctx.data.game!;
  if (request.method === "OPTIONS") return preflight();
  if (!mcpEnabled(game)) return rpcError(MCP_OFF, 403);
  // A stateless server has no stream to open and no session to end.
  if (request.method !== "POST") return withCors(new Response("Use POST.", { status: 405, headers: { allow: "POST, OPTIONS" } }));

  const token = bearerOf(request);
  const player = token ? await playerForToken(env, game, token) : null;
  if (!player) {
    const meta = `${new URL(issuerOf(env, request, game)).origin}/.well-known/oauth-protected-resource/${game.slug}/mcp`;
    return rpcError("Sign in to take part in this game.", 401, { "www-authenticate": `Bearer resource_metadata="${meta}"` });
  }

  const server = new McpServer(
    { name: `promptocracy-${game.slug}`, version: "1.0.0" },
    { instructions: `You are connected to the game ${game.name} as ${player.display_name}. Call my_state first to see whose turn it is. read_rules and read_board show the rules and the board.` },
  );
  registerTools(server, ctx, player);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return withCors(await transport.handleRequest(request));
};
