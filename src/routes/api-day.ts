// GET /<slug>/api/day: today, for the day status row and the MCP server's read_day / my_state. PUBLIC, like /api/game:
// no emails, ids or join code. With a session it also says what YOU have done today and may still do.
//   day         the day number (0 before the game starts), starts_at / ends_at (UTC ISO), the game's time zone
//   locked      the midnight lock is on (rule 107.1): by the clock, even before the midnight run has set the flag
//   processing_day, message   while locked: the day being processed, and the sentence every write answers with
//   failed      while locked: the last processing attempt failed (the lock stays on until it succeeds)
//   deadline_at while processing: the 2 am deadline (rule 107.6), when play resumes at the latest
//   ballot      how many items today's ballot has
//   players     each player's name, color and what they have done today (moved, proposed, ended, and on how many
//               ballot items they have voted: never how, rule 104.4)
//   you         (signed in) moved / proposed / ended / voted, and can: {move, propose, end_turn, vote} each
//               {allowed, reason?}, the same answers the write routes give (turnBlock)
import { getPlayer } from "../lib/auth";
import { clockNow, electorsOf, isLocked, loadToday, lockMessage, timeZoneOf } from "../lib/day";
import { turnBlock } from "../lib/turn";
import { Ctx, colorOf, json } from "../lib/util";

/** @rule 104.4, 107.1, 202.1, 203.1 */
export const get = async (ctx: Ctx) => {
  const { env, request } = ctx;
  const nowMs = await clockNow(env);
  const player = await getPlayer(env, request, ctx.data.game!);
  const { game, day, turn } = await loadToday(env, ctx.data.game!, nowMs, player?.id);
  const locked = !!day && game.status === "playing" && isLocked(game, day, nowMs);
  if (day) await electorsOf(env, game.id, day.n); // a day opened without its electorate rows gets them (rule 104.2)
  const rows = (await env.DB.prepare(
    `SELECT p.display_name AS name, p.color, p.turn_order, t.moved_at, t.ended_at,
            EXISTS (SELECT 1 FROM proposals u WHERE u.game_id = p.game_id AND u.player_id = p.id AND u.day_proposed = ? AND u.status NOT IN ('draft', 'withdrawn')) AS proposed,
            (SELECT COUNT(*) FROM votes v JOIN proposals q ON q.id = v.proposal_id
              WHERE v.game_id = p.game_id AND v.player_id = p.id AND v.day = ? AND q.day_ballot = ?) AS voted,
            EXISTS (SELECT 1 FROM electors e WHERE e.game_id = p.game_id AND e.day = ? AND e.player_id = p.id) AS elector
     FROM players p LEFT JOIN day_turns t ON t.game_id = p.game_id AND t.day = ? AND t.player_id = p.id
     WHERE p.game_id = ? ORDER BY p.turn_order`,
  ).bind(game.day, game.day, game.day, game.day, game.day, game.id).all()).results as any[];
  const ballot: any = await env.DB.prepare("SELECT COUNT(*) AS n FROM proposals WHERE game_id = ? AND day_ballot = ? AND status = 'on_ballot'").bind(game.id, game.day).first();
  const mine = player ? rows.find((r) => r.turn_order === player.turn_order) : null;
  const can = (kind: "move" | "propose" | "end_turn" | "vote") => {
    const b = player && turnBlock(game, day, turn, player, kind, nowMs);
    if (b) return { allowed: false, reason: b.error };
    if (kind === "propose" && mine?.proposed) return { allowed: false, reason: "You already proposed today. One proposal a day." };
    if (kind === "vote" && !(ballot?.n > 0)) return { allowed: false, reason: "Today's ballot is empty." };
    if (kind === "vote" && !mine?.elector) return { allowed: false, reason: `You joined after day ${game.day} began, so you vote from tomorrow (rule 104.2).` };
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
    deadline_at: locked && day!.status === "processing" ? day!.deadline_at ?? null : null,
    ballot: ballot?.n ?? 0,
    players: rows.map((r) => ({ name: r.name, color: colorOf(r.color), moved: !!r.moved_at, proposed: !!r.proposed, ended: !!r.ended_at, voted: r.voted ?? 0 })),
    you: player ? {
      moved: !!turn?.moved_at, proposed: !!mine?.proposed, ended: !!turn?.ended_at, voted: mine?.voted ?? 0,
      can: { move: can("move"), propose: can("propose"), end_turn: can("end_turn"), vote: can("vote") },
    } : null,
  });
};
