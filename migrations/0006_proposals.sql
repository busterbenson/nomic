-- Proposals (rules 103.1-103.4, 105.4): a player's plain words, the moderator's exact draft, the confirm that makes it
-- the player's one proposal of the day, its P-number, and the ballot it goes on.
-- Additive: two new tables (proposals, draft_attempts) and their indexes. No existing row changes.
--
-- What it does to existing rows: nothing. games, players, days, day_turns and events are untouched. `turns` (the legacy
-- prompt log) keeps every row, and from this change on nothing writes to it: a prompt written before proposals existed
-- has no target rule and no draft, so it is not turned into a proposal.
--
-- status: draft (drafting is free: any number a day, never on a ballot) -> confirmed (the day's one proposal, numbered)
--         -> withdrawn (by its proposer, until midnight or End turn) | on_ballot (from the next day) -> passed / failed
--         -> enacted / not_applied (the count and the night, later steps).
-- conflicts: the other rules the moderator named when drafting (rule 108.3), as a JSON list of numbers.
-- mark: the votes it needs, fixed when it is confirmed from the marks in effect then (rule 105.4). NULL for a draft.
-- yes / no / absent / needed / electorate / why / decided_at: written by the count (PR 4); NULL until then and never
-- shown before the day is done.
CREATE TABLE proposals (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  number INTEGER CHECK (number IS NULL OR number >= 1),
  player_id TEXT NOT NULL,
  day_proposed INTEGER NOT NULL CHECK (day_proposed >= 1),
  day_ballot INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('amend', 'addclause', 'add', 'repeal', 'move', 'mark')),
  scope TEXT NOT NULL CHECK (scope IN ('rule', 'clause', 'block')),
  target TEXT NOT NULL,
  new_num TEXT,
  to_block TEXT,
  words TEXT NOT NULL DEFAULT '',
  title TEXT,
  draft_head TEXT NOT NULL,
  before_text TEXT NOT NULL DEFAULT '',
  after_text TEXT NOT NULL DEFAULT '',
  conflicts TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(conflicts)),
  -- settings a reword sets (rule 110.1: a fixed part's settings can still be changed), as {key: value}
  settings TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings)),
  drafted_by TEXT NOT NULL CHECK (drafted_by IN ('code', 'model')),
  base_sha TEXT NOT NULL,
  mark TEXT CHECK (mark IN ('majority', 'unanimous')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'withdrawn', 'on_ballot', 'passed', 'failed', 'enacted', 'not_applied')),
  yes INTEGER,
  no INTEGER,
  absent INTEGER,
  needed INTEGER,
  electorate INTEGER,
  why TEXT,
  rev INTEGER,
  commit_sha TEXT,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  withdrawn_at TEXT,
  decided_at TEXT,
  -- a confirmed proposal has its number, its mark and its ballot day; a draft has none of them
  CHECK ((status = 'draft') = (number IS NULL)),
  CHECK (status = 'draft' OR (mark IS NOT NULL AND day_ballot = day_proposed + 1 AND confirmed_at IS NOT NULL)),
  FOREIGN KEY (game_id, player_id) REFERENCES players(game_id, id)
);
-- P-numbers are per game, in confirm order, and never reused (a withdrawn proposal keeps its number).
CREATE UNIQUE INDEX proposals_number ON proposals(game_id, number);
-- One proposal a day (rule 103.2): at most one row per player and day that is neither a draft nor withdrawn. This is
-- what makes two confirms racing each other land only once.
CREATE UNIQUE INDEX proposals_one_a_day ON proposals(game_id, player_id, day_proposed) WHERE status NOT IN ('draft', 'withdrawn');
CREATE INDEX proposals_ballot ON proposals(game_id, day_ballot, status);
CREATE INDEX proposals_target ON proposals(game_id, target);

-- Drafting is free but may call a model: how many drafts each player has asked for on a day (every attempt, kept or
-- not), so a cap holds even when drafts are refused or fail. New and empty.
CREATE TABLE draft_attempts (
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  n INTEGER NOT NULL CHECK (n >= 1),
  PRIMARY KEY (game_id, player_id, day),
  FOREIGN KEY (game_id, player_id) REFERENCES players(game_id, id)
);
