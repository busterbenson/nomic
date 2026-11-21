-- Eras (rule 402): the game is played in Eras. An Era ends the night a player reaches 100 points; that player is the
-- Champion, everyone's points go back to 0, the Era's final scores are kept, and the Champion names the next Era and has
-- one change of their own per Era (402.4).
--
-- eras      one row per Era of a game. The open Era is the one with ended_day NULL. An Era's name is NULL until the
--           Champion names it (once). champion_id and final_scores are written when it ends: the winner, and every
--           player's points as they stood at the end of that night, before the reset ({player id: points}).
-- proposals.champion   1 on the Champion's change (402.4): it is counted by its own rule (it takes effect unless every
--           other player votes against it, and the Champion does not vote on it) and does not use one of the day's
--           proposals (103.2). Added as a column, not a new kind, so the table is not rebuilt: the change is an ordinary
--           amend, repeal, mark... and every check that applies to those still does.
--
-- What it does to existing rows: nothing, except that every game already on day 1 or later gets its open Era 1 (it began
-- on day 1, which is when play began). A game in setup gets its Era 1 when it starts. Every proposal has champion = 0.
-- Applying it twice fails, like every migration here.

CREATE TABLE eras (
  game_id TEXT NOT NULL REFERENCES games(id),
  n INTEGER NOT NULL CHECK (n >= 1),
  name TEXT CHECK (name IS NULL OR length(name) BETWEEN 1 AND 60),
  named_by TEXT,
  started_day INTEGER NOT NULL CHECK (started_day >= 1),
  ended_day INTEGER CHECK (ended_day IS NULL OR ended_day >= started_day),
  champion_id TEXT,
  final_scores TEXT CHECK (final_scores IS NULL OR json_valid(final_scores)),
  PRIMARY KEY (game_id, n),
  CHECK ((ended_day IS NULL) = (final_scores IS NULL) AND (ended_day IS NULL) = (champion_id IS NULL)),
  FOREIGN KEY (game_id, champion_id) REFERENCES players(game_id, id),
  FOREIGN KEY (game_id, named_by) REFERENCES players(game_id, id)
);
-- At most one open Era a game.
CREATE UNIQUE INDEX eras_one_open ON eras(game_id) WHERE ended_day IS NULL;

ALTER TABLE proposals ADD COLUMN champion INTEGER NOT NULL DEFAULT 0 CHECK (champion IN (0, 1));
CREATE INDEX proposals_champion ON proposals(game_id, player_id, day_proposed) WHERE champion = 1;

INSERT INTO eras (game_id, n, started_day) SELECT id, 1, 1 FROM games WHERE day >= 1;
