-- Starling, the Rulebook's chat (rules 103.1, 106.2, 106.4, 106.7). Numbered 0015: after Eras (0011), the actions (0012), the chat (0013) and
-- the threads (0014), whose `escalations` table Starling's escalations use as it is (agent 'starling', a chat_message_id, no ticket_id).
--
-- chat_messages.proposal_id: the draft a line of Starling's shows (the slip under it). Proposals keep their own table; this is only the
-- pointer, so the history can draw the slip and say how it ended. NULL for every other line. Nothing else about chat_messages changes
-- (its agent CHECK already allows 'starling').
-- Reversible: drop the index; the column's pointer is simply unread (SQLite drops a column with ALTER TABLE ... DROP COLUMN).
ALTER TABLE chat_messages ADD COLUMN proposal_id TEXT REFERENCES proposals(id);
CREATE INDEX chat_proposal ON chat_messages(proposal_id) WHERE proposal_id IS NOT NULL;
