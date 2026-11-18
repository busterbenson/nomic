import { getPlayer } from "../../_lib/auth";
import { Ctx, json } from "../../_lib/util";

export const onRequestGet = async ({ env, request, data }: Ctx) => {
  const p = await getPlayer(env, request, data.game!);
  if (!p) return json({ error: "Not logged in." }, 401);
  return json({
    user: { email: p.email, name: p.display_name },
    player: { marker: p.marker, color: p.color, score: p.score, turn_order: p.turn_order, is_host: !!p.is_host },
  });
};
