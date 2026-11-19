// The MCP tools. A THIN ADAPTER: each tool builds a Request for the matching web route and calls that route's
// own handler (api-rules, api-board, api-me, api-game, api-turn, api-action), so validation, guards, log lines
// and notifications are the web's, and a change to the turn model reaches MCP with no change here.
// The player is attached to the internal Request (actAs); no cookie or token is forged.
// NOT here yet: voting, and a catch-all "take an action". They arrive with the moderator.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Player, actAs } from "./auth";
import { turnBlock } from "./turn";
import { Ctx } from "./util";
import * as apiAction from "../routes/api-action";
import * as apiBoard from "../routes/api-board";
import * as apiGame from "../routes/api-game";
import * as apiMe from "../routes/api-me";
import * as apiRules from "../routes/api-rules";
import * as apiTurn from "../routes/api-turn";

type Handler = (ctx: Ctx) => Promise<Response>;
type Result = { status: number; text: string; data: any };

// Call a web route's handler as `player`. The path only matters to handlers that build links from it.
async function viaRoute(ctx: Ctx, player: Player, handler: Handler, method: "GET" | "POST", name: string, body?: unknown): Promise<Result> {
  const url = new URL(`/${ctx.data.game!.slug}/api/${name}`, ctx.request.url);
  const request = new Request(url, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  actAs(request, player);
  const res = await handler({ ...ctx, request });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, text, data };
}

const reply = (r: Result, text = r.text) => ({ content: [{ type: "text" as const, text: r.status >= 400 ? (r.data?.error ?? text) : text }], isError: r.status >= 400 });
const asJson = (v: unknown) => JSON.stringify(v, null, 2);

export function registerTools(server: McpServer, ctx: Ctx, player: Player) {
  const game = ctx.data.game!;
  const read = { readOnlyHint: true, openWorldHint: false };

  server.registerTool("read_rules", {
    description: "Read this game's rules (the RULES.md in the game's repo), as markdown.",
    annotations: read,
  }, async () => reply(await viaRoute(ctx, player, apiRules.get, "GET", "rules")));

  server.registerTool("read_board", {
    description: "Read the board: the charted tiles, every piece (name, color, score, position), the board's settings and the move rules.",
    annotations: read,
  }, async () => reply(await viaRoute(ctx, player, apiBoard.get, "GET", "board")));

  server.registerTool("my_state", {
    description: "Who you are in this game, whose turn it is, where your piece stands, and what you may do right now (propose, move).",
    annotations: read,
  }, async () => {
    const [me, g, board] = await Promise.all([
      viaRoute(ctx, player, apiMe.get, "GET", "me"), viaRoute(ctx, player, apiGame.get, "GET", "game"), viaRoute(ctx, player, apiBoard.get, "GET", "board"),
    ]);
    const bad = [me, g, board].find((r) => r.status >= 400);
    if (bad) return reply(bad);
    // turnBlock is the same guard the propose and move routes apply.
    const fresh = game;
    const piece = board.data.pieces.find((p: any) => p.turn_order === player.turn_order);
    const current = g.data.players.find((p: any) => p.turn_order === fresh.turn);
    const can = (kind: "propose" | "move") => {
      const blocked = turnBlock(fresh, player, kind);
      if (blocked) return { allowed: false, reason: blocked.error };
      if (kind === "propose" && g.data.turn_status !== "waiting") return { allowed: false, reason: "You already took your turn this round." };
      return { allowed: true };
    };
    return { content: [{ type: "text" as const, text: asJson({
      you: { name: me.data.user.name, turn_order: player.turn_order, color: me.data.player.color.name, score: me.data.player.score, is_host: me.data.player.is_host, at: piece?.at ?? null },
      game: { name: g.data.game.name, slug: g.data.game.slug, status: fresh.status, round: fresh.round, turn: fresh.turn, winning_score: g.data.game.winning_score },
      whose_turn: fresh.status === "playing" && current ? { name: current.name, turn_order: current.turn_order, color: current.color.name } : null,
      your_turn: fresh.status === "playing" && player.turn_order === fresh.turn,
      you_can: { propose: can("propose"), move: can("move") },
    }) }] };
  });

  server.registerTool("propose", {
    description: "Take your turn by submitting your prompt: what you want to change in the rules or the site, in your own words (1 to 2000 characters). The moderator drafts it into exact text. Only on your turn, once per round.",
    inputSchema: { prompt: z.string().describe("Your prompt for this turn") },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ prompt }) => reply(await viaRoute(ctx, player, apiTurn.post, "POST", "turn", { prompt })));

  server.registerTool("move", {
    description: "Move your piece to a charted tile within your move distance, once per turn, in addition to proposing. Name the tile by label (like \"3N 2E\") or by integer x and y.",
    inputSchema: {
      label: z.string().optional().describe("Tile label, row first, like \"3N 2E\""),
      x: z.number().int().optional().describe("Column, if you are not giving a label"),
      y: z.number().int().optional().describe("Row, if you are not giving a label"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ label, x, y }) => reply(await viaRoute(ctx, player, apiAction.post, "POST", "action", { kind: "move", ...(label !== undefined ? { label } : { x, y }) })));
}
