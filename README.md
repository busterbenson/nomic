# Promptocracy

A modern interpretation of the game of nomic, powered by AI. (This repo is
`busterbenson/promptocracy`; the site is planned for promptocracy.us, not
registered yet.)

Nomic is a game where changing the rules is a move. In this version, players
write their turns as plain-language prompts, and an AI referee turns each one
into an exact rule change for the table to vote on, or carries it out if the
rules already allow it.

This repo is the **platform**: one site that can host many games. Each game has
its own slug, its own players and its own public GitHub repo holding its rules.
It runs on Cloudflare Pages (static files plus Pages Functions) with a D1
database. Players join a game with a code, log in with an emailed link, and get
notifications on the board and by email.

- `board.html`, `site.css`: the board page, one static file served for every game
- `functions/`: Pages Functions (`functions/[slug]/...` is everything under a game)
- `migrations/`: the D1 schema (`0001_init.sql`)
- `templates/RULES.md`: the starter ruleset a new game repo begins with
- `scripts/create-game.sh`: creates a game and prints its join link
- `tests/`: end-to-end tests and the screenshot script
- `DESIGN.md`: how the game works and what is still undecided

## URLs

| URL | What |
|---|---|
| `/` | the list of games (name, status, player count). Public, no emails |
| `/<slug>/` | a game's board |
| `/<slug>/join/<CODE>` | the join page |
| `/<slug>/auth/verify` | the magic link's Continue page (GET) and the claim (POST) |
| `/<slug>/api/{game,me,join,login,logout,turn,rules,notifications,notifications/read}` | the game's API |

A slug is 2 to 40 characters of `a-z`, `0-9` and `-`, starting and ending with a
letter or digit. These are refused (they would collide with the site's own
routes): api, auth, join, assets, static, site.css, index.html, admin, www, mail,
help, about, rules, board. An unknown slug is a friendly 404. The middleware
(`functions/_middleware.ts`) is an allowlist: only `/`, `/site.css` and the game
routes answer; everything else (config, migrations, tests, `templates/`) is 404.

## Run it locally

Needs Node 20+. Nothing here touches Cloudflare: D1 runs as a local SQLite file
under `.wrangler/`.

```bash
npm install
cp .dev.vars.example .dev.vars     # DEV_MODE=1: email goes to a table, links come back in the API reply
npm run migrate:local              # create the tables in the local D1
# A game needs a slug and a public repo whose RULES.md the site can read. For local
# testing, borrow this repo's starter ruleset (readable once it is on main):
scripts/create-game.sh --slug demo --name "Demo game" \
  --repo busterbenson/promptocracy --rules-path templates/RULES.md
npm run dev                        # http://localhost:8788
```

Open the printed join link (`http://localhost:8788/demo/join/XXXXXXXX`), fill in the
form, and the page shows a "Dev mode link". Click it to finish joining. In
DEV_MODE the emails that would have been sent are in the `outbox` table:

```bash
npx wrangler d1 execute DB --local --command "SELECT to_addr, subject, body FROM outbox"
```

`create-game.sh` takes `--slug`, `--name`, `--repo owner/name`, and optionally
`--rules-path` (default `RULES.md`), `--rules-ref` (default `main`),
`--max-players`, `--winning-score`, `--local` (default) or `--remote`. It checks
the repo's rules file is publicly readable with a plain GET and refuses
otherwise, generates the join code at run time (never committed), and prints
`<SITE_URL>/<slug>/join/<CODE>`. Run it again with another slug for a second game.

Tests (starts its own `wrangler pages dev` on a throwaway database and a local
stand-in for GitHub's raw host; never reaches GitHub; about two minutes):

```bash
npm test
node tests/seed-demo.mjs /some/dir   # seeds two games and takes screenshots (needs python3 + playwright)
```

## How accounts work

Accounts exist **per game**. There is no global users table: the same email in
two games is two unrelated players.

- A game has a **join code** (8 characters, made by `scripts/create-game.sh`
  when the game is created; it is never committed, because this repo is public).
  The join link is `https://<site>/<slug>/join/<CODE>`. A code opens only its own game.
- Joining asks for an email, a display name and a marker. Nothing is created
  until the person clicks the link we email them, so nobody can sign up someone else.
- Log-in is a **magic link** by email, for that game: single use, expires in 15
  minutes. Limits: 3 links per (game, email) per 15 minutes, and 10 per email
  across all games per hour. There are no passwords. Opening the link only
  shows a page with a **Continue** button; pressing it (a same-origin form POST)
  is what uses the token and logs you in. That way mail scanners and link
  previews that open links cannot burn it. The POST checks that its `Origin`
  matches `SITE_URL` (or the request host when `SITE_URL` is unset), so set
  `SITE_URL` to the address people actually browse.
- A session is a 30-day cookie named `s`, scoped to `Path=/<slug>` (HttpOnly,
  Secure, SameSite=Lax). Only a hash is stored, with the game it belongs to, and
  the server checks that game too: a session for one game is ignored on another's
  routes even if the cookie is sent there.
- Seats can be taken only while the game's status is `setup` (rule 102: adding a
  player takes a proposal once play begins).
- `/<slug>/api/game` is public and never contains emails, player ids or the join code.

To start a game by hand (no referee yet):
`npx wrangler d1 execute DB --local --command "UPDATE games SET status='playing', round=1, turn=0 WHERE slug='demo'"`
(add `--remote` against the deployed database).
Once playing, the player whose turn it is (`games.turn` = their seat number, from 0) sees a "Your turn" box on the board and submits one prompt per round. This only records the turn; nothing advances `turn` or `round` yet.

## Rules live in each game's repo

A game row has `repo` (`owner/name`), `rules_path` (default `RULES.md`) and
`rules_ref` (default `main`). `/<slug>/api/rules` fetches
`https://raw.githubusercontent.com/<repo>/<ref>/<path>` on the server (public repos
only; no token), caches it for 60 seconds, and returns it as `text/markdown`. If
GitHub cannot be reached it answers 502 with a plain message and the board shows
"Rules unavailable right now" instead of breaking. The repo, path and ref are
shape-checked before every fetch. `RULES_BASE_URL` replaces the host (the tests
use it; never set it in production).

## Email

One sender, chosen at runtime (`functions/_lib/email.ts`):

1. `EMAIL` binding present (Cloudflare Email Sending) and `MAIL_FROM` set
2. else `RESEND_API_KEY` secret and `MAIL_FROM` set (Resend)
3. else `DEV_MODE=1` (outbox table; **local only**, it returns magic links in API replies)
4. else join and log-in answer `503 email is not configured`. They never pretend to succeed.

## Deploy

Run by whoever owns the Cloudflare account. These are the exact commands; none of
them were run while building this.

```bash
npx wrangler login

# 1. Database. Copy the printed database_id into wrangler.toml.
npx wrangler d1 create nomic
npx wrangler d1 migrations apply DB --remote   # one fresh 0001_init.sql: nothing is deployed yet, so there is nothing to migrate

# 2. Pages project (production branch: main)
npx wrangler pages project create nomic --production-branch main

# 3. Email. Pick ONE.
#   a) Cloudflare Email Sending: onboard your sending domain in the dashboard
#      (Email > Email Sending), uncomment [[send_email]] in wrangler.toml, and set
#      MAIL_FROM in [vars] to an address on that domain (it is unset by default).
#   b) Resend: verify a domain at resend.com, then
npx wrangler pages secret put RESEND_API_KEY --project-name nomic
#      and set MAIL_FROM in wrangler.toml [vars].
# Set SITE_URL in wrangler.toml [vars] to the public address once it is known.

# 4. Ship it
npx wrangler pages deploy . --project-name nomic --branch main

# 5. Make the game (its repo must already exist, be public and contain RULES.md) and
#    print its join link. The code is generated here, not committed.
SITE_URL=https://promptocracy.us scripts/create-game.sh --remote \
  --slug <slug> --name "<Game name>" --repo <owner>/<game-repo>
```

Never set `DEV_MODE` on the deployed project. Pages deploys the repo root, but
`functions/_middleware.ts` serves only `/`, `/site.css` and the `/<slug>/...`
game routes; everything else (config, migrations, tests, templates) answers 404.
