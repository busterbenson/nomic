-- Gremlin in ticket threads, and what he passes to Chalant (rules 106.4, 804.1).
-- Numbered 0014 while the Eras (0011), actions (0012) and chat (0013) PRs are open: it renumbers to the next free number at merge.
--
-- escalations: one row per time Gremlin (and, from step 2b, Starling) passed something to Chalant. ticket_id for the workshop (a thread
-- reply), chat_message_id for a private chat turn (the player's message that was escalated).
--   category  a fixed list: it is the ONLY thing a notification shows (with the ticket's number and a link).
--   reason    the agent's words, player-influenced: it is read by the answering job as fenced data and never put in a notification.
--   local_date  the game's day the escalation was made on (the cap of 5 a player a day counts by it).
--   delivered_at  when the Mac mini's job sent its metadata-only notification; answered_at  when Chalant's answer was posted.
-- The "Escalated" chip on a ticket is derived from an open row here; it is not a ticket state (the state CHECK is unchanged).
-- Reversible: drop the table; reply_to is a nullable column nothing older reads.
CREATE TABLE escalations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL REFERENCES games(id),
  agent TEXT NOT NULL CHECK (agent IN ('gremlin', 'starling')),
  player_id TEXT NOT NULL,
  ticket_id TEXT REFERENCES tickets(id),
  chat_message_id INTEGER REFERENCES chat_messages(id),
  category TEXT NOT NULL CHECK (category IN ('conflict', 'sizing', 'loophole', 'ruling', 'other')),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 300),
  local_date TEXT NOT NULL,
  created_at TEXT NOT NULL, delivered_at TEXT, answered_at TEXT,
  CHECK ((ticket_id IS NULL) != (chat_message_id IS NULL)),
  FOREIGN KEY (game_id, player_id) REFERENCES players(game_id, id)
);
CREATE INDEX escalations_open ON escalations(game_id, answered_at);
-- the Escalated chip asks "is one open on this ticket?" for every ticket in a list
CREATE INDEX escalations_ticket ON escalations(ticket_id) WHERE answered_at IS NULL;
CREATE INDEX escalations_day ON escalations(game_id, player_id, local_date);
-- One open escalation per player per ticket (or per chat): a player can't page Chalant on every message.
CREATE UNIQUE INDEX escalations_one_open ON escalations(game_id, player_id, COALESCE(ticket_id, 'chat:' || agent)) WHERE answered_at IS NULL;
-- Which post a Gremlin or Chalant post answers, so the 20-a-day count is per posting player and the thread can show the pairing.
ALTER TABLE ticket_posts ADD COLUMN reply_to INTEGER REFERENCES ticket_posts(id);
