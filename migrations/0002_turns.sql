-- A turn is one prompt from the player whose turn it is. Today the site only
-- RECORDS turns ('submitted'); the referee and the vote (not built yet) will
-- move them through drafted -> voting -> passed/failed.
CREATE TABLE turns (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  round INTEGER NOT NULL,
  turn_index INTEGER NOT NULL,
  prompt TEXT NOT NULL CHECK (length(prompt) BETWEEN 1 AND 2000),
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted','drafted','voting','passed','failed','withdrawn')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- At most one live turn per player per round, enforced by the database so two
-- simultaneous submits cannot both land.
CREATE UNIQUE INDEX turns_one_per_round ON turns(game_id, user_id, round) WHERE status != 'withdrawn';
CREATE INDEX turns_round ON turns(game_id, round);
