// Log in to THIS game. An address with no seat here gets the same answer as one that has.
import { emailMode } from "../../_lib/email";
import { issueLink, tooManyLinks } from "../../_lib/links";
import { Ctx, json, normEmail, readJson, validEmail } from "../../_lib/util";

export const onRequestPost = async (ctx: Ctx) => {
  const { env } = ctx;
  const game = ctx.data.game!;
  if (!emailMode(env)) return json({ error: "Email is not configured, so log-in is unavailable." }, 503);
  const body = await readJson(ctx.request);
  if (!body || !validEmail(body.email)) return json({ error: "That doesn't look like an email address." }, 400);
  const email = normEmail(body.email);

  if (await tooManyLinks(env, game.id, email)) return json({ error: "Too many links requested. Wait 15 minutes and try again." }, 429);
  const player = await env.DB.prepare("SELECT id FROM players WHERE game_id = ? AND email = ?").bind(game.id, email).first();
  // A token row is written either way (it counts toward the limits) but only a
  // real player is emailed, and the response never says which case it was.
  const link = await issueLink(ctx, game, {
    email, purpose: "login", send: !!player,
    subject: `Your ${game.name} log-in link`, intro: `Click to log in to ${game.name}.`,
  });
  if (!link) return json({ error: "Too many links requested. Wait 15 minutes and try again." }, 429);
  const res: any = { ok: true, message: "If that address has a seat in this game, a log-in link is on its way." };
  if (emailMode(env) === "dev") res.dev_link = link;
  return json(res);
};
