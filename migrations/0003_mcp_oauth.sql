-- The game's MCP server (/<slug>/mcp) signs a player in with OAuth 2.1 (authorization code + PKCE, public
-- clients, dynamic client registration). The authorize step reuses the game's magic-link log-in: a log-in
-- link can carry the page to return to (`next`, always this game's own /oauth/authorize), so after the
-- person clicks it and has a session the consent page follows.
-- Everything is per game and stores only hashes of secrets, like sessions and log-in links do.

ALTER TABLE login_tokens ADD COLUMN next TEXT;

-- A client (an AI app) that registered itself at /<slug>/oauth/register. Public: no secret, PKCE instead.
CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL CHECK (json_valid(redirect_uris) AND json_type(redirect_uris) = 'array'),
  -- A hash of the registering address, only to cap registrations per address.
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX oauth_clients_game ON oauth_clients(game_id, created_at);

-- The one-time code the consent page hands back to the client (10 minutes, single use).
CREATE TABLE oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id),
  game_id TEXT NOT NULL REFERENCES games(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

-- Access tokens (1 hour) and refresh tokens (30 days, single use: refreshing issues a new pair).
CREATE TABLE oauth_tokens (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('access','refresh')),
  client_id TEXT NOT NULL REFERENCES oauth_clients(id),
  game_id TEXT NOT NULL REFERENCES games(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX oauth_tokens_player ON oauth_tokens(game_id, player_id);
