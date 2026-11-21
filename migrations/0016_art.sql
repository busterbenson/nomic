-- Generated art for catalog entries (rules 701.1, 801.2, 106.7; docs/step2-plan.md PR 4).
-- Numbered 0016: after Eras (0011), the actions (0012), the chat (0013), the threads (0014) and Starling (0015).
--
-- The bytes live only in R2 (bucket promptocracy-art; tmp/<sha256> as made, art/<sha256> once saved). These tables say what each key is and who
-- uses it. The same bytes can be made twice (the same prompt and seed, a stub in a test), and one R2 object then serves several entries.
--
-- art_objects: one row per stored picture. hash is the SHA-256 of the bytes, 64 lowercase hex characters.
-- art_refs: every use of a picture: this ticket's entry (by name, as written in the ticket's `makes`), the prompt it was made from, whether the
--   player saved it to the entry (saved), and whether it is the one the entry shows (is_default). A default must be a saved drawing, and an entry
--   has at most one. The daily sweep deletes an art/ object only when no saved ref outside the swept tickets and no catalog.json names its hash.
-- art_draws: one row per call to the image model, so the card can say "drawing" and "failed" (rule 801.2). At most one pending draw per entry.
-- Reversible: three new tables, no existing table touched (down = drop art_draws, art_refs, art_objects).
CREATE TABLE art_objects (
  hash TEXT PRIMARY KEY CHECK (length(hash) = 64 AND hash NOT GLOB '*[^0-9a-f]*'),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  content_type TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE art_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT NOT NULL REFERENCES art_objects(hash),
  game_id TEXT NOT NULL REFERENCES games(id),
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  entry_name TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  saved INTEGER NOT NULL DEFAULT 0 CHECK (saved IN (0, 1)),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE (hash, ticket_id, entry_name),
  CHECK (is_default = 0 OR saved = 1)
);
CREATE UNIQUE INDEX art_one_default ON art_refs(ticket_id, entry_name) WHERE is_default = 1;
CREATE INDEX art_refs_ticket ON art_refs(ticket_id, entry_name, id);
CREATE INDEX art_refs_hash ON art_refs(hash, saved);
CREATE TABLE art_draws (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL REFERENCES games(id),
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  entry_name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done', 'failed')),
  reason TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE UNIQUE INDEX art_one_pending ON art_draws(ticket_id, entry_name) WHERE state = 'pending';
CREATE INDEX art_draws_ticket ON art_draws(ticket_id, entry_name, id);
