// Votes and the count, the pure parts (plain JavaScript, shared by the Worker and the tests): the count itself (rules
// 104.1, 104.5), the result sentence, the reason a passed proposal goes back to its proposer (rule 107.7), and the
// SQL of the vote's own guarded write. src/lib/day.ts runs the count at midnight; src/routes/api-votes.ts and
// api-ballot.ts are the routes.
import { dayOpenSql } from "./day-gate.js";
import { neededOf } from "./proposals.js";

export const VOTES = ["yes", "no"];

// The count (rule 104.5: by code, not by the moderator). `votes` are the electorate's votes on one item; anyone in the
// electorate who did not vote counts as no (rule 104.1). It passes when the yes votes reach what it needs: its mark,
// fixed at confirm (rule 105.4), of the electorate fixed at the start of the day (rule 104.2). A vote from outside the
// electorate is not counted (the database refuses one anyway).
/** @rule 104.1, 104.2, 104.5 */
export function tally({ mark, electorate, electors, votes, needed }) {
  const inside = new Set(electors ?? []);
  const counted = (votes ?? []).filter((v) => !electors || inside.has(v.player_id));
  const yes = counted.filter((v) => v.vote === "yes").length;
  const no = counted.filter((v) => v.vote === "no").length;
  const need = Number.isInteger(needed) ? needed : neededOf(mark, electorate);
  const absent = Math.max(0, electorate - yes - no);
  return { yes, no, absent, needed: need, electorate, passed: yes >= need };
}

// "3 of 5 voted yes; it needed 3." Written on every counted proposal.
/** @rule 104.1 */
export const resultSentence = (t) => `${t.yes} of ${t.electorate} voted yes; it needed ${t.needed}.`;

// Rule 107.6: what a passed proposal still unapplied at the deadline is told, and the suggestion that goes with it
// (rule 107.7).
/** @rule 107.6, 107.7 */
export const DEADLINE_REASON = "Chalant did not finish processing by 2:00 am";
/** @rule 107.7 */
export const SUGGESTION = "Try splitting it into smaller proposals or simplifying it, and propose it again.";
/** @rule 107.7 */
export const returnedBody = (number, reason) => `P${number} passed but was not applied: ${reason}. It gave no points. ${SUGGESTION}`;

// Rule 107.7: an applied proposal whose change was not live by the deploy deadline (the 2 am deadline + 30 minutes).
/** @rule 107.6, 107.7 */
export const DEPLOY_REASON = "the change was applied but did not go live by 2:30 am";
// Rule 107.7: the change went live, but a rule's night code (its points, the win) failed at the unlock until past the
// deploy deadline, so the lock ended without it.
/** @rule 107.6, 107.7 */
export const ENACT_REASON = "its rules went live, but their points could not be given by 2:30 am";
// How long after the deadline a claimed night may take to go live (the build and deploy), in minutes.
export const DEPLOY_GRACE_MINUTES = 30;

/** @rule 104.3 */
export const voteToast = (n, vote) => `P${n}: you voted ${vote === "yes" ? "Yes" : "No"}. You can change it until midnight.`;

// The vote's write. It lands only if the day is still open and not past midnight (rule 107.1), the player has not
// ended their turn (rule 202.4), the proposal is on today's ballot, and the player is in today's electorate (rule
// 104.2). A second vote on the same item replaces the first (rule 104.3): one row per player and item, however many
// arrive at once. Binds: game_id, proposal_id, player_id, vote, cast_at, updated_at, game_id, then dayOpenBinds, then
// proposal_id, player_id.
const GUARD = `g.id = ? AND ${dayOpenSql}
    AND EXISTS (SELECT 1 FROM proposals q WHERE q.id = ? AND q.game_id = g.id AND q.status = 'on_ballot' AND q.day_ballot = g.day)
    AND EXISTS (SELECT 1 FROM electors e WHERE e.game_id = g.id AND e.day = g.day AND e.player_id = ?)`;
export const VOTE_SQL = `INSERT INTO votes (game_id, proposal_id, player_id, day, vote, cast_at, updated_at)
  SELECT ?, ?, ?, g.day, ?, ?, ? FROM games g WHERE ${GUARD}
  ON CONFLICT (proposal_id, player_id) DO UPDATE SET vote = excluded.vote, updated_at = excluded.updated_at`;
// The vote's log row, run just BEFORE VOTE_SQL in the same batch, with the same guard: one row per cast or change, none
// for a vote that repeats the one already standing. Binds: proposal_id, player_id, vote, at, game_id, then
// dayOpenBinds, then proposal_id, player_id, then proposal_id, player_id, vote.
export const VOTE_EVENT_SQL = `INSERT INTO vote_events (game_id, proposal_id, player_id, day, vote, at)
  SELECT g.id, ?, ?, g.day, ?, ? FROM games g WHERE ${GUARD}
    AND NOT EXISTS (SELECT 1 FROM votes v WHERE v.proposal_id = ? AND v.player_id = ? AND v.vote = ?)`;
