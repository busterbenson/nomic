// GET /<slug>/api/day: today, for the day status row and the MCP server's read_day / my_state. PUBLIC, like /api/game:
// no emails, ids or join code. With a session it also says what YOU have done today and may still do.
//   day         the day number (0 before the game starts), starts_at / ends_at (UTC ISO), the game's time zone
//   locked      the midnight lock is on (rule 107.1): by the clock, even before the midnight run has set the flag
//   processing_day, message   while locked: the day being processed, and the sentence every write answers with
//   failed      while locked: the last processing attempt failed (the lock stays on until it succeeds)
//   players     each player's name, color and what they have done today (moved, proposed, ended)
//   you         (signed in) moved / proposed / ended, and can: {move, propose, end_turn} each {allowed, reason?}, the
//               same answers the write routes give (turnBlock)
import { getPlayer } from "../lib/auth";
import { clockNow, isLocked, loadToday, lockMessage, timeZoneOf } from "../lib/day";
import { turnBlock } from "../lib/turn";
import { Ctx, colorOf, json } from "../lib/util";

/** @rule 107.1, 202.1, 203.1 */
export const get = async (ctx: Ctx) => {
  const { env, request } = ctx;
  const nowMs = await clockNow(env);
  const player = await getPlayer(env, request, ctx.data.game!);
  const { game, day, turn } = await loadToday(env, ctx.data.game!, nowMs, player?.id);
  const locked = !!day && game.status === "playing" && isLocked(game, day, nowMs);
  const rows = (await env.DB.prepare(
    `SELECT p.display_name AS name, p.color, p.turn_order, t.moved_at, t.ended_at,
            EXISTS (SELECT 1 FROM turns u WHERE u.game_id = p.game_id AND u.player_id = p.id AND u.round = ? AND u.status != 'withdrawn') AS proposed
     FROM players p LEFT JOIN day_turns t ON t.game_id = p.game_id AND t.day = ? AND t.player_id = p.id
     WHERE p.game_id = ? ORDER BY p.turn_order`,
  ).bind(game.day, game.day, game.id).all()).results as any[];
  const mine = player ? rows.find((r) => r.turn_order === player.turn_order) : null;
  const can = (kind: "move" | "propose" | "end_turn") => {
    const b = player && turnBlock(game, day, turn, player, kind, nowMs);
    if (b) return { allowed: false, reason: b.error };
    if (kind === "propose" && mine?.proposed) return { allowed: false, reason: "You already proposed today. One proposal a day." };
    return { allowed: true };
  };
  return json({
    day: game.day,
    status: game.status,
    starts_at: day?.starts_at ?? null,
    ends_at: day?.ends_at ?? null,
    timezone: timeZoneOf(game),
    now: new Date(nowMs).toISOString(),
    locked,
    processing_day: locked ? day!.n : null,
    message: locked ? lockMessage(day!.n) : null,
    failed: locked && !!day!.last_error,
    players: rows.map((r) => ({ name: r.name, color: colorOf(r.color), moved: !!r.moved_at, proposed: !!r.proposed, ended: !!r.ended_at })),
    you: player ? {
      moved: !!turn?.moved_at, proposed: !!mine?.proposed, ended: !!turn?.ended_at,
      can: { move: can("move"), propose: can("propose"), end_turn: can("end_turn") },
    } : null,
  });
};
