-- Action proposals (rule 103.5): a proposal of a new kind, 'action', that does one thing from the game's catalog of action types
-- (block 900) instead of changing the rules. The row keeps what it will do in `action`, a JSON object fixed when it is drafted:
--   {type, name, rule, touches: [rule numbers], params: {key: value} (a player's id for a player param), shown: [[label, text], ...]}
-- Its target is the rule that defines the type (901 for "grant"), so the rule's own mark and the marks of `touches` are what the
-- vote needs (rule 103.7). A kind of its own, and not an amend that carries parameters: every kind the moderator knows is a change
-- it applies to the rules, and an action posing as one would be applied as that change (the same reason 0010 gave for commissions).
--
-- Why a rebuild: the kind list is a CHECK, which SQLite cannot change in place, so `proposals` is rebuilt with the list widened
-- and one column added. Every other column, CHECK, index and row is carried over unchanged (including ticket_id and ticket_snapshot
-- from 0010 and champion from 0011).
--
-- How: votes, vote_events and tickets point at proposals(id), so the table is rebuilt the way a deferred-foreign-keys rebuild
-- goes: copy the rows to a plain table, drop the old one, create the new one under the same name, put the rows back. The children
-- are not touched; the deferred check at commit passes because every proposal id is back under the same name.
--
-- What it does to existing rows: nothing. Every proposal is copied as it is (same ids, numbers, statuses) with action NULL.
PRAGMA defer_foreign_keys = true;

CREATE TABLE proposals_save AS SELECT * FROM proposals;
DROP TABLE proposals;

CREATE TABLE proposals (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  number INTEGER CHECK (number IS NULL OR number >= 1),
  player_id TEXT NOT NULL,
  day_proposed INTEGER NOT NULL CHECK (day_proposed >= 1),
  day_ballot INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('amend', 'addclause', 'add', 'repeal', 'move', 'mark', 'commission', 'action')),
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
  settings TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings)),
  drafted_by TEXT NOT NULL CHECK (drafted_by IN ('code', 'model')),
  base_sha TEXT NOT NULL,
  mark TEXT CHECK (mark IN ('majority', 'unanimous')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'withdrawn', 'on_ballot', 'passed', 'failed', 'enacted', 'not_applied', 'approved')),
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
  not_applied_reason TEXT,
  budget_minutes INTEGER CHECK (budget_minutes IS NULL OR budget_minutes >= 1),
  budget_effort TEXT,
  apply_seq INTEGER CHECK (apply_seq IS NULL OR apply_seq >= 1),
  ticket_id TEXT REFERENCES tickets(id),
  ticket_snapshot TEXT CHECK (ticket_snapshot IS NULL OR json_valid(ticket_snapshot)),
  champion INTEGER NOT NULL DEFAULT 0 CHECK (champion IN (0, 1)),
  action TEXT CHECK (action IS NULL OR json_valid(action)),
  CHECK ((status = 'draft') = (number IS NULL)),
  CHECK (status = 'draft' OR (mark IS NOT NULL AND day_ballot = day_proposed + 1 AND confirmed_at IS NOT NULL)),
  -- an action carries what it does, and nothing else does
  CHECK ((kind = 'action') = (action IS NOT NULL)),
  FOREIGN KEY (game_id, player_id) REFERENCES players(game_id, id)
);

INSERT INTO proposals (id, game_id, number, player_id, day_proposed, day_ballot, kind, scope, target, new_num, to_block, words, title,
    draft_head, before_text, after_text, conflicts, settings, drafted_by, base_sha, mark, status, yes, no, absent, needed, electorate, why,
    rev, commit_sha, created_at, confirmed_at, withdrawn_at, decided_at, not_applied_reason, budget_minutes, budget_effort, apply_seq,
    ticket_id, ticket_snapshot, champion)
  SELECT id, game_id, number, player_id, day_proposed, day_ballot, kind, scope, target, new_num, to_block, words, title,
    draft_head, before_text, after_text, conflicts, settings, drafted_by, base_sha, mark, status, yes, no, absent, needed, electorate, why,
    rev, commit_sha, created_at, confirmed_at, withdrawn_at, decided_at, not_applied_reason, budget_minutes, budget_effort, apply_seq,
    ticket_id, ticket_snapshot, champion
  FROM proposals_save;
DROP TABLE proposals_save;

-- The indexes the drop takes with the old table, as 0010 and 0011 left them.
CREATE UNIQUE INDEX proposals_number ON proposals(game_id, number);
CREATE INDEX proposals_day_count ON proposals(game_id, player_id, day_proposed) WHERE status NOT IN ('draft', 'withdrawn');
CREATE INDEX proposals_ballot ON proposals(game_id, day_ballot, status);
CREATE INDEX proposals_target ON proposals(game_id, target);
CREATE INDEX proposals_champion ON proposals(game_id, player_id, day_proposed) WHERE champion = 1;
