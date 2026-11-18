import { cookieHeader, destroySession } from "../../_lib/auth";
import { Ctx, json } from "../../_lib/util";

export const onRequestPost = async ({ env, request, data }: Ctx) => {
  await destroySession(env, request, data.game!);
  return json({ ok: true }, 200, { "set-cookie": cookieHeader(data.game!.slug, "", 0) });
};
