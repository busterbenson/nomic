import { cookieHeader, destroySession } from "../_lib/auth";
import { Ctx, json } from "../_lib/util";

export const onRequestPost = async ({ env, request }: Ctx) => {
  await destroySession(env, request);
  return json({ ok: true }, 200, { "set-cookie": cookieHeader("", 0) });
};
