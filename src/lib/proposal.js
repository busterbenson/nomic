// The SQL that records a proposal, shared by POST /<slug>/api/turn and the tests that prove its guard.
// It inserts a row only if the game is still exactly as the handler read it: playing, the same turn and
// round, and no board move made this turn (games.moves = 0). A board move racing a proposal can complete
// the turn in between; then this inserts nothing and the handler answers 409.
// Binds, in order: id, player_id, prompt, created_at, updated_at, game_id, turn, round.
export const PROPOSAL_INSERT_SQL = `INSERT INTO turns (id, game_id, player_id, round, turn_index, prompt, status, created_at, updated_at)
  SELECT ?, g.id, ?, g.round, g.turn, ?, 'submitted', ?, ? FROM games g
  WHERE g.id = ? AND g.status = 'playing' AND g.turn = ? AND g.round = ? AND g.moves = 0`;
