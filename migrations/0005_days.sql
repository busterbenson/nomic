-- Days and the midnight lock (rules 107.1, 202.1-202.4, 203.1).
-- Additive: no column is dropped and no existing row changes meaning. games.last_move and the turns table stay
-- (no code reads last_move any more; turns is the legacy prompt log until proposals arrive).
--
-- What it does to existing rows:
--   games    every game gets day 0, phase 'open', rules_day 0 and no moderator token. Day 0 means "no day yet": a game in
--            setup stays in setup (Rickshaw), and a game already 'playing' gets day 1 on the first midnight tick or the
--            first request after the deploy (the Worker computes day bounds in the game's time zone; SQL cannot).
--   events   existing rows keep their text; the new day / phase / template / args / player_id columns are NULL
--            (a line written before days existed belongs to no day).
--   turns    the legacy prompt log. From now on `round` holds the DAY a prompt was made on (one a day), so the rows
--            written under the turn model move out of the way: their round becomes negative (round 3 -> -3, still
--            readable as "old round 3"). Otherwise a player's old round-1 prompt would count as their day-1 prompt.
--            Nothing else in them changes.
--   days, day_turns   new and empty.

-- games: which day the game is on (0 = not started), whether the lock is on, and the last day whose rules are live.
ALTER TABLE games ADD COLUMN day INTEGER NOT NULL DEFAULT 0 CHECK (day >= 0);
ALTER TABLE games ADD COLUMN phase TEXT NOT NULL DEFAULT 'open' CHECK (phase IN ('open', 'locked'));
ALTER TABLE games ADD COLUMN rules_day INTEGER NOT NULL DEFAULT 0 CHECK (rules_day >= 0);
-- The moderator's bearer token for this game, as a SHA-256 hex hash (used from the moderator loop on; NULL until then).
ALTER TABLE games ADD COLUMN moderator_token_hash TEXT;

-- One row per day of a game. starts_at / ends_at are UTC ISO instants of the local midnights in the game's time zone
-- (a DST day is 23 or 25 hours). status: open (play) -> locked (from midnight) -> processing / deploying (the
-- moderator, later) -> done, or timed_out (the 2 am deadline, later). last_error: why the last processing attempt
-- failed; the lock stays on until a later attempt succeeds.
CREATE TABLE days (
  game_id TEXT NOT NULL REFERENCES games(id),
  n INTEGER NOT NULL CHECK (n >= 1),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL CHECK (ends_at > starts_at),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'locked', 'processing', 'deploying', 'done', 'timed_out')),
  electorate INTEGER,
  locked_at TEXT,
  deadline_at TEXT,
  commit_sha TEXT,
  tag TEXT,
  processed_at TEXT,
  last_error TEXT,
  PRIMARY KEY (game_id, n)
);
CREATE INDEX days_status ON days(status, ends_at);

-- What each player did with their turn on a day: when they moved and when they ended their turn (End turn is final).
-- No row = nothing done yet. This replaces games.last_move and the turn-order guards.
CREATE TABLE day_turns (
  game_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  moved_at TEXT,
  ended_at TEXT,
  PRIMARY KEY (game_id, day, player_id),
  FOREIGN KEY (game_id, player_id) REFERENCES players(game_id, id),
  FOREIGN KEY (game_id, day) REFERENCES days(game_id, n)
);

-- The day log: which day and part of it a line belongs to, and (for lines written from a template) its template and
-- arguments. `text` stays as the rendered line.
ALTER TABLE events ADD COLUMN day INTEGER;
ALTER TABLE events ADD COLUMN phase TEXT CHECK (phase IN ('day', 'night'));
ALTER TABLE events ADD COLUMN template TEXT;
ALTER TABLE events ADD COLUMN args TEXT CHECK (args IS NULL OR json_valid(args));
ALTER TABLE events ADD COLUMN player_id TEXT;

-- Legacy prompts (turn model) out of the day numbers: see the header.
UPDATE turns SET round = -round WHERE round > 0;
