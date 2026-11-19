// Who may act now. ONE place for the turn guards that POST /<slug>/api/turn (propose) and POST
// /<slug>/api/action (move) apply, so the MCP server's `my_state` reports exactly what those routes will
// accept, and a later change to the turn model changes all three together.
// Returns the refusal the route sends, or null when the player may act.
export type Refusal = { status: number; error: string };

export function turnBlock(
  game: { status: string; turn: number; round: number; last_move: string },
  player: { turn_order: number },
  kind: "propose" | "move",
): Refusal | null {
  if (game.status !== "playing") return { status: 409, error: "The game has not started, so there are no turns yet." };
  if (player.turn_order !== game.turn) return { status: 403, error: "It is not your turn." };
  if (kind === "move" && game.last_move === `${game.round}:${game.turn}`) return { status: 409, error: "You already moved this turn." };
  return null;
}
