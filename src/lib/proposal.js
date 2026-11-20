// The SQL that records a proposal (the legacy prompt log, until proposals arrive), shared by POST /<slug>/api/turn and
// the tests that prove its guard. It inserts a row only if the game is still as the handler read it: playing, on the
// same day, the day open and not past midnight (rule 107.1), and the player's turn not ended (rule 202.4). `round` holds
// the day number, so the one-live-row-per-round index means one proposal a day (rule 202.2). (A move does not conflict
// with a proposal: a turn may hold both.)
// Binds, in order: id, player_id, turn_index, prompt, created_at, updated_at, game_id, then dayOpenBinds (day, now, day,
// player_id) from src/lib/day.ts.
import { dayOpenSql } from "./day-gate.js";
export const PROPOSAL_INSERT_SQL = `INSERT INTO turns (id, game_id, player_id, round, turn_index, prompt, status, created_at, updated_at)
  SELECT ?, g.id, ?, g.day, ?, ?, 'submitted', ?, ? FROM games g
  WHERE g.id = ? AND ${dayOpenSql}`;
