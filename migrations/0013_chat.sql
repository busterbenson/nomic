-- The chat window and Gremlin's commission chat (rules 106.3, 106.7, 801.2-801.4).
-- Numbered 0013: after Eras (0011) and the actions (0012).
--
-- chat_messages: one row per line in a player's chat with an agent (Gremlin now, Starling in step 2b). PRIVATE: only that player
-- reads it (src/routes/api-chat.ts selects on the signed-in player's id and nothing else); Chalant's night read sees counts and
-- failures (agent_calls) and, once escalation exists, the text of escalated turns only.
--   local_date  YYYY-MM-DD in the game's time zone: the cap's day (rule 106.7) and the history's day divider
--   day         the game day, NULL before day 1
--   role        player | agent | event (a line the site writes: "Nothing was saved") | excuse (Gremlin at the limit) | chalant
--   ticket_id   the draft this turn was about
--   meta        a patch summary, the validator's reasons, a refusal; never the prompt
-- Reversible: two new tables and their indexes, no existing table touched (down = drop them).
CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL REFERENCES games(id),
  player_id TEXT NOT NULL,
  agent TEXT NOT NULL CHECK (agent IN ('gremlin', 'starling')),
  local_date TEXT NOT NULL,
  day INTEGER,
  role TEXT NOT NULL CHECK (role IN ('player', 'agent', 'event', 'excuse', 'chalant')),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  ticket_id TEXT REFERENCES tickets(id),
  meta TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta)),
  at TEXT NOT NULL,
  FOREIGN KEY (game_id, player_id) REFERENCES players(game_id, id)
);
CREATE INDEX chat_day ON chat_messages(game_id, player_id, agent, local_date, role);
CREATE INDEX chat_history ON chat_messages(game_id, player_id, agent, id);
-- At most one improvised excuse per player per agent per day (workshop.md "Gremlin at the limit"): the unique index is what makes
-- "only the request whose insert succeeded makes the improvised call" true under two tabs.
CREATE UNIQUE INDEX chat_one_excuse ON chat_messages(game_id, player_id, agent, local_date) WHERE role = 'excuse';

-- agent_calls: every model call, for the monthly budget (rule: a site limit, not a setting) and for Chalant's nightly read. No prompt
-- text and no player text: reason is the validator's or the API's short reason.
--   purpose  chat | thread | excuse | art | draft
--   outcome  pending (a reservation, a later PR) | ok | refused | malformed | invalid | failed | over_budget
--   cost_micro  the call's cost in millionths of a dollar, from `usage`; what the budget sums
CREATE TABLE agent_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  player_id TEXT,
  agent TEXT NOT NULL,
  purpose TEXT NOT NULL,
  model TEXT NOT NULL,
  outcome TEXT NOT NULL,
  input_tokens INTEGER, cache_read INTEGER, cache_write INTEGER, output_tokens INTEGER, ms INTEGER,
  cost_micro INTEGER,
  reason TEXT,
  local_date TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX agent_calls_month ON agent_calls(game_id, at);
CREATE INDEX agent_calls_cap ON agent_calls(game_id, player_id, agent, purpose, local_date);
