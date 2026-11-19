// POST /<slug>/api/action: moves the site itself carries out (no moderator).
//   {kind:"move", x, y}   (or {kind:"move", label:"3N 2E"}; z is optional and must be the level you stand on)
// Move your piece. Allowed only to the player whose turn it is, while the game is 'playing', at most once
// per turn (games.last_move holds the 'round:turn' of the last move), to a CHARTED tile within the move distance (setting turn.move_distance).
// A move is IN ADDITION to proposing a rule change: it neither ends the turn nor needs a proposal, and a
// proposal made before or after it is unaffected. Turns still advance only when the moderator is built.
// After the move, every tile within the chart radius of the new position is charted (chartTile, a no-op
// for tiles already charted).
// Everything is written in ONE D1 batch, so a move can never half-apply. The first statement doubles as
// the guard: it only inserts the log line if the turn, the round, the last move, the piece's position,
// the destination and its occupancy are still exactly as they were read, otherwise it violates NOT NULL
// and the whole batch rolls back (two simultaneous requests: one wins, one gets a 409).
import { getPlayer } from "../lib/auth";
import { chartAroundStatements, ensureTiles } from "../lib/board";
import { SHARED_TILES } from "../lib/board-rules.js";
import { parseLabel, tileLabel, validCoord, withinSteps } from "../lib/geometry.js";
import { getSettings } from "../lib/settings.js";
import { Ctx, json, nowIso, readJson, who } from "../lib/util";

export const post = async (ctx: Ctx) => {
  const { env, request } = ctx;
  const game = ctx.data.game!;
  const player = await getPlayer(env, request, game);
  if (!player) return json({ error: "Log in to play." }, 401);
  const body = await readJson(request);
  if (!body) return json({ error: "Send a JSON body." }, 400);
  if (body.kind !== "move") return json({ error: "Unknown action. Use move." }, 400);
  // A tile is named by its label ("3N 2E", any case) or by integer coordinates.
  let x: any, y: any, z: any = 0;
  if (body.label !== undefined) {
    const p = parseLabel(body.label);
    if (!p) return json({ error: "That is not a tile label. Use a row then a column, like 3N 2E, optionally with a level like 1U (there is no zero row or column)." }, 400);
    ({ x, y, z } = p);
    if (body.z !== undefined) z = body.z;
  } else ({ x, y, z = 0 } = body);
  if (!validCoord(x, y, z)) return json({ error: "Name a tile by its label (like 3N 2E) or by integer x and y." }, 400);

  if (game.status !== "playing") return json({ error: "The game has not started, so there are no turns yet." }, 409);
  if (player.turn_order !== game.turn) return json({ error: "It is not your turn." }, 403);
  const turnKey = `${game.round}:${game.turn}`;
  if (game.last_move === turnKey) return json({ error: "You already moved this turn." }, 409);

  await ensureTiles(env, game);
  const me: any = await env.DB.prepare("SELECT x, y, z FROM players WHERE game_id = ? AND id = ?").bind(game.id, player.id).first();
  if (!me) return json({ error: "Could not find your piece." }, 500);
  if (z !== me.z) return json({ error: "You can only move on the level you are standing on." }, 400);
  const S = getSettings(game.settings);
  if (!withinSteps(me.x, me.y, x, y, S["turn.move_distance"])) {
    return json({ error: `That is not within ${S["turn.move_distance"]} step${S["turn.move_distance"] === 1 ? "" : "s"} of you.` }, 400);
  }
  const dest: any = await env.DB.prepare("SELECT 1 AS ok FROM tiles WHERE game_id = ? AND x = ? AND y = ? AND z = ?").bind(game.id, x, y, z).first();
  if (!dest) return json({ error: "That tile is not charted yet, so you cannot move there." }, 400);
  if (!SHARED_TILES) {
    const taken: any = await env.DB.prepare("SELECT 1 AS ok FROM players WHERE game_id = ? AND x = ? AND y = ? AND z = ? AND id != ?").bind(game.id, x, y, z, player.id).first();
    if (taken) return json({ error: "Another piece is standing there." }, 409);
  }

  const now = nowIso();
  const text = `${who(player.display_name, player.color)} moved to ${tileLabel(x, y, z)}.`;
  const stmts = [
    env.DB.prepare(
      `INSERT INTO events (game_id, kind, text, created_at)
       SELECT g.id, 'piece_moved', CASE WHEN g.status = 'playing' AND g.turn = ? AND g.round = ? AND g.last_move = ?
              AND EXISTS (SELECT 1 FROM players p WHERE p.game_id = g.id AND p.id = ? AND p.x = ? AND p.y = ? AND p.z = ?)
              AND EXISTS (SELECT 1 FROM tiles t WHERE t.game_id = g.id AND t.x = ? AND t.y = ? AND t.z = ?)
              AND (? = 1 OR NOT EXISTS (SELECT 1 FROM players o WHERE o.game_id = g.id AND o.id != ? AND o.x = ? AND o.y = ? AND o.z = ?))
              THEN ? ELSE NULL END, ?
       FROM games g WHERE g.id = ?`,
    ).bind(
      game.turn, game.round, game.last_move, player.id, me.x, me.y, me.z, x, y, z,
      SHARED_TILES ? 1 : 0, player.id, x, y, z, text, now, game.id,
    ),
    env.DB.prepare("UPDATE players SET x = ?, y = ?, z = ? WHERE game_id = ? AND id = ?").bind(x, y, z, game.id, player.id),
    ...chartAroundStatements(env, game, x, y, z, now),
    env.DB.prepare("UPDATE games SET last_move = ? WHERE id = ? AND turn = ? AND round = ? AND last_move = ?").bind(turnKey, game.id, game.turn, game.round, game.last_move),
  ];
  try {
    await env.DB.batch(stmts);
  } catch (e: any) {
    const msg = String(e?.message || e) + String(e?.cause?.message || "");
    if (/NOT NULL constraint failed/i.test(msg)) return json({ error: "The board changed under you. Reload and try again." }, 409);
    console.error("move failed:", msg);
    return json({ error: "Could not record your move. Try again." }, 500);
  }
  return json({ ok: true, kind: "move", at: { x, y, z, label: tileLabel(x, y, z) } });
};
