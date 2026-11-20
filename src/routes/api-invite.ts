// GET /<slug>/api/invite: your own invite link (rule 102.3), for a signed-in player of THIS game only (401 otherwise: a
// viewer who is logged out, or who plays another game, has no session here). The join code is the game's one shared
// secret, so this is the only route that says it. Any player can invite while the game has room (fewer players than its size limit, rule 201), in setup
// and during play: the answer is {url}. A full game answers {url: null, reason: "The game is full (8 of 8)."}, so the menu shows the item disabled with
// the reason; a game that is over answers {url: null} and no reason (the item is hidden).
import { getPlayer } from "../lib/auth";
import { inviteUrl, roomFor } from "../lib/invite";
import { Ctx, json, seatLimit } from "../lib/util";

/** @rule 102.3 */
export const get = async (ctx: Ctx) => {
  const { env, request } = ctx;
  const game = ctx.data.game!;
  const player = await getPlayer(env, request, game);
  if (!player) return json({ error: "Not logged in." }, 401);
  if (game.status === "over") return json({ url: null });
  if (!(await roomFor(env, game))) return json({ url: null, reason: `The game is full (${seatLimit(game)} of ${seatLimit(game)}).` });
  return json({ url: await inviteUrl(ctx, player.id) });
};
