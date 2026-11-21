-- Starling, the Rulebook's chat (rules 103.1, 106.2, 106.4, 106.7). Numbered 0015 while the Eras (0011), actions (0012), chat (0013) and
-- threads (0014) PRs are open: it renumbers to the next free number at merge.
--
-- chat_messages.proposal_id: the draft a line of Starling's shows (the slip under it). Proposals keep their own table; this is only the
-- pointer, so the history can draw the slip and say how it ended. NULL for every other line. Nothing else about chat_messages changes
-- (its agent CHECK already allows 'starling').
ALTER TABLE chat_messages ADD COLUMN proposal_id TEXT REFERENCES proposals(id);
CREATE INDEX chat_proposal ON chat_messages(proposal_id) WHERE proposal_id IS NOT NULL;
-- What an agent passed to Chalant (rule 106.4). Starling writes rows here; DELIVERY (the moderator routes, the notification) is the
-- threads PR's. IF NOT EXISTS: whichever of the two PRs merges second finds the table already there, with the same columns. `category`
-- is what a notification may show; `reason` is the agent's own words, player-influenced, and is never put in a notification.
CREATE TABLE IF NOT EXISTS escalations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL REFERENCES games(id),
  agent TEXT NOT NULL CHECK (agent IN ('gremlin', 'starling')),
  player_id TEXT NOT NULL,
  ticket_id TEXT REFERENCES tickets(id),
  chat_message_id INTEGER REFERENCES chat_messages(id),
  category TEXT NOT NULL CHECK (category IN ('conflict', 'sizing', 'loophole', 'ruling', 'other')),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 300),
  created_at TEXT NOT NULL, delivered_at TEXT, answered_at TEXT
);
CREATE INDEX IF NOT EXISTS escalations_open ON escalations(game_id, answered_at);
-- One open escalation per player per ticket (or per chat): a player can't page Chalant on every message.
CREATE UNIQUE INDEX IF NOT EXISTS escalations_one_open ON escalations(game_id, player_id, COALESCE(ticket_id, 'chat:' || agent)) WHERE answered_at IS NULL;
-- Reversible: drop the index and the column's pointer is simply unread (SQLite drops a column with ALTER TABLE ... DROP COLUMN); the
-- escalations table is dropped only if the threads PR is not also in.
