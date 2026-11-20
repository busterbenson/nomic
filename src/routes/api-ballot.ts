// GET /<slug>/api/ballot[?day=N]: a day's ballot (today's when no day is given). PUBLIC, like /api/day: no emails or
// ids. Each item is a proposal confirmed the day before (rule 104.3), with the votes it needs of that day's electorate
// (rules 104.1, 104.2, 105.4) and its turnout: how many have voted and who (rule 104.4). Signed in, it also has YOUR vote
// and whether you may vote now. Until an item is counted at midnight, nothing in this answer says how anyone else voted
// or what any total is (rule 104.4): turnout is the same whether a vote is yes or no. Once it is counted, its result
// and every vote (the roll call) are shown.
import { getPlayer } from "../lib/auth";
import { clockNow, electorsOf, isLocked, loadToday } from "../lib/day";
import { refusalBody, turnBlock } from "../lib/turn";
import { Ctx, colorOf, json } from "../lib/util";
import { COUNTED, view } from "./api-proposals";

/** @rule 104.1, 104.2, 104.3, 104.4 */
export const get = async (ctx: Ctx) => {
  const { env, request } = ctx;
  const nowMs = await clockNow(env);
  const player = await getPlayer(env, request, ctx.data.game!);
  const { game, day, turn } = await loadToday(env, ctx.data.game!, nowMs, player?.id);
  const asked = new URL(request.url).searchParams.get("day");
  const n = asked === null ? game.day : Number(asked);
  if (!Number.isInteger(n) || n < 0) return json({ error: "Give a day number, like ?day=3." }, 400);
  const dayRow: any = n ? await env.DB.prepare("SELECT n, status, electorate, ends_at FROM days WHERE game_id = ? AND n = ?").bind(game.id, n).first() : null;
  const rows = (await env.DB.prepare(
    `SELECT q.*, p.display_name AS name, p.color FROM proposals q JOIN players p ON p.game_id = q.game_id AND p.id = q.player_id
     WHERE q.game_id = ? AND q.day_ballot = ? AND q.status IN ('on_ballot', 'passed', 'failed', 'enacted', 'not_applied')
     ORDER BY q.number`,
  ).bind(game.id, n).all()).results as any[];
  const electors = dayRow ? await electorsOf(env, game.id, n) : [];
  const people = new Map(((await env.DB.prepare("SELECT id, display_name AS name, color, turn_order FROM players WHERE game_id = ? ORDER BY turn_order").bind(game.id).all()).results as any[]).map((p) => [p.id, p]));
  const votes = rows.length ? ((await env.DB.prepare("SELECT proposal_id, player_id, vote FROM votes WHERE game_id = ? AND day = ?").bind(game.id, n).all()).results as any[]) : [];
  const pill = (id: string) => { const p: any = people.get(id); return p ? { name: p.name, color: colorOf(p.color) } : null; };
  const ordered = [...electors].sort((a, b) => ((people.get(a) as any)?.turn_order ?? 0) - ((people.get(b) as any)?.turn_order ?? 0));
  const isToday = n === game.day && n > 0;
  const elector = !!player && electors.includes(player.id);
  // Whether you may vote now: the day's gates (the lock, End turn), then the electorate.
  const gate = player && isToday ? turnBlock(game, day, turn, player, "vote", nowMs) : null;
  const canVote = !player ? { allowed: false, reason: "Log in to vote." }
    : !isToday ? { allowed: false, reason: `Day ${n} is not today.` }
    : gate ? { allowed: false, reason: refusalBody(gate).error }
    : !elector ? { allowed: false, reason: `You joined after day ${n} began, so you vote from tomorrow (rule 104.2).` }
    : { allowed: true };
  const items = rows.map((r) => {
    const mine = votes.filter((v) => v.proposal_id === r.id);
    const voters = ordered.filter((id) => mine.some((v) => v.player_id === id));
    const counted = COUNTED.includes(r.status);
    const open = r.status === "on_ballot" && isToday;
    return {
      ...view(r, player?.id, electors.length || dayRow?.electorate || undefined),
      threshold_rule: "104.1",
      turnout: { voted: voters.length, of: electors.length, players: voters.map(pill) },
      your_vote: player ? (mine.find((v) => v.player_id === player.id)?.vote ?? null) : null,
      can_vote: open ? canVote : { allowed: false, reason: counted ? "The votes are counted." : canVote.reason },
      roll_call: counted ? ordered.map((id) => ({ ...pill(id), vote: mine.find((v) => v.player_id === id)?.vote ?? null })) : undefined,
    };
  });
  const yours = player ? items.filter((i) => i.your_vote).length : 0;
  return json({
    day: n,
    today: game.day,
    status: dayRow?.status ?? null,
    ends_at: dayRow?.ends_at ?? null,
    locked: isToday && !!day && game.status === "playing" && isLocked(game, day, nowMs),
    electorate: electors.length || dayRow?.electorate || 0,
    items,
    you: player ? { elector, voted: yours, of: items.length, can_vote: canVote } : null,
  });
};
