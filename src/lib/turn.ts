// Who may act now. ONE place for the guards that every write route applies (POST /<slug>/api/action to move,
// /api/turn to propose, /api/end-turn), so the MCP server's `my_state` reports exactly what those routes will accept,
// and a later change to the day changes all of them together.
//   1. the engine's day gates (src/lib/day.ts dayGate): the game is playing and has a day, the day is not locked
//      (rule 107.1, checked against the clock), the player has not ended their turn (rule 202.4)
//   2. what the game's rule modules say about the action, asked with no destination (rule 202: one move a day)
// There is no order of play (rule 202.1): every player has a turn every day. Returns the refusal or null.
import { checkAction, lightContext } from "../engine/host";
import { DayRow, DayTurn, dayGate } from "./day";

export type Refusal = { status: number; error: string; processing_day?: number };

/** @rule 107.1, 202.1, 202.4 */
export function turnBlock(
  game: { status: string; phase?: string; turn: number; round: number; day?: number; slug: string; settings: string },
  day: DayRow | null,
  turn: DayTurn,
  player: { id: string },
  kind: "propose" | "move" | "end_turn",
  nowMs: number,
): Refusal | null {
  const gate = dayGate(game, day, turn, nowMs);
  if (gate) return gate;
  if (kind === "end_turn") return null;
  return checkAction(game, lightContext(game, { moved: !!turn?.moved_at }), { ref: player.id }, { kind });
}

// A refusal as the routes send it: the 423 of the lock also names the day being processed.
/** @rule 107.1 */
export const refusalBody = (r: Refusal) => (r.processing_day ? { error: r.error, processing_day: r.processing_day } : { error: r.error });
