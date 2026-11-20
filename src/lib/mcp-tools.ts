// The MCP tools. A THIN ADAPTER: each tool builds a Request for the matching web route and calls that route's
// own handler (api-rules, api-board, api-me, api-game, api-day, api-turn, api-action, api-end-turn), so validation, guards, log lines
// and notifications are the web's, and a change to the turn model reaches MCP with no change here.
// The player is attached to the internal Request (actAs); no cookie or token is forged.
// NOT here yet: voting, and a catch-all "take an action". They arrive with the moderator.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Player, actAs } from "./auth";
import { Ctx } from "./util";
import * as apiAction from "../routes/api-action";
import * as apiBoard from "../routes/api-board";
import * as apiDay from "../routes/api-day";
import * as apiEndTurn from "../routes/api-end-turn";
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

  server.registerTool("read_day", {
    description: "Read today: the day number, when it ends (midnight in the game's time zone), whether the midnight lock is on, what each player has done today, and what you may still do.",
    annotations: read,
  }, async () => reply(await viaRoute(ctx, player, apiDay.get, "GET", "day")));

  server.registerTool("my_state", {
    description: "Who you are in this game, where your piece stands, today's day and the midnight lock, what you have done today (moved, proposed, ended your turn) and what you may do right now (move, propose, end_turn).",
    annotations: read,
  }, async () => {
    const [me, g, board, day] = await Promise.all([
      viaRoute(ctx, player, apiMe.get, "GET", "me"), viaRoute(ctx, player, apiGame.get, "GET", "game"), viaRoute(ctx, player, apiBoard.get, "GET", "board"),
      viaRoute(ctx, player, apiDay.get, "GET", "day"),
    ]);
    const bad = [me, g, board, day].find((r) => r.status >= 400);
    if (bad) return reply(bad);
    const piece = board.data.pieces.find((p: any) => p.turn_order === player.turn_order);
    const d = day.data, you = d.you;
    // you.can comes from the day route, which runs the same turnBlock the move, propose and end-turn routes apply.
    return { content: [{ type: "text" as const, text: asJson({
      you: { name: me.data.user.name, turn_order: player.turn_order, color: me.data.player.color.name, score: me.data.player.score, is_host: me.data.player.is_host, at: piece?.at ?? null },
      game: { name: g.data.game.name, slug: g.data.game.slug, status: d.status, winning_score: g.data.game.winning_score },
      day: { number: d.day, ends_at: d.ends_at, timezone: d.timezone },
      lock: { locked: d.locked, processing_day: d.processing_day, message: d.message },
      today: { moved: you?.moved ?? false, proposed: you?.proposed ?? false, ended: you?.ended ?? false },
      you_can: you?.can ?? null,
    }) }] };
  });

  server.registerTool("propose", {
    description: "Propose a change today: your prompt says what you want to change in the rules or the site, in your own words (1 to 2000 characters). The moderator drafts it into exact text. Once a day; not after you end your turn; not during the midnight lock.",
    inputSchema: { prompt: z.string().describe("Your prompt for this turn") },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ prompt }) => reply(await viaRoute(ctx, player, apiTurn.post, "POST", "turn", { prompt })));

  server.registerTool("move", {
    description: "Move your piece to a charted tile within your move distance. Once a day; not after you end your turn; not during the midnight lock. Name the tile by label (like \"3N 2E\") or by integer x and y.",
    inputSchema: {
      label: z.string().optional().describe("Tile label, row first, like \"3N 2E\""),
      x: z.number().int().optional().describe("Column, if you are not giving a label"),
      y: z.number().int().optional().describe("Row, if you are not giving a label"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ label, x, y }) => reply(await viaRoute(ctx, player, apiAction.post, "POST", "action", { kind: "move", ...(label !== undefined ? { label } : { x, y }) })));

  server.registerTool("end_turn", {
    description: "End your turn for today. FINAL: there is no undo. Whatever you have not done today (your move, your proposal) is skipped, and you cannot move, propose or vote until the next day. Not during the midnight lock.",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, async () => reply(await viaRoute(ctx, player, apiEndTurn.post, "POST", "end-turn", {})));
}
