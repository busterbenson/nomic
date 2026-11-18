-- The board: an island on an endless square grid, tiles with open-ended properties, a seed and an
-- island size per game, and
-- player pieces chosen by COLOR instead of an emoji marker.
-- Applied to existing games without losing anything: players are rebuilt (SQLite
-- cannot drop a column that sits in a UNIQUE constraint), and every existing player
-- is given the next free palette colour in turn order.

-- Rebuilding `players` while sessions, notifications and turns point at it: dropping a
-- parent table that still has children fails the foreign-key check at commit (tried:
-- PRAGMA defer_foreign_keys does not rescue it). So the children are rebuilt too, in the
-- order SQLite documents: new parent and new children first (children pointing at the
-- new parent), drop the old children, drop the old parent, rename the new parent into
-- place (SQLite rewrites the new children's references to follow it), rename the children.

-- The game's board settings, as JSON: only the ones this game changes; the rest are the defaults in
-- src/lib/settings.js (island size, erosion, terrain kinds, land bounds, allowed moves, moves per turn,
-- harvest). Validated by the code that reads them. A passed rule changes a value here, not code.
ALTER TABLE games ADD COLUMN settings TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings) AND json_type(settings) = 'object');
-- Moves made so far in the current turn (a turn may hold several: setting turn.actions_per_turn).
ALTER TABLE games ADD COLUMN moves INTEGER NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN seed INTEGER NOT NULL DEFAULT 0;
UPDATE games SET seed = abs(random() % 2147483647);

CREATE TABLE players_new (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  email TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL,
  -- The claimed piece colour: a key of the palette in src/lib/util.ts
  -- (vermilion, saffron, moss, teal, cobalt, violet, rose, graphite). One per player per game.
  color TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  turn_order INTEGER NOT NULL,
  is_host INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL,
  UNIQUE (game_id, email),
  UNIQUE (game_id, color),
  UNIQUE (game_id, turn_order),
  UNIQUE (game_id, id)
);
INSERT INTO players_new (id, game_id, email, display_name, color, score, turn_order, is_host, joined_at)
  SELECT id, game_id, email, display_name,
         CASE turn_order % 8 WHEN 0 THEN 'vermilion' WHEN 1 THEN 'saffron' WHEN 2 THEN 'moss' WHEN 3 THEN 'teal'
                             WHEN 4 THEN 'cobalt' WHEN 5 THEN 'violet' WHEN 6 THEN 'rose' ELSE 'graphite' END,
         score, turn_order, is_host, joined_at
  FROM players;
CREATE TABLE sessions_new (
  id_hash TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (game_id, player_id) REFERENCES players_new(game_id, id)
);
INSERT INTO sessions_new SELECT id_hash, game_id, player_id, created_at, expires_at FROM sessions;

CREATE TABLE notifications_new (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  created_at TEXT NOT NULL,
  read_at TEXT,
  emailed_at TEXT,
  FOREIGN KEY (game_id, player_id) REFERENCES players_new(game_id, id)
);
INSERT INTO notifications_new SELECT id, game_id, player_id, kind, body, link, created_at, read_at, emailed_at FROM notifications;

CREATE TABLE turns_new (
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
  FOREIGN KEY (game_id, player_id) REFERENCES players_new(game_id, id)
);
INSERT INTO turns_new SELECT id, game_id, player_id, round, turn_index, prompt, status, created_at, updated_at FROM turns;

DROP TABLE sessions;
DROP TABLE notifications;
DROP TABLE turns;
DROP TABLE players;
ALTER TABLE players_new RENAME TO players;
ALTER TABLE sessions_new RENAME TO sessions;
ALTER TABLE notifications_new RENAME TO notifications;
ALTER TABLE turns_new RENAME TO turns;
CREATE INDEX notifications_player ON notifications(game_id, player_id, created_at);
-- At most one live turn per player per round, enforced by the database (as in 0001).
CREATE UNIQUE INDEX turns_one_per_round ON turns(game_id, player_id, round) WHERE status != 'withdrawn';
CREATE INDEX turns_round ON turns(game_id, round);

-- Join links issued before this migration name an emoji, not a colour: they are void.
DELETE FROM login_tokens WHERE purpose = 'join' AND used_at IS NULL;
ALTER TABLE login_tokens RENAME COLUMN marker TO color;

-- One row per LAND tile, on an infinite grid of signed integer coordinates (x east, y north);
-- there is no row for open sea. Where land may exist, and how tiles are named (C4 = x 2, y 3), is
-- geometry (src/lib/geometry.js), not schema, so a rule can change it. `props` is a JSON object that rules (and later the referee) can
-- put anything in: {"fertility": 2, "haunted": true}. Terrain means nothing by
-- itself until a rule gives it meaning.
CREATE TABLE tiles (
  game_id TEXT NOT NULL REFERENCES games(id),
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  -- Any lowercase word: the kinds a game has come from its settings (board.terrain), so a rule can add one.
  terrain TEXT NOT NULL DEFAULT 'meadow' CHECK (terrain GLOB '[a-z]*' AND length(terrain) <= 20),
  name TEXT CHECK (name IS NULL OR length(name) BETWEEN 1 AND 40),
  description TEXT CHECK (description IS NULL OR length(description) BETWEEN 1 AND 280),
  owner_player_id TEXT,
  claimed_at TEXT,
  props TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(props) AND json_type(props) = 'object' AND length(CAST(props AS BLOB)) <= 4096),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (game_id, x, y),
  FOREIGN KEY (game_id, owner_player_id) REFERENCES players(game_id, id)
);
CREATE INDEX tiles_owner ON tiles(game_id, owner_player_id);
