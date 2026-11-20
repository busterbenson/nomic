-- The Workshop, step 1 (rules 801-804): commissions as tickets, their tasks, log and discussion.
-- A commission is a proposal of a new kind, 'commission', that points at its ticket (tickets.proposal_id), so confirming
-- it, the one-a-day limit, the ballot, the votes and the count are all the proposals' own. A passed commission has a new
-- status, 'approved': it passed, and there is nothing for the moderator to apply (the ticket's build is a later step).
--
-- Why a new kind and not a plain proposal that points at a ticket: every proposal row needs a kind, and every kind the
-- moderator knows (amend, add, repeal...) is a change it applies to the rules. A commission posing as one of them would be
-- applied as that change. A kind of its own is something the moderator can leave out by name.
--
-- Why a rebuild: the kind and status lists are CHECK constraints, and SQLite cannot change a CHECK in place. So
-- `proposals` is rebuilt with the two lists widened, and so are its two children, `votes` and `vote_events` (dropping a
-- parent that still has children fails the foreign-key check at commit, so the order is the one 0002 used: new parent and
-- new children first, drop the old children, drop the old parent, rename the new parent into place, rename the children).
-- Every column, CHECK, index and row is carried over unchanged; only the two lists grow.
--
-- Written after 0009 (proposals per day), which replaced the unique index proposals_one_a_day with the plain index
-- proposals_day_count: the rebuild recreates the indexes as they stand after 0009.
--
-- What it does to existing rows: nothing. Every proposal, vote and vote event is copied as it is (same ids, numbers,
-- statuses), and the five new tables start empty.

CREATE TABLE proposals_new (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  number INTEGER CHECK (number IS NULL OR number >= 1),
  player_id TEXT NOT NULL,
  day_proposed INTEGER NOT NULL CHECK (day_proposed >= 1),
  day_ballot INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('amend', 'addclause', 'add', 'repeal', 'move', 'mark', 'commission')),
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
  CHECK ((status = 'draft') = (number IS NULL)),
  CHECK (status = 'draft' OR (mark IS NOT NULL AND day_ballot = day_proposed + 1 AND confirmed_at IS NOT NULL)),
  FOREIGN KEY (game_id, player_id) REFERENCES players(game_id, id)
);
CREATE TABLE votes_new (
  game_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL REFERENCES proposals_new(id),
  player_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  vote TEXT NOT NULL CHECK (vote IN ('yes', 'no')),
  cast_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (proposal_id, player_id),
  FOREIGN KEY (game_id, day, player_id) REFERENCES electors(game_id, day, player_id)
);
CREATE TABLE vote_events_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL REFERENCES proposals_new(id),
  player_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  vote TEXT NOT NULL CHECK (vote IN ('yes', 'no')),
  at TEXT NOT NULL,
  FOREIGN KEY (game_id, player_id) REFERENCES players(game_id, id)
);

INSERT INTO proposals_new (id, game_id, number, player_id, day_proposed, day_ballot, kind, scope, target, new_num, to_block, words, title,
    draft_head, before_text, after_text, conflicts, settings, drafted_by, base_sha, mark, status, yes, no, absent, needed, electorate, why,
    rev, commit_sha, created_at, confirmed_at, withdrawn_at, decided_at, not_applied_reason, budget_minutes, budget_effort, apply_seq)
  SELECT id, game_id, number, player_id, day_proposed, day_ballot, kind, scope, target, new_num, to_block, words, title,
    draft_head, before_text, after_text, conflicts, settings, drafted_by, base_sha, mark, status, yes, no, absent, needed, electorate, why,
    rev, commit_sha, created_at, confirmed_at, withdrawn_at, decided_at, not_applied_reason, budget_minutes, budget_effort, apply_seq
  FROM proposals;
INSERT INTO votes_new (game_id, proposal_id, player_id, day, vote, cast_at, updated_at)
  SELECT game_id, proposal_id, player_id, day, vote, cast_at, updated_at FROM votes;
INSERT INTO vote_events_new (id, game_id, proposal_id, player_id, day, vote, at)
  SELECT id, game_id, proposal_id, player_id, day, vote, at FROM vote_events;

DROP TABLE vote_events;
DROP TABLE votes;
DROP TABLE proposals;
ALTER TABLE proposals_new RENAME TO proposals;
ALTER TABLE votes_new RENAME TO votes;
ALTER TABLE vote_events_new RENAME TO vote_events;

-- The indexes the rebuild drops with the old tables, as 0006 to 0009 left them.
CREATE UNIQUE INDEX proposals_number ON proposals(game_id, number);
CREATE INDEX proposals_day_count ON proposals(game_id, player_id, day_proposed) WHERE status NOT IN ('draft', 'withdrawn');
CREATE INDEX proposals_ballot ON proposals(game_id, day_ballot, status);
CREATE INDEX proposals_target ON proposals(game_id, target);
CREATE INDEX votes_day ON votes(game_id, day, player_id);
CREATE INDEX vote_events_proposal ON vote_events(proposal_id, at);

-- A ticket (rule 801.2): one per commission. number is W1, W2... per game, taken when the draft is opened and never reused.
-- makes: what it will add or change, a JSON list of {"kind": "entry", "name": ...} (a catalog entry) and
-- {"kind": "rule", "num": ...} (a rule number). estimate: nights. price / price_reason: the points the requester pays when it
-- passes (rule 801.4), and why. running_cost: what it costs the site each month, in words, or ''.
-- state: Draft -> Proposed (on the ballot) -> Approved (in the queue, rule 803.1), or Ready first when the requester can't pay the whole
-- price when it passes (rule 801.4: nothing is paid and it has no place in the queue until they can) -> Building -> Done; or Refused, Failed, Shelved.
-- proposal_id: the commission proposal it rides on (NULL while a draft). queue_pos: its place in the queue, set when approved.
-- paid / paid_at: the points taken from the requester when it was approved (always the whole price, never part), and when (NULL until
-- then, and while it is Ready). approved_at is when it joined the queue.
CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  number INTEGER NOT NULL CHECK (number >= 1),
  player_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  brief TEXT NOT NULL DEFAULT '',
  makes TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(makes) AND json_type(makes) = 'array'),
  estimate INTEGER NOT NULL DEFAULT 1 CHECK (estimate >= 1),
  price INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
  price_reason TEXT NOT NULL DEFAULT '',
  running_cost TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'Draft' CHECK (state IN ('Draft', 'Proposed', 'Ready', 'Approved', 'Building', 'Done', 'Refused', 'Failed', 'Shelved')),
  proposal_id TEXT REFERENCES proposals(id),
  queue_pos INTEGER CHECK (queue_pos IS NULL OR queue_pos >= 1),
  paid INTEGER CHECK (paid IS NULL OR paid >= 0),
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  proposed_at TEXT,
  approved_at TEXT,
  decided_at TEXT,
  FOREIGN KEY (game_id, player_id) REFERENCES players(game_id, id)
);
CREATE UNIQUE INDEX tickets_number ON tickets(game_id, number);
CREATE UNIQUE INDEX tickets_proposal ON tickets(proposal_id) WHERE proposal_id IS NOT NULL;
CREATE UNIQUE INDEX tickets_queue ON tickets(game_id, queue_pos) WHERE queue_pos IS NOT NULL;

-- A ticket's checklist, in order (pos 1, 2...). done_day: the game day it was ticked.
CREATE TABLE ticket_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  pos INTEGER NOT NULL CHECK (pos >= 1),
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  done_day INTEGER,
  UNIQUE (ticket_id, pos)
);

-- A ticket's log: dated entries written by the site (and, later, the moderator). kind: proposed, withdrawn, approved,
-- ready, refused, reopened, note. A ticket is made ready, approved or refused once each time it is counted, however many times the count
-- runs (a reopened ticket can be counted again, rule 801.5); the index is the second line of defence behind the state guards.
CREATE TABLE ticket_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  day INTEGER,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX ticket_log_ticket ON ticket_log(ticket_id, id);
CREATE UNIQUE INDEX ticket_log_decided_once ON ticket_log(ticket_id, kind, at) WHERE kind IN ('ready', 'approved', 'refused');

-- A ticket's discussion (rule 804.1). author_kind: a player, Gremlin or Chalant; player_id is the author of a player's post.
CREATE TABLE ticket_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  game_id TEXT NOT NULL,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('player', 'gremlin', 'chalant')),
  player_id TEXT,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  at TEXT NOT NULL,
  CHECK ((author_kind = 'player') = (player_id IS NOT NULL)),
  FOREIGN KEY (game_id, player_id) REFERENCES players(game_id, id)
);
CREATE INDEX ticket_posts_ticket ON ticket_posts(ticket_id, id);
