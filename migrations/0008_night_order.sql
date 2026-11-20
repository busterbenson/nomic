-- The night's order (rule 107.2): the order the moderator really applied the passed proposals in, and a per-night
-- sequence on every event the night writes, in execution order.
-- Additive: two new columns and one index. No column is dropped, no row changes.
--
-- What it does to existing rows:
--   proposals  apply_seq is NULL. The moderator's claim writes it (1..n, the order the proposals were applied and
--              committed in); the enactment reads it, so a night that changes the order rule (107) itself is enacted in
--              the order it was applied, not the order of the rules that went live. A proposal claimed before this
--              column existed has NULL and is enacted in P-number order, as before.
--   events     night_seq is NULL on every existing row (and on every event written by day, not by night). Each event the
--              night writes (points, won, night_failed) gets 1 + the highest night_seq of its game and day, so the night
--              reads back in the order it ran, whichever batch wrote it.
--   everything else is untouched.
ALTER TABLE proposals ADD COLUMN apply_seq INTEGER CHECK (apply_seq IS NULL OR apply_seq >= 1);
ALTER TABLE events ADD COLUMN night_seq INTEGER CHECK (night_seq IS NULL OR night_seq >= 1);
-- One event per place in a night's sequence (and the index the "next seq" lookup uses).
CREATE UNIQUE INDEX events_night_seq ON events(game_id, day, night_seq) WHERE night_seq IS NOT NULL;
