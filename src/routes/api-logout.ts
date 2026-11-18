import { cookieHeader, destroySession } from "../lib/auth";
import { Ctx, json } from "../lib/util";

export const post = async ({ env, request, data }: Ctx) => {
  await destroySession(env, request, data.game!);
  return json({ ok: true }, 200, { "set-cookie": cookieHeader(data.game!.slug, "", 0) });
};
