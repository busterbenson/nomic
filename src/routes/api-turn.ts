// POST /<slug>/api/turn {prompt}: a player submits today's prompt (the proposal part of their turn, rule 202.2).
// Every player has a turn every day, in no order (rule 202.1); one prompt a day; refused during the midnight lock
// (rule 107.1) and after End turn (rule 202.4). This only RECORDS the prompt: drafting, the ballot and the vote are
// built in the next steps.
import { getPlayer } from "../lib/auth";
import { PROPOSAL_INSERT_SQL } from "../lib/proposal.js";
import { notify } from "../lib/notify";
import { clockNow, dayOpenBinds, loadToday } from "../lib/day";
import { refusalBody, turnBlock } from "../lib/turn";
import { Ctx, json, nowIso, readJson, siteUrl, who } from "../lib/util";

/** @rule 202.2 */
export const post = async (ctx: Ctx) => {
  const { env, request } = ctx;
  const nowMs = await clockNow(env);
  const player = await getPlayer(env, request, ctx.data.game!);
  if (!player) return json({ error: "Log in to play a turn." }, 401);
  const body = await readJson(request);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt || [...prompt].length > 2000) return json({ error: "Your prompt needs 1 to 2000 characters." }, 400);

  const { game, day, turn } = await loadToday(env, ctx.data.game!, nowMs, player.id);
  const blocked = turnBlock(game, day, turn, player, "propose", nowMs);
  if (blocked) return json(refusalBody(blocked), blocked.status);

  const now = nowIso(nowMs);
  const name = player.display_name;
  // The turn and its log line land together or not at all.
  // Both statements only land if the day is still open and the player's turn not ended (the SQL repeats the gate).
  const turnId = crypto.randomUUID();
  try {
    const res = await env.DB.batch([
      env.DB.prepare(PROPOSAL_INSERT_SQL)
        .bind(turnId, player.id, player.turn_order, prompt, now, now, game.id, ...dayOpenBinds(game.day, nowMs, player.id)),
      env.DB.prepare("INSERT INTO events (game_id, kind, text, created_at, day, phase, player_id) SELECT ?, 'turn_submitted', ?, ?, ?, 'day', ? WHERE EXISTS (SELECT 1 FROM turns WHERE id = ?)")
        .bind(game.id, `${who(name, player.color)} proposed a change.`, now, game.day, player.id, turnId),
    ]);
    if (!(res[0]?.meta?.changes > 0)) return json({ error: "The day changed under you. Reload and try again." }, 409);
  } catch (e: any) {
    // Only the one-live-turn-per-round index means "already took it"; anything else is a real failure.
    if (/UNIQUE constraint failed/i.test(String(e?.message || e) + String(e?.cause?.message || ""))) {
      return json({ error: "You already proposed today. One proposal a day." }, 409);
    }
    console.error("turn insert failed:", e?.message || e);
    return json({ error: "Could not record your turn. Try again." }, 500);
  }
  try {
    await notify(env, ctx, game, {
      kind: "turn_submitted", body: `${who(name, player.color)} proposed a change.`,
      email: true, exceptPlayerId: player.id, baseUrl: siteUrl(env, request),
    });
  } catch (e: any) {
    console.error("notify failed after turn:", e?.message || e);
  }
  return json({ ok: true, status: "submitted", message: "Proposal recorded. Waiting for Chalant (the moderator)." });
};
