import { emailMode } from "../_lib/email";
import { issueLink, tooManyLinks } from "../_lib/links";
import { Ctx, json, normEmail, readJson, validEmail } from "../_lib/util";

export const onRequestPost = async (ctx: Ctx) => {
  const { env } = ctx;
  if (!emailMode(env)) return json({ error: "Email is not configured, so log-in is unavailable." }, 503);
  const body = await readJson(ctx.request);
  if (!body || !validEmail(body.email)) return json({ error: "That doesn't look like an email address." }, 400);
  const email = normEmail(body.email);

  if (await tooManyLinks(env, email)) return json({ error: "Too many links requested. Wait 15 minutes and try again." }, 429);
  const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  // A token row is written either way (it counts toward the limit) but only a
  // real account is emailed, and the response never says which case it was.
  const link = await issueLink(ctx, {
    email, purpose: "login", send: !!user,
    subject: "Your Nomic log-in link", intro: "Click to log in to Nomic.",
  });
  if (!link) return json({ error: "Too many links requested. Wait 15 minutes and try again." }, 429);
  const res: any = { ok: true, message: "If that address has an account, a log-in link is on its way." };
  if (emailMode(env) === "dev") res.dev_link = link;
  return json(res);
};
