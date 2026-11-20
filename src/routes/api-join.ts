import { clockNow } from "../lib/day";
import { emailMode } from "../lib/email";
import { joinLock } from "../lib/invite";
import { issueLink, tooManyLinks } from "../lib/links";
import { Ctx, DEFAULT_SHAPE, PALETTE, cleanName, json, normCode, normEmail, playersLine, readJson, seatLimit, seatsTaken, validEmail, validShape } from "../lib/util";

/** @rule 102.3 */
export const post = async (ctx: Ctx) => {
  const { env } = ctx;
  const game = ctx.data.game!;
  if (!emailMode(env)) return json({ error: "Email is not configured, so nobody can join yet." }, 503);
  const body = await readJson(ctx.request);
  if (!body) return json({ error: "Send a JSON body." }, 400);

  // The code must be THIS game's code: another game's code does not open this one.
  if (!normCode(body.code) || normCode(body.code) !== game.join_code) return json({ error: "That code doesn't match this game." }, 404);
  if (game.status === "over") return json({ error: "This game is over, so it's closed to new players." }, 409);
  const lockedDay = await joinLock(env, game, await clockNow(env));
  if (lockedDay) return json({ error: `Chalant is processing day ${lockedDay}. You can join when it's done.` }, 423);
  const taken = await seatsTaken(env, game.id);
  if (taken.length >= seatLimit(game)) return json({ error: "This game is full." }, 409);
  const color = PALETTE.find((c) => c.key === body.color)?.key;
  if (!color) return json({ error: "Pick one of the piece colors." }, 400);
  // A shape is optional (the plain pawn); one that is named must be one of the shapes.
  if (body.shape !== undefined && !validShape(body.shape)) return json({ error: "Pick one of the piece shapes." }, 400);
  const shape = body.shape === undefined ? DEFAULT_SHAPE : body.shape;
  if (taken.some((t) => t.color === color)) return json({ error: "Someone already has that color. Pick another." }, 409);
  const name = cleanName(body.name);
  if (!name) return json({ error: "Your name needs 1 to 40 characters." }, 400);
  if (!validEmail(body.email)) return json({ error: "That doesn't look like an email address." }, 400);
  const email = normEmail(body.email);

  if (await tooManyLinks(env, game.id, email)) return json({ error: "Too many links requested. Wait 15 minutes and try again." }, 429);
  // Same answer whether or not this address already has a seat here.
  const link = await issueLink(ctx, game, {
    email, purpose: "join", name, color, shape, send: true,
    subject: `Promptocracy: join ${game.name}`,
    intro: `Hi ${name},\n\nYou asked to join ${game.name}, a game of Promptocracy. You'll play as ${PALETTE.find((c) => c.key === color)!.name}.\n\n${playersLine(taken, seatLimit(game))}`,
    action: "To join the game",
  });
  if (!link) return json({ error: "Too many links requested. Wait 15 minutes and try again." }, 429);
  const res: any = { ok: true, message: "Check your email for a link to finish joining." };
  if (emailMode(env) === "dev") res.dev_link = link;
  return json(res);
};
