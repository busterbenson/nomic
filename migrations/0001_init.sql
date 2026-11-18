-- Promptocracy: many games on one site, each with its own repo. Accounts are
-- per game: there is no global users table, so the same email joining two games
-- is two unrelated players. Rules live in each game's own git repo; people,
-- scores, sessions, notifications and the game log live here.
-- Timestamps are ISO-8601 UTC text, so they compare correctly as strings.

CREATE TABLE games (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE CHECK (slug = lower(slug) AND length(slug) BETWEEN 2 AND 40),
  name TEXT NOT NULL,
  -- The game's own public GitHub repo ("owner/name") and where its rules are in it.
  repo TEXT NOT NULL CHECK (repo LIKE '_%/_%'),
  rules_path TEXT NOT NULL DEFAULT 'RULES.md',
  rules_ref TEXT NOT NULL DEFAULT 'main',
  join_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup','playing','over')),
  max_players INTEGER NOT NULL DEFAULT 5,
  winning_score INTEGER NOT NULL DEFAULT 100,
  turn INTEGER NOT NULL DEFAULT 0,
  round INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- A player IS the account, inside one game.
CREATE TABLE players (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  email TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL,
  marker TEXT NOT NULL,
  color TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  turn_order INTEGER NOT NULL,
  is_host INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL,
  UNIQUE (game_id, email),
  UNIQUE (game_id, marker),
  UNIQUE (game_id, turn_order),
  -- target for the composite foreign keys below: a row that points at a player
  -- must be in that player's game, which the database enforces.
  UNIQUE (game_id, id)
);

-- A join is only completed when the emailed link is clicked, so nobody can
-- sign someone else up. Rows are also written for unknown log-in emails (never
-- emailed) so the rate limit cannot be used to find out who has an account.
CREATE TABLE login_tokens (
  token_hash TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  email TEXT NOT NULL COLLATE NOCASE,
  purpose TEXT NOT NULL CHECK (purpose IN ('join','login')),
  display_name TEXT,
  marker TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX login_tokens_game_email ON login_tokens(game_id, email, created_at);
CREATE INDEX login_tokens_email ON login_tokens(email, created_at);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (game_id, player_id) REFERENCES players(game_id, id)
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  created_at TEXT NOT NULL,
  read_at TEXT,
  emailed_at TEXT,
  FOREIGN KEY (game_id, player_id) REFERENCES players(game_id, id)
);
CREATE INDEX notifications_player ON notifications(game_id, player_id, created_at);

-- The public game log shown on the board.
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL REFERENCES games(id),
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX events_game ON events(game_id, id);

-- A turn is one prompt from the player whose turn it is. Today the site only
-- RECORDS turns ('submitted'); the referee and the vote (not built yet) will
-- move them through drafted -> voting -> passed/failed.
CREATE TABLE turns (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  round INTEGER NOT NULL,
  turn_index INTEGER NOT NULL,
  prompt TEXT NOT NULL CHECK (length(prompt) BETWEEN 1 AND 2000),
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted','drafted','voting','passed','failed','withdrawn')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (game_id, player_id) REFERENCES players(game_id, id)
);
-- At most one live turn per player per round, enforced by the database so two
-- simultaneous submits cannot both land.
CREATE UNIQUE INDEX turns_one_per_round ON turns(game_id, player_id, round) WHERE status != 'withdrawn';
CREATE INDEX turns_round ON turns(game_id, round);

-- DEV_MODE only: messages that would have been emailed.
CREATE TABLE outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
