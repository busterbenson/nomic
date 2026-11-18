import { emailMode } from "../lib/email";
import { issueLink, tooManyLinks } from "../lib/links";
import { Ctx, MARKERS, cleanName, json, normCode, normEmail, readJson, seatsTaken, validEmail } from "../lib/util";

export const post = async (ctx: Ctx) => {
  const { env } = ctx;
  const game = ctx.data.game!;
  if (!emailMode(env)) return json({ error: "Email is not configured, so nobody can join yet." }, 503);
  const body = await readJson(ctx.request);
  if (!body) return json({ error: "Send a JSON body." }, 400);

  // The code must be THIS game's code: another game's code does not open this one.
  if (!normCode(body.code) || normCode(body.code) !== game.join_code) return json({ error: "That code doesn't match this game." }, 404);
  if (game.status !== "setup") return json({ error: "This game has already started, so the seats are closed." }, 409);
  const taken = await seatsTaken(env, game.id);
  if (taken.length >= game.max_players) return json({ error: "This game is full." }, 409);
  const marker = MARKERS.find((m) => m.marker === body.marker)?.marker;
  if (!marker) return json({ error: "Pick one of the markers." }, 400);
  if (taken.some((t) => t.marker === marker)) return json({ error: "Someone already has that marker. Pick another." }, 409);
  const name = cleanName(body.name);
  if (!name) return json({ error: "Your name needs 1 to 40 characters." }, 400);
  if (!validEmail(body.email)) return json({ error: "That doesn't look like an email address." }, 400);
  const email = normEmail(body.email);

  if (await tooManyLinks(env, game.id, email)) return json({ error: "Too many links requested. Wait 15 minutes and try again." }, 429);
  // Same answer whether or not this address already has a seat here.
  const link = await issueLink(ctx, game, {
    email, purpose: "join", name, marker, send: true,
    subject: `Finish joining ${game.name}`,
    intro: `Click to take your seat in ${game.name} as ${marker} ${name}.`,
  });
  if (!link) return json({ error: "Too many links requested. Wait 15 minutes and try again." }, 429);
  const res: any = { ok: true, message: "Check your email for a link to finish joining." };
  if (emailMode(env) === "dev") res.dev_link = link;
  return json(res);
};
