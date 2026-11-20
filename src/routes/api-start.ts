// POST /<slug>/api/start {}: the host starts the game (rules 102.2, 203.1). Only the host can, and only a game still in
// setup. It puts the game in play and begins day 1 through the day code (startDayOne), the same code that begins a day 1
// the first time anyone asks for today. Refused with a plain reason otherwise.
import { getPlayer } from "../lib/auth";
import { clockNow, startDayOne } from "../lib/day";
import { Ctx, json } from "../lib/util";

/** @rule 102.2, 203.1 */
export const post = async (ctx: Ctx) => {
  const { env, request } = ctx;
  const game = ctx.data.game!;
  const player = await getPlayer(env, request, game);
  if (!player) return json({ error: "Log in to start the game." }, 401);
  if (!player.is_host) return json({ error: "Only the host can start the game." }, 403);
  if (game.status !== "setup") return json({ error: "The game has already started." }, 409);
  // Guarded: of two Start presses, only one finds the game in setup.
  const r = await env.DB.prepare("UPDATE games SET status = 'playing' WHERE id = ? AND status = 'setup'").bind(game.id).run();
  if ((r.meta?.changes ?? 0) < 1) return json({ error: "The game has already started." }, 409);
  await startDayOne(env, game, await clockNow(env));
  return json({ ok: true, day: 1 });
};
