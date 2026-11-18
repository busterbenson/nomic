# nomic

A modern interpretation of the game of nomic, powered by AI.

Nomic is a game where changing the rules is a move. In this version, players
write their turns as plain-language prompts, and an AI referee turns each one
into an exact rule change for the table to vote on, or carries it out if the
rules already allow it. Rules can change the scoring, the turn order, the win
condition, the referee's own powers, and this website.

The site runs on Cloudflare Pages (static files plus Pages Functions) with a D1
database. Players join with a code, log in with an emailed link, and get
notifications on the board and by email.

- `RULES.md`: the rules in effect (in git, served as-is)
- `index.html`, `site.css`: the public board, drawn from `/api/game` and `RULES.md`
- `functions/`: Pages Functions: join, log-in, notifications, the board's API
- `migrations/`: the D1 schema
- `scripts/create-game.sh`: creates a game and prints its join link
- `tests/`: end-to-end tests and the screenshot script
- `DESIGN.md`: how the game works and what is still undecided

## Run it locally

Needs Node 20+. Nothing here touches Cloudflare: D1 runs as a local SQLite file
under `.wrangler/`.

```bash
npm install
cp .dev.vars.example .dev.vars     # DEV_MODE=1: email goes to a table, links come back in the API reply
npm run migrate:local              # create the tables in the local D1
scripts/create-game.sh             # makes "Nomic, game 1" and prints the join link
npm run dev                        # http://localhost:8788
```

Open the printed join link (`http://localhost:8788/join/XXXXXXXX`), fill in the
form, and the page shows a "Dev mode link". Click it to finish joining. In
DEV_MODE the emails that would have been sent are in the `outbox` table:

```bash
npx wrangler d1 execute DB --local --command "SELECT to_addr, subject, body FROM outbox"
```

Tests (starts its own `wrangler pages dev` on a throwaway database, about a minute):

```bash
npm test
node tests/seed-demo.mjs /some/dir   # seeds two players and takes screenshots (needs python3 + playwright)
```

## How accounts work

- A game has a **join code** (8 characters, made by `scripts/create-game.sh`
  when the game is created; it is never committed, because this repo is public).
  The join link is `https://<site>/join/<CODE>`. Anyone with the link can ask for a seat.
- Joining asks for an email, a display name and a marker. Nothing is created
  until the person clicks the link we email them, so nobody can sign up someone else.
- Log-in is a **magic link** by email: single use, expires in 15 minutes, at most
  3 per address per 15 minutes. There are no passwords.
- A session is a 30-day cookie (HttpOnly, Secure, SameSite=Lax). Only a hash of it is stored.
- Seats can be taken only while the game's status is `setup` (rule 102: adding a
  player takes a proposal once play begins).
- `/api/game` is public and never contains emails, user ids or the join code.

To start a game by hand (no referee yet):
`npx wrangler d1 execute DB --local --command "UPDATE games SET status='playing', round=1, turn=0"`
(add `--remote` against the deployed database).

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
npx wrangler d1 migrations apply DB --remote

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

# 5. Make the game and print its join link (the code is generated here, not committed)
SITE_URL=https://nomic.pages.dev scripts/create-game.sh --remote
```

Never set `DEV_MODE` on the deployed project. Pages deploys the repo root, but
`functions/_middleware.ts` serves only `/`, `/index.html`, `/RULES.md`,
`/site.css` and the `/api`, `/auth`, `/join` routes; everything else (config,
migrations, tests) answers 404.
