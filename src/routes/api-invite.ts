// GET /<slug>/api/invite: the game's join link, for a signed-in player of THIS game only (401 otherwise: a viewer who is
// logged out, or who plays another game, has no session here). The join code is the game's one shared secret, so this is the
// only route that says it. While the game is still in setup and has a free seat the answer is {url}; once it is full or has
// started it is {url: null} (200, so the page just hides "Invite a friend"). Per-player invite links come with PR 7.
import { getPlayer } from "../lib/auth";
import { Ctx, json, seatLimit, seatsTaken, siteUrl } from "../lib/util";

/** @rule 102 */
export const get = async (ctx: Ctx) => {
  const { env, request } = ctx;
  const game = ctx.data.game!;
  const player = await getPlayer(env, request, game);
  if (!player) return json({ error: "Not logged in." }, 401);
  if (game.status !== "setup" || (await seatsTaken(env, game.id)).length >= seatLimit(game)) return json({ url: null });
  return json({ url: `${siteUrl(env, request)}/${game.slug}/join/${game.join_code}` });
};
