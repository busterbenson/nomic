// POST /<slug>/api/action: the first moves the site itself carries out (no referee).
//   {kind:"claim", label:"C4"}                    claim an unowned land tile ({x, y} works too)
//   {kind:"describe", label:"C4", name, description}   name and describe a tile you own
// Only the player whose turn it is, only while the game is 'playing', and only moves the game's
// settings allow (turn.actions). A move uses one of the turn's moves (turn.actions_per_turn, default 1)
// and the last one COMPLETES the turn: games.turn moves to the next player, and when it wraps past the
// last player the round ends: round + 1, and points are harvested per the harvest setting (default:
// 1 point per tile owned, to everyone, at the end of the round). The numbers are settings, never code.
// Everything is written in ONE D1 batch, so a turn can never half-apply. The first
// statement doubles as the guard: it only inserts the log line if the turn, the round
// and the tile are still exactly as they were read, otherwise it violates NOT NULL and
// the whole batch rolls back (two simultaneous requests: one wins, one gets a 409).
import { getPlayer } from "../lib/auth";
import { ensureTiles } from "../lib/board";
import { coordLabel, parseLabel, validCoord } from "../lib/geometry.js";
import { notify } from "../lib/notify";
import { getSettings } from "../lib/settings.js";
import { Ctx, cleanText, json, nowIso, readJson, siteUrl, who } from "../lib/util";

export const post = async (ctx: Ctx) => {
  const { env, request } = ctx;
  const game = ctx.data.game!;
  const player = await getPlayer(env, request, game);
  if (!player) return json({ error: "Log in to play." }, 401);
  const body = await readJson(request);
  if (!body) return json({ error: "Send a JSON body." }, 400);
  if (body.kind !== "claim" && body.kind !== "describe") return json({ error: "Unknown action. Use claim or describe." }, 400);
  const S = getSettings(game.settings);
  if (!S["turn.actions"][body.kind]) return json({ error: `This game's rules do not allow the "${body.kind}" move.` }, 403);
  if ("props" in body) return json({ error: "Players cannot set tile properties. Rules do that." }, 400);
  // A tile is named by its label ("C4", any case) or by integer coordinates.
  let x: any, y: any;
  if (body.label !== undefined) {
    const p = parseLabel(body.label);
    if (!p) return json({ error: "That is not a tile label. Use a letter and a number, like C4." }, 400);
    ({ x, y } = p);
  } else ({ x, y } = body);
  if (!validCoord(x, y)) return json({ error: "Name a tile by its label (like C4) or by integer x and y." }, 400);

  let name: string | null = null, description: string | null = null;
  if (body.kind === "describe") {
    name = cleanText(body.name, 40);
    description = cleanText(body.description, 280);
    if (!name) return json({ error: "A tile name needs 1 to 40 characters." }, 400);
    if (!description) return json({ error: "A description needs 1 to 280 characters." }, 400);
  }

  if (game.status !== "playing") return json({ error: "The game has not started, so there are no turns yet." }, 409);
  if (player.turn_order !== game.turn) return json({ error: "It is not your turn." }, 403);

  await ensureTiles(env, game);
  const tile: any = await env.DB.prepare("SELECT owner_player_id FROM tiles WHERE game_id = ? AND x = ? AND y = ?").bind(game.id, x, y).first();
  if (!tile) return json({ error: `There is no land at ${coordLabel(x, y)}: that is open sea.` }, 400);
  if (body.kind === "claim" && tile.owner_player_id) return json({ error: "That tile is already owned." }, 409);
  if (body.kind === "describe" && tile.owner_player_id !== player.id) return json({ error: "You can only name and describe a tile you own." }, 403);
  // A proposal this turn is waiting for the referee: the turn is spent on that.
  const proposed = await env.DB.prepare("SELECT 1 AS x FROM turns WHERE game_id = ? AND player_id = ? AND round = ? AND status != 'withdrawn'")
    .bind(game.id, player.id, game.round).first();
  if (proposed) return json({ error: "You already proposed this turn. It is waiting for Chalant (the referee)." }, 409);

  const players = (await env.DB.prepare("SELECT id, display_name, color FROM players WHERE game_id = ? ORDER BY turn_order").bind(game.id).all()).results as any[];
  // How the turn goes on comes from the game's settings: moves per turn, and when points are harvested.
  const perTurn = S["turn.actions_per_turn"];
  const done = game.moves + 1 >= perTurn;            // this move is the turn's last
  const next = done ? (game.turn + 1) % players.length : game.turn;
  const wraps = done && next === 0;                  // the turn order wrapped: the round ends
  const H = S.harvest;
  const now = nowIso();
  const me = who(player.display_name, player.color);
  const nextP = players[next];
  const text = body.kind === "claim" ? `${me} claimed tile ${coordLabel(x, y)}.` : `${me} named tile ${coordLabel(x, y)} "${name}".`;

  const guardTile = body.kind === "claim" ? "AND t.owner_player_id IS NULL" : "AND t.owner_player_id = ?";
  const stmts = [
    env.DB.prepare(
      `INSERT INTO events (game_id, kind, text, created_at)
       SELECT g.id, ?, CASE WHEN g.status = 'playing' AND g.turn = ? AND g.round = ? AND g.moves = ?
              AND EXISTS (SELECT 1 FROM tiles t WHERE t.game_id = g.id AND t.x = ? AND t.y = ? ${guardTile})
              AND NOT EXISTS (SELECT 1 FROM turns u WHERE u.game_id = g.id AND u.player_id = ? AND u.round = g.round AND u.status != 'withdrawn')
              THEN ? ELSE NULL END, ?
       FROM games g WHERE g.id = ?`,
    ).bind(
      body.kind === "claim" ? "tile_claimed" : "tile_described", game.turn, game.round, game.moves, x, y,
      ...(body.kind === "claim" ? [] : [player.id]), player.id, text, now, game.id,
    ),
    body.kind === "claim"
      ? env.DB.prepare("UPDATE tiles SET owner_player_id = ?, claimed_at = ?, updated_at = ? WHERE game_id = ? AND x = ? AND y = ?").bind(player.id, now, now, game.id, x, y)
      : env.DB.prepare("UPDATE tiles SET name = ?, description = ?, updated_at = ? WHERE game_id = ? AND x = ? AND y = ?").bind(name, description, now, game.id, x, y),
  ];
  let harvest = "";
  if (H.points_per_tile > 0 && ((H.when === "end_of_round" && wraps) || (H.when === "end_of_turn" && done))) {
    // Tile counts per player after this move: only the acting player can change tiles during their turn.
    const rows = (await env.DB.prepare("SELECT owner_player_id AS id, COUNT(*) AS n FROM tiles WHERE game_id = ? AND owner_player_id IS NOT NULL GROUP BY owner_player_id").bind(game.id).all()).results as any[];
    const n = new Map(rows.map((r) => [r.id, r.n as number]));
    if (body.kind === "claim") n.set(player.id, (n.get(player.id) ?? 0) + 1);
    if (H.when === "end_of_round") {
      const parts = players.filter((p) => (n.get(p.id) ?? 0) > 0).map((p) => `${who(p.display_name, p.color)} +${n.get(p.id)! * H.points_per_tile}`);
      harvest = `Harvest at the end of round ${game.round}: ${parts.length ? parts.join(", ") : "nobody owns a tile yet"}.`;
      stmts.push(env.DB.prepare("UPDATE players SET score = score + ? * (SELECT COUNT(*) FROM tiles t WHERE t.game_id = players.game_id AND t.owner_player_id = players.id) WHERE game_id = ?").bind(H.points_per_tile, game.id));
    } else {
      harvest = `Harvest after ${me}'s turn: +${(n.get(player.id) ?? 0) * H.points_per_tile}.`;
      stmts.push(env.DB.prepare("UPDATE players SET score = score + ? * (SELECT COUNT(*) FROM tiles t WHERE t.game_id = players.game_id AND t.owner_player_id = players.id) WHERE game_id = ? AND id = ?").bind(H.points_per_tile, game.id, player.id));
    }
    stmts.push(env.DB.prepare("INSERT INTO events (game_id, kind, text, created_at) VALUES (?, 'harvest', ?, ?)").bind(game.id, harvest, now));
  }
  stmts.push(
    env.DB.prepare("UPDATE games SET turn = ?, round = round + ?, moves = ? WHERE id = ? AND turn = ? AND round = ? AND moves = ?")
      .bind(next, wraps ? 1 : 0, done ? 0 : game.moves + 1, game.id, game.turn, game.round, game.moves),
  );
  try {
    await env.DB.batch(stmts);
  } catch (e: any) {
    const msg = String(e?.message || e) + String(e?.cause?.message || "");
    if (/NOT NULL constraint failed/i.test(msg)) return json({ error: "The board changed under you. Reload and try again." }, 409);
    console.error("action failed:", msg);
    return json({ error: "Could not record your move. Try again." }, 500);
  }
  try {
    await notify(env, ctx, game, {
      kind: "turn_played", body: `${text} ${done ? `${who(nextP.display_name, nextP.color)} is up.` : "They have another move this turn."}${harvest ? " " + harvest : ""}`,
      email: true, exceptPlayerId: player.id, baseUrl: siteUrl(env, request),
    });
  } catch (e: any) {
    console.error("notify failed after action:", e?.message || e);
  }
  return json({ ok: true, kind: body.kind, turn_over: done, turn: next, round: game.round + (wraps ? 1 : 0), moves_left: done ? 0 : perTurn - game.moves - 1, harvest: harvest || null });
};
