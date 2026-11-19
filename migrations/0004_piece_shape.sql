-- A player now chooses a SHAPE (one of the traced pieces, or the plain pawn) as well as a color.
-- Additive: every existing seat keeps working. A seat made before this migration is a pawn, as it was drawn
-- before, and its color key is unchanged (colors from the first palette still draw).
ALTER TABLE players ADD COLUMN shape TEXT NOT NULL DEFAULT 'pawn';
-- Which way the piece faces on the board: 1 = mirrored, set by its last move to the right; 0 = as drawn.
ALTER TABLE players ADD COLUMN mirrored INTEGER NOT NULL DEFAULT 0 CHECK (mirrored IN (0, 1));
-- The shape a join link carries from the join form to the moment the link is opened.
ALTER TABLE login_tokens ADD COLUMN shape TEXT;
