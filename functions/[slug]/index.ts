// GET /<slug>/ serves the one static board page (board.html) for every game; the
// page reads its slug from location.pathname. The middleware has already checked
// the game exists. /site.css also lands here (it looks like a slug to the router)
// and is handed to the static files.
import { Ctx } from "../_lib/util";

export const onRequestGet = async ({ env, request, params }: Ctx) => {
  const url = new URL(request.url);
  if (params.slug === "site.css") return env.ASSETS!.fetch(request);
  const res = await env.ASSETS!.fetch(new Request(new URL("/board", url), { headers: request.headers }));
  const out = new Response(res.body, res);
  out.headers.set("cache-control", "no-store");
  return out;
};
