// What a ticket looks like outside its own routes: the list, a ticket page's top, and a commission's row on the ballot.
// Kept apart from src/routes/api-tickets.ts so the proposals' and the ballot's routes can use it without a cycle.
import { Ctx, colorOf } from "./util";

export const FROM = `FROM tickets t JOIN players p ON p.game_id = t.game_id AND p.id = t.player_id LEFT JOIN proposals q ON q.id = t.proposal_id`;
export const COLS = `t.*, p.display_name AS name, p.color, q.number AS pnumber, q.status AS pstatus`;

// A ticket as the list and the ballot row show it. A whitelist: no row id, no player id.
/** @rule 801.2, 801.4, 803.1 */
export function ticketView(r: any, viewerId?: string | null) {
  return {
    n: `W${r.number}`, number: r.number,
    title: r.title, brief: r.brief, makes: JSON.parse(r.makes || "[]"),
    estimate: r.estimate, running_cost: r.running_cost,
    price: r.price, price_reason: r.price_reason, paid: r.paid ?? null,
    state: r.state,
    proposal: r.pnumber ? `P${r.pnumber}` : null,
    queue: r.queue_pos ?? null,
    by: { name: r.name, color: colorOf(r.color) },
    mine: !!viewerId && r.player_id === viewerId,
    created_at: r.created_at, proposed_at: r.proposed_at ?? null, approved_at: r.approved_at ?? null,
  };
}

// The tickets that ride on these commission proposals, by proposal id: what a ballot row shows (rule 801.2).
/** @rule 801.2 */
export async function commissionsFor(env: Ctx["env"], gameId: string, ids: string[]) {
  const map = new Map<string, ReturnType<typeof ticketView>>();
  if (!ids.length) return map;
  const rows = (await env.DB.prepare(`SELECT ${COLS} ${FROM} WHERE t.game_id = ? AND t.proposal_id IN (${ids.map(() => "?").join(",")})`).bind(gameId, ...ids).all()).results as any[];
  for (const r of rows) map.set(r.proposal_id, ticketView(r));
  return map;
}

