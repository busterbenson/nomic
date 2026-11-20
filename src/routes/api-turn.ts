// POST /<slug>/api/turn {kind, target, words?, to?, title?, prefilled?}: the old "submit a prompt" route, now draft +
// confirm in one call (rule 103.1, 103.2), so a client that does not show the moderator's draft first can still propose.
// A bare {prompt} with no rule to change can't be drafted, so it is refused with what to send instead.
import { getPlayer } from "../lib/auth";
import { clockNow } from "../lib/day";
import { Ctx, json, readJson } from "../lib/util";
import { confirm, draft } from "./api-proposals";

/** @rule 103.1, 103.2 */
export const post = async (ctx: Ctx) => {
  const player = await getPlayer(ctx.env, ctx.request, ctx.data.game!);
  if (!player) return json({ error: "Log in to play a turn." }, 401);
  const body = await readJson(ctx.request);
  if (body && body.kind === undefined && typeof body.prompt === "string") {
    return json({ error: "Say which rule to change and how: send kind (reword, addclause, add, repeal, move or mark) and target (a rule, clause or block number), with your words." }, 400);
  }
  const nowMs = await clockNow(ctx.env);
  const d = await draft(ctx, player, body, nowMs);
  if (d.status !== 200) return json(d.body, d.status);
  // Drafting may have called the model: the confirm is timed again, so it can't land after midnight (rule 107.1).
  const c = await confirm(ctx, player, d.body.proposal.id, await clockNow(ctx.env));
  return json(c.body, c.status);
};
