-- The board: a blank-slate world on an infinite grid. Tiles have no properties: a tile either exists
-- in `tiles` (it is CHARTED) or it does not. Player pieces carry a position (x, y, z) and are chosen by
-- COLOR instead of an emoji marker.
-- Applied to existing games without losing anything: players are rebuilt (SQLite
-- cannot drop a column that sits in a UNIQUE constraint), every existing player
-- is given the next free palette colour in turn order, every existing game gets its starting island
-- charted, and every existing player is placed on a distinct tile of it.

-- Rebuilding `players` while sessions, notifications and turns point at it: dropping a
-- parent table that still has children fails the foreign-key check at commit (tried:
-- PRAGMA defer_foreign_keys does not rescue it). So the children are rebuilt too, in the
-- order SQLite documents: new parent and new children first (children pointing at the
-- new parent), drop the old children, drop the old parent, rename the new parent into
-- place (SQLite rewrites the new children's references to follow it), rename the children.

-- The game's board settings, as JSON: only the ones this game changes; the rest are the defaults in
-- src/lib/settings.js (island size, chart radius, move distance). Validated by the code that reads them.
ALTER TABLE games ADD COLUMN settings TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings) AND json_type(settings) = 'object');
-- Which turn the last board move was made in, as 'round:turn' (empty before any). A player has moved this turn
-- exactly when it equals the current 'round:turn', so advancing the turn needs no reset: the key just stops matching.
-- The seat limit moves from the `max_players` column into the settings (setting max_players, 1 to 8): the column
-- is no longer read. Existing games keep their cap.
UPDATE games SET settings = json_set(settings, '$.max_players', MIN(MAX(max_players, 1), 8));
ALTER TABLE games ADD COLUMN last_move TEXT NOT NULL DEFAULT '';

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
  -- The piece's position: plain consecutive integers (labels skip zero, these do not). z 0 is the ground.
  x INTEGER NOT NULL, y INTEGER NOT NULL, z INTEGER NOT NULL DEFAULT 0,
  UNIQUE (game_id, email),
  UNIQUE (game_id, color),
  UNIQUE (game_id, turn_order),
  UNIQUE (game_id, id)
);
INSERT INTO players_new (id, game_id, email, display_name, color, score, turn_order, is_host, joined_at, x, y, z)
  SELECT id, game_id, email, display_name,
         CASE turn_order % 8 WHEN 0 THEN 'vermilion' WHEN 1 THEN 'saffron' WHEN 2 THEN 'moss' WHEN 3 THEN 'teal'
                             WHEN 4 THEN 'cobalt' WHEN 5 THEN 'violet' WHEN 6 THEN 'rose' ELSE 'graphite' END,
         score, turn_order, is_host, joined_at,
         -- a distinct tile of the 8 x 8 island (x, y in -4..3) per seat: 3 and 5 are coprime to 8
         (turn_order * 3) % 8 - 4, (turn_order * 5) % 8 - 4, 0
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

-- One row per CHARTED tile, on an infinite grid of integer coordinates (x east, y north, z up; z 0 is the
-- ground). A tile has no properties: charted or uncharted is all there is, and a row is created blank the
-- first time the tile is charted (chartTile in src/lib/board.ts). How tiles are NAMED ("3N 2E") is
-- src/lib/geometry.js, not schema.
CREATE TABLE tiles (
  game_id TEXT NOT NULL REFERENCES games(id),
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  z INTEGER NOT NULL DEFAULT 0,
  charted_at TEXT NOT NULL,
  PRIMARY KEY (game_id, x, y, z)
);
-- Every existing game starts with its 8 x 8 island charted: columns 4W..4E (x -4..3), rows 4N..4S (y -4..3).
WITH RECURSIVE n(i) AS (SELECT -4 UNION ALL SELECT i + 1 FROM n WHERE i < 3)
INSERT INTO tiles (game_id, x, y, z, charted_at)
  SELECT g.id, a.i, b.i, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM games g, n a, n b;
