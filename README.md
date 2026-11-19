# Promptocracy

A modern interpretation of the game of nomic, powered by AI. (This repo is
`busterbenson/promptocracy`; the site is planned for promptocracy.us, not
registered yet.)

Nomic is a game where changing the rules is a move. In this version, players
write their turns as plain-language prompts, and Chalant, the AI moderator, turns each one
into an exact rule change for the table to vote on, or carries it out if the
rules already allow it.

This repo is the **platform**: one site that can host many games. Each game has
its own slug, its own players and its own public GitHub repo holding its rules.
It runs as one Cloudflare Worker with static assets, plus a D1 database. Players
join a game with a code, log in with an emailed link, and get notifications on the
board and by email.

- `src/index.ts`: the Worker and its small hand-written router (no framework)
- `src/routes/`, `src/lib/`: the page and API handlers, and shared code
- `public/`: the static files: `board.html` (one board page for every game), `site.css`, `theme.css` (every color), `js/` (the board) and `vendor/` (three.js, pinned, no CDN)
- `migrations/`: the D1 schema (`0001_init.sql`, `0002_island_board.sql`)
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
| `/<slug>/api/board` | GET, public, never cached: the charted tiles (`x`, `y`, `z`, `label` like `3N 2E 1U`; nothing else) and the pieces (color, score, position), plus the settings and the move rules. No emails, no ids |
| `/<slug>/api/action` | POST `{kind:"move", x, y}` or `{kind:"move", label:"3N 2E"}`: move your piece one space (diagonals included) onto a charted, unoccupied tile, once per turn, in addition to proposing. It charts the tiles around you |
| `/js/*.js`, `/vendor/*.js`, `/theme.css`, `/site.css` | the board's scripts (three.js 0.186.1, vendored), and the styles |

A slug is 2 to 40 characters of `a-z`, `0-9` and `-`, starting and ending with a
letter or digit. These are refused (they would collide with the site's own
routes): api, auth, join, assets, static, site.css, theme.css, js, vendor, index.html, admin, www, mail,
help, about, rules, board. An unknown slug is a friendly 404. The router
(`src/index.ts`) is an allowlist: only `/`, `/site.css`, `/theme.css`, the board's scripts and the game routes answer;
everything else is 404. Only `public/` is ever uploaded as static files (config,
migrations, tests and `templates/` are not), and the Worker runs first for every
request (`run_worker_first`), so a file in `public/` is served only if the router names it.

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
npm run dev                        # wrangler dev: http://localhost:8788
```

Open the printed join link (`http://localhost:8788/demo/join/XXXXXXXX`), fill in the
form, and the page shows a "Dev mode link". Click it to finish joining. In
DEV_MODE the emails that would have been sent are in the `outbox` table:

```bash
npx wrangler d1 execute DB --local --command "SELECT to_addr, subject, body FROM outbox"
```

`create-game.sh` takes `--slug`, `--name`, `--repo owner/name`, and optionally
`--rules-path` (default `RULES.md`), `--rules-ref` (default `main`),
`--max-players` (1 to 8, default 8: the `max_players` setting), `--size` (island side, even, 4 to 16, default 8; every other board setting is written to the game's row at its default and can be changed there: `src/lib/settings.js`), `--winning-score`, `--local` (default) or `--remote`. It checks
the repo's rules file is publicly readable with a plain GET and refuses
otherwise, generates the join code at run time (never committed), and prints
`<SITE_URL>/<slug>/join/<CODE>`. Run it again with another slug for a second game.

Tests (starts its own `wrangler dev` on a throwaway database and a local
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
- Joining asks for an email, a display name and a piece color (one of eight, unique per game). Nothing is created
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

To start a game by hand (no moderator yet):
`npx wrangler d1 execute DB --local --command "UPDATE games SET status='playing', round=1, turn=0 WHERE slug='demo'"`
(add `--remote` against the deployed database).
Once playing, the player whose turn it is (`games.turn` = their seat number, from 0) sees a "Your turn" box on the board and submits one prompt per round, and may also move their piece once (in either order). Proposing only records the turn; nothing advances `turn` or `round` yet (a move is remembered in `games.last_move` as `round:turn`, so whatever advances the turn must make `round` grow when `turn` wraps).

## Rules live in each game's repo

A game row has `repo` (`owner/name`), `rules_path` (default `RULES.md`) and
`rules_ref` (default `main`). `/<slug>/api/rules` fetches
`https://raw.githubusercontent.com/<repo>/<ref>/<path>` on the server (public repos
only; no token), caches it for 60 seconds, and returns it as `text/markdown`. If
GitHub cannot be reached it answers 502 with a plain message and the board shows
"Rules unavailable right now" instead of breaking. The repo, path and ref are
shape-checked before every fetch. `RULES_BASE_URL` replaces the host (the tests
use it; never set it in production). The 60-second cache only works on a custom domain (the Cache API does nothing on `*.workers.dev`), so there every board load fetches from GitHub.

## Email

One sender, chosen at runtime (`src/lib/email.ts`):

1. `EMAIL` binding present (Cloudflare Email Sending) and `MAIL_FROM` set
2. else `RESEND_API_KEY` secret and `MAIL_FROM` set (Resend)
3. else `DEV_MODE=1` (outbox table; **local only**, it returns magic links in API replies)
4. else join and log-in answer `503 email is not configured`. They never pretend to succeed.

In production `wrangler.toml` `[vars]` sets `MAIL_FROM = "Chalant <chalant@promptocracy.us>"`
(the sender is Chalant, the moderator; Cloudflare Email Sending is set up for promptocracy.us) and
`SITE_URL = "https://promptocracy.us"` (email links and the Origin check). Local development and
the tests blank both (`.dev.vars.example`, `tests/lib.mjs`) so email goes to the outbox and links use
the local origin (`npm run dev` passes `--var MAIL_FROM: --var SITE_URL:`, which wins over `.dev.vars`; to test real email links locally, run `wrangler dev` yourself with your own `--var`s). Previews do not inherit `[vars]`: they have no `MAIL_FROM`, no `SITE_URL` and no
email binding (`tests/hex.mjs` fails if a `previews` block ever adds them).

## Deploy

Deploys are done by **Workers Builds**: the Cloudflare Worker `promptocracy` is
connected to this GitHub repo (root `/`, no build command, no build variables).

- **Merge to `main`** runs `npx wrangler deploy`: that is the production deploy.
- **A pull request** runs the preview command, `npx wrangler preview` (the default),
  which creates or updates a **Preview** of the same Worker for that branch and posts
  its URL. A Preview is isolated from production:
  - Cloudflare's rule is "Previews do not inherit production settings" (docs:
    <https://developers.cloudflare.com/workers/previews/>). A Preview gets only what
    is in the `previews` block of `wrangler.toml`.
  - That block binds `DB` to a **separate D1 database, `promptocracy-preview`**. A D1
    database is shared only when two bindings name the same `database_id`
    (<https://developers.cloudflare.com/workers/previews/resources/>), so previews can
    never read or write the production `promptocracy` database.
  - It has no `EMAIL` binding, no `MAIL_FROM`, no `SITE_URL`, no secrets: a Preview
    answers 503 on join and log-in, so it can never email anyone. The static files
    and the board work. (All previews share the one preview database. Two open PRs
    that change the schema would collide; apply migrations from the branch under test.)
  - **Dashboard settings to check: none to change.** Keep the Preview command at its
    default, `npx wrangler preview`. Do **not** change it to `npx wrangler versions
    upload`: Cloudflare says version URLs "use the resources configured for that Worker
    version and do not create branch-isolated resources", i.e. the production database.
    Previews need Wrangler 4.135 or newer; `package-lock.json` pins 4.164.
  - Do not add `[[d1_databases]]` entries under `previews` that point at the production
    `database_id`, and do not add a top-level `[env.*]` for previews: it is not how
    Previews pick their bindings.

### One-time setup (run by whoever owns the Cloudflare account)

None of this was run while the conversion was built. Until it is done the live site
errors, because the database does not exist.

```bash
npx wrangler login

# 1. Databases. Paste each printed database_id into wrangler.toml
#    (production: [[d1_databases]]; preview: [[previews.d1_databases]]) and into
#    wrangler.preview-migrations.toml (the preview id), and commit.
npx wrangler d1 create promptocracy
npx wrangler d1 create promptocracy-preview

# 2. Schema, on both. Nothing is deployed yet, so there is nothing to migrate.
npx wrangler d1 migrations apply DB --remote
npx wrangler d1 migrations apply DB --remote --config wrangler.preview-migrations.toml

# 3. Email for promptocracy.us. Onboard the sending domain in the dashboard
#    (Compute > Email Service / Email Sending), then set MAIL_FROM in wrangler.toml [vars]
#    to an address on it. The [[send_email]] EMAIL binding is already declared.
#    Or use Resend instead: verify a domain there, set MAIL_FROM, DELETE the
#    [[send_email]] block from wrangler.toml (the EMAIL binding wins over Resend
#    whenever it exists), and
npx wrangler secret put RESEND_API_KEY
# MAIL_FROM and SITE_URL are already set in [vars] for promptocracy.us.

# 4. Merge to main: Workers Builds deploys. (Or by hand: npx wrangler deploy.)

# 5. Make the game (its repo must already exist, be public and contain RULES.md) and
#    print its join link. The code is generated here, not committed.
SITE_URL=https://promptocracy.us scripts/create-game.sh --remote \
  --slug <slug> --name "<Game name>" --repo <owner>/<game-repo>
```

To check that the config builds without deploying: `npm run deploy:dry-run`
(`wrangler deploy --dry-run`).

Never set `DEV_MODE` on the deployed Worker.
