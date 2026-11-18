-- Nomic accounts, join codes, notifications. Rules and site code stay in git;
-- people, scores, sessions, notifications and the game log live here.
-- Timestamps are ISO-8601 UTC text, so they compare correctly as strings.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE games (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  join_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup','playing','over')),
  max_players INTEGER NOT NULL DEFAULT 5,
  winning_score INTEGER NOT NULL DEFAULT 100,
  turn INTEGER NOT NULL DEFAULT 0,
  round INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE players (
  game_id TEXT NOT NULL REFERENCES games(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  marker TEXT NOT NULL,
  color TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  turn_order INTEGER NOT NULL,
  is_host INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (game_id, user_id),
  UNIQUE (game_id, marker),
  UNIQUE (game_id, turn_order)
);

-- A join is only completed when the emailed link is clicked, so nobody can
-- sign someone else up. Rows are also written for unknown log-in emails (never
-- emailed) so the rate limit cannot be used to find out who has an account.
CREATE TABLE login_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  purpose TEXT NOT NULL CHECK (purpose IN ('join','login')),
  game_id TEXT REFERENCES games(id),
  display_name TEXT,
  marker TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX login_tokens_email ON login_tokens(email, created_at);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  game_id TEXT NOT NULL REFERENCES games(id),
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  created_at TEXT NOT NULL,
  read_at TEXT,
  emailed_at TEXT
);
CREATE INDEX notifications_user ON notifications(user_id, created_at);

-- The public game log shown on the board.
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL REFERENCES games(id),
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- DEV_MODE only: messages that would have been emailed.
CREATE TABLE outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
