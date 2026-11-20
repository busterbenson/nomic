-- Votes (rules 104.1-104.5), the electorate fixed at the start of each day (rule 104.2), the count at midnight, and the
-- 2 am deadline (rules 107.6, 107.7).
-- Additive: three new tables (electors, votes, vote_events) and three new proposals columns. No column is dropped.
--
-- What it does to existing rows:
--   days       every existing day gets its electorate written out as rows in `electors`: every player of its game (a
--              player can only join while a game is in setup, before day 1, so every player was there when each day
--              began). A day whose `electorate` count is NULL gets it from those rows; a day that has one keeps it.
--   proposals  the three new columns (not_applied_reason, budget_minutes, budget_effort) are NULL. A proposal already on
--              a ballot (status on_ballot) gets its `electorate` (its ballot day's) and the votes it `needed` (from the
--              mark stored at confirm, rule 105.4) if they are still NULL. No status changes.
--   everything else (games, players, day_turns, events, notifications) is untouched; votes and vote_events start empty.

-- Who may vote on a day, and who counts for what a vote needs (rule 104.2): the players when the day starts. Written in
-- the same statement batch that opens the day, so a player who joins during the day votes from the next one.
-- days.electorate stays the count of these rows.
CREATE TABLE electors (
  game_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  PRIMARY KEY (game_id, day, player_id),
  FOREIGN KEY (game_id, player_id) REFERENCES players(game_id, id),
  FOREIGN KEY (game_id, day) REFERENCES days(game_id, n)
);

-- A player's vote on a ballot item (rule 104.3): one row per player and proposal, changed in place until midnight or
-- End turn. Hidden until the proposal is counted (rule 104.4): no route returns another player's value before then.
-- The foreign key to electors means only that day's electorate can vote, whatever a route checks.
CREATE TABLE votes (
  game_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  player_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  vote TEXT NOT NULL CHECK (vote IN ('yes', 'no')),
  cast_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (proposal_id, player_id),
  FOREIGN KEY (game_id, day, player_id) REFERENCES electors(game_id, day, player_id)
);
CREATE INDEX votes_day ON votes(game_id, day, player_id);

-- Every cast and change, timestamped, for the day log later. As hidden as the votes themselves.
CREATE TABLE vote_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  player_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  vote TEXT NOT NULL CHECK (vote IN ('yes', 'no')),
  at TEXT NOT NULL,
  FOREIGN KEY (game_id, player_id) REFERENCES players(game_id, id)
);
CREATE INDEX vote_events_proposal ON vote_events(proposal_id, at);

-- Why a passed proposal was not applied (rule 107.7), as its proposer is told.
ALTER TABLE proposals ADD COLUMN not_applied_reason TEXT;
-- The budget for applying a passed proposal (rule 107.5), fixed when it passes: minutes and effort. Written by the count
-- for the moderator to read; nothing enforces it yet.
ALTER TABLE proposals ADD COLUMN budget_minutes INTEGER CHECK (budget_minutes IS NULL OR budget_minutes >= 1);
ALTER TABLE proposals ADD COLUMN budget_effort TEXT;

-- Backfill: each existing day's electorate (see the header).
INSERT OR IGNORE INTO electors (game_id, day, player_id) SELECT d.game_id, d.n, p.id FROM days d JOIN players p ON p.game_id = d.game_id;
UPDATE days SET electorate = (SELECT COUNT(*) FROM electors e WHERE e.game_id = days.game_id AND e.day = days.n) WHERE electorate IS NULL;
UPDATE proposals SET
    electorate = (SELECT d.electorate FROM days d WHERE d.game_id = proposals.game_id AND d.n = proposals.day_ballot),
    needed = (SELECT CASE WHEN proposals.mark = 'unanimous' THEN d.electorate ELSE d.electorate / 2 + 1 END FROM days d WHERE d.game_id = proposals.game_id AND d.n = proposals.day_ballot)
  WHERE status = 'on_ballot' AND needed IS NULL AND EXISTS (SELECT 1 FROM days d WHERE d.game_id = proposals.game_id AND d.n = proposals.day_ballot);
