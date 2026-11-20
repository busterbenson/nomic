-- Rule 103.2 lets a player confirm up to `proposals.per_day` proposals a day (default 3, a setting), where it allowed one.
-- The unique index proposals_one_a_day (at most one non-draft, non-withdrawn row per player and day) is what held the
-- limit at one, so it goes. The limit is now held by the confirm statement itself (CONFIRM_SQL in src/lib/proposals.js):
-- one UPDATE that counts the player's confirmed proposals of the day and confirms only while the count is under the limit.
-- D1 runs one statement at a time, so two confirms arriving together cannot both pass the count.
--
-- What it does to existing rows: nothing. Only an index changes. A plain (non-unique) index of the same shape replaces it,
-- for that count. Safe on a database where a player already has one confirmed proposal a day: that is within any limit.
-- To undo (only while no player has two confirmed proposals on one day): DROP INDEX proposals_day_count; then recreate
-- proposals_one_a_day as in 0006.
DROP INDEX proposals_one_a_day;
CREATE INDEX proposals_day_count ON proposals(game_id, player_id, day_proposed) WHERE status NOT IN ('draft', 'withdrawn');
