import { getUser } from "../../_lib/auth";
import { Ctx, json, nowIso, readJson } from "../../_lib/util";

// Body: {"all": true} or {"ids": ["..."]}. Only the caller's own rows change.
export const onRequestPost = async ({ env, request }: Ctx) => {
  const user = await getUser(env, request);
  if (!user) return json({ error: "Not logged in." }, 401);
  const body = await readJson(request);
  if (!body) return json({ error: "Send a JSON body." }, 400);
  const at = nowIso();
  if (body.all === true) {
    await env.DB.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").bind(at, user.id).run();
  } else if (Array.isArray(body.ids) && body.ids.length === 0) {
    // nothing to mark
  } else if (Array.isArray(body.ids) && body.ids.length <= 100 && body.ids.every((i: unknown) => typeof i === "string")) {
    await env.DB.batch(
      body.ids.map((id: string) =>
        env.DB.prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL").bind(at, id, user.id),
      ),
    );
  } else {
    return json({ error: "Send {all: true} or {ids: [...]}." }, 400);
  }
  return json({ ok: true });
};
