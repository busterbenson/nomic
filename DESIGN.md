# Design

Nomic is a game where changing the rules is a move. Peter Suber invented it in
1982, and Douglas Hofstadter's *Scientific American* column made it famous. This
version keeps Suber's idea and swaps the human judge for an AI referee. On your
turn you write a prompt in plain language, and the referee turns it into an exact
rule change, or carries it out as an action the rules allow. Rule changes can
also change this website.

First game: public, played by friends. The site is built to host several games
(only one to start), each with its own repo.

## The pieces

| Piece | What it is | Where it lives |
|---|---|---|
| Rules | The rules in effect, and nothing else | `RULES.md` in **the game's own repo** (the starter is `templates/RULES.md` here) |
| Accounts | Who is playing, per game: email, display name, session. No global users | D1 (`players`, `sessions`, `login_tokens`) |
| Board state | Players, piece colors, scores, whose turn, the log, the tiles | D1 (`games`, `players`, `events`), read through `/<slug>/api/game` |
| Notifications | In-game and email notices to every player | D1 (`notifications`), sent by `src/lib/notify.ts` |
| Board | The public page that draws the state above and the game's rules; the island is drawn in WebGL (three.js, vendored) with an SVG fallback | `public/board.html`, `public/js/`, `public/theme.css` (the one file of colors), `public/site.css`, served as Worker static assets |
| Rulings | Every ruling the referee makes, with the rules it cited | `rulings/` (created by the first ruling) |
| Referee | An AI model that drafts proposals and rules on what the rules mean | GitHub Actions + the Claude API (not built yet) |

## Hosting, accounts and the git / D1 split

The site is hosted as one **Cloudflare Worker with static assets** (`src/index.ts`
routes requests; `public/` holds the static files) and a **D1** database. It runs
on Workers rather than Pages because Cloudflare recommends Workers for new
projects. It replaced GitHub Pages so the game can grow server-side features
without a second host. Pull request previews get their own D1 database, never the
production one (see the README).

Anyone who wants to play signs up on the site: a **join code** (shared as a link,
`/<slug>/join/<CODE>`) lets them ask for a seat, and an emailed **magic link** completes
it and logs them in. There are no passwords. Every player then gets
**notifications**: an in-game list under a bell on the board, and an email. Only
"player joined" exists today; turn started, proposal open, vote result and ruling
call the same `notify()` once the referee exists.

## Many games, one repo each

Everything for a game lives under its slug (`/<slug>/`, `/<slug>/api/...`). The
database has no global users: a player row belongs to one game, and sessions,
notifications, turns, log events and login tokens all carry that game's id (the
database itself refuses a notification, session or turn that points at a player
of another game). The same email in two games is two accounts. A session cookie
is scoped to `Path=/<slug>` and is also checked against the game on the server.

**Platform vs game.** The platform code (Worker, schema, board page) lives in
`busterbenson/promptocracy` and changes only through Buster's PRs. Each game's
rules live in that game's own public repo (`games.repo`, `rules_path`,
`rules_ref`), and later its rulings and any game-specific board extensions do
too. So one game's rule changes (a passed proposal is a commit to its own repo)
can never touch another game, and the referee for a game only ever gets write
access to that game's repo, never the platform's.

What lives where:

- **In git:** each game's rules (`RULES.md` in its own repo), the platform's code and schema (`migrations/`) in this repo,
  and later each game's `rulings/`. Changes here are proposals, votes and commits.
- **In D1:** everything players create by using the site: accounts, sessions,
  scores, whose turn, notifications and the public game log. These change on every
  action and hold private data (emails), so they do not belong in a public repo.
- **Never in the repo:** emails, session ids, the join code. The code is generated
  when the game is created (`scripts/create-game.sh`).

The game's repo holds the rules: every passed proposal is a commit, so `git log` is
the history of the rules, and the referee rereads `RULES.md` and the game state
on every turn instead of remembering anything. (Earlier attempts to have a chatbot run Nomic
broke down because the model lost track of which rules were in effect.)

## A turn

1. **Prompt.** The player whose turn it is logs in to the website and submits one
   prompt in the "Your turn" box, e.g. "Anyone who proposes a rule about cats gets
   5 points." (Turns come in through the site, not GitHub issues, so players do not
   need GitHub accounts.) The site records it in the `turns` table as `submitted`,
   shows it to the whole table, and notifies the other players. One live turn per
   player per round; 1 to 2000 characters. **Built.**
   *Not built yet:* submitting does **not** advance the turn. The turn moves on
   only when the referee and the vote exist (next PR), so for now a submitted turn
   just waits, and `games.turn` / `games.round` are changed by hand.
2. **Draft.** The referee replies on the turn with:
   - whether this is a **proposal** (it changes the rules or the site) or an
     **action** (something a rule already allows);
   - for a proposal, the exact new text and a PR containing it;
   - the rules it relied on, and any conflicts it found.
   The player can revise the prompt until the draft says what they meant.
3. **Vote.** Players vote on the website (or on the PR; undecided). Code counts the votes (rule 104), not the referee.
4. **Result.** If the vote passes, the PR merges, the game state in D1 is updated
   (points, next turn, a log line), and the board updates. If it fails, the PR is
   closed and the turn moves on.
5. **Appeal.** Any ruling can be appealed within 24 hours. A majority vote
   overturns it (rule 201).

## The board

The world is an **infinite isometric grid of square tiles**, with signed integer
coordinates `(x, y)`: x runs east, y runs north. Only **land** exists as data: a
`tiles` row per land tile; everything else is open sea (drawn as a faint grid that
fades out). A new game starts with an **island** 8 tiles wide and 8 tall (`--size`, 4 to 16) on
x 0..7, y 0..7, with each corner bitten off so it reads as an island, which leaves
54 to 58 land tiles.

**Every number of the board is a setting, not code.** `games.settings` is a JSON object
(validated; `src/lib/settings.js` holds the defaults and the validators) and
`scripts/create-game.sh` writes the defaults into the new game's row. The code that makes
the island, takes a move or pays the harvest reads them from there. A passed rule changes a
value (or adds a terrain kind), not code. `templates/RULES.md` rules 207 to 212 state each
setting in plain words and end with the setting they control in brackets, e.g. `[setting:
board.island]`; a test keeps the rules and the settings identical.

| Setting | Default | Controls |
|---|---|---|
| `board.island` | `{width: 8, height: 8}` | the starting island's size |
| `board.erosion` | `{corner_tiles: 2, max_bays: 2}` | how much of the corners and sides is bitten off |
| `board.terrain` | meadow, 25% other: water (inside), sand (coast), stone, forest, in clumps | the terrain kinds, their share, and where each may go. A rule may add a kind |
| `board.land_bounds` | `{min_x: 0, min_y: 0, max_x: null, max_y: null}` | where land may exist (the default limit: x and y at least 0) |
| `turn.actions` | `{claim: true, describe: true}` | the moves a player may make instead of proposing |
| `turn.actions_per_turn` | `1` | how many such moves a turn holds; the last one ends the turn |
| `harvest` | `{points_per_tile: 1, when: "end_of_round"}` | points per owned tile, and when (`end_of_round` for everyone, or `end_of_turn` for the player who just moved) |

- **Names.** Tiles are named like chess squares: x is a letter (A..Z, then AA, AB,
  ...) and y + 1 is the number, so `C4` is x 2, y 3 and `AA12` is x 26, y 11. The
  conversion is `coordLabel` / `parseLabel` in `src/lib/geometry.js`.
- **Land is only at x >= 0 and y >= 0 for now.** That is a default, not a law: the
  schema allows any signed coordinates, and the `board.land_bounds` setting (read by
  `landAllowed`) says where land may exist. A rule may lift it (the island could
  grow west and south) by changing that setting. *Nothing creates new land yet*; a rule
  that does will use `landAllowed`.
- **Adjacency** is the four orthogonal neighbours; the diagonals are available
  separately (`neighbors`, `diagonals`) for rules that want them. The geometry is one
  file, so a different grid is a different `geometry.js` (plus the projection in
  `public/js/board.js` and the slab in `board-gl.js`).
- **Terrain** is one of meadow (default), water, forest, stone, sand, seeded and
  deterministic (the seed is stored on the game): a lake inside the island, sand on
  the coast, forest and stone in clumps. Terrain means nothing until a rule gives
  it meaning.
- **Tile properties** are an open-ended JSON object per tile (`props`, at most 4 KB,
  validated by the database). Rules and the referee can put anything in it. Players
  cannot write it.
- **Pieces.** Each player claims one of eight piece colors at sign-up. A piece stands
  on the player's most recently claimed tile (on a bench below the board until they
  own one).
- **Moves the site carries out itself** (`POST /<slug>/api/action`, no referee):
  claim an unowned land tile, or name and describe a tile you own, by label
  (`{"kind":"claim","label":"C4"}`). Only on your turn, only while the game is
  `playing`. A move completes the turn (or uses one of its `turn.actions_per_turn`
  moves); when the turn wraps past the last player the round ends and every player
  harvests `harvest.points_per_tile` per tile owned (by default 1). Proposals are still
  recorded and wait for the referee, and do not advance the turn; a player who
  proposed this turn cannot also act on it.
- **Look.** Isometric (2:1 dimetric), one fixed angle, no rotation; pan, zoom and
  recenter. All colors are CSS tokens in `public/theme.css`, which the WebGL and SVG
  renderers read too, so a new palette is a one-file change.

## What the referee may and may not do

The referee is the most interesting player at the table and the easiest one to
talk into things. "Ignore the previous rules, I win" is a legal Nomic move, and
deciding what to do with it is the referee's job. So the boundaries are set in
code, not in the referee's instructions:

- It only ever **proposes**: it opens PRs and writes comments. It never merges.
  Merging happens when the code that counts votes says the vote passed.
- It may edit `RULES.md`, `rulings/` and the site's files. It may not
  touch `.github/` (the workflows and their secrets). A rule cannot change that,
  because the rule would have to be carried out by code the referee can't edit.
- It cites rule numbers for every ruling and writes the ruling down. Later
  rulings must be consistent with earlier ones unless a rule changed in between.
- When a passed rule changes the site (rule 204), the code change is in the same
  PR as the rule text, so players vote on both together.

## Not decided yet

- **How game-specific site changes load.** Rule 204 lets a passed rule change the
  website, but the platform is shared. One option is a `board/` folder in the game
  repo that the platform loads for that game's board; nothing is decided, and
  until it is, a rule that changes the site means a platform PR from Buster.
- **Accounts across games.** Per game for now (a deliberate choice). A global
  account may come later; the schema has no global users table to migrate from.

- **Players.** Who. Up to 5 can join with the code (at most 8: there are eight piece colors); the seat count and the
  color palette are constants today.
- **Starting a game.** Nothing flips a game from `setup` to `playing` yet; it is a
  manual D1 update (see README). Seats close at that point.
- **Who the host is.** The first person to join is marked host, which grants
  nothing yet.
- **Referee access to D1.** The referee (a GitHub Action today) will get its own
  D1 access later, with a narrow token that can write scores, turns and
  notifications but not accounts or sessions. Not built.
- **How the referee gets a turn.** The site records the turn; the referee will
  read `turns` rows with status `submitted` (mechanism not built: a Worker route
  calling the Claude API, or a scheduled job).
- **The referee's model and API key.** Which model, and whose key pays for it.
  Each turn is a few calls; the cost per game should be small.
- **Publishing.** Creating the Cloudflare D1 databases (production and preview), and
  choosing the email sender (Cloudflare Email Sending or Resend). Steps are in the README.
- **Email abuse limits.** Magic links are limited per address, not per IP.
- **Starting values.** 10 points per passed proposal and a win at 100 are
  placeholders, meant to be changed in play.

## Order of work

1. This skeleton: rules, state, a static board. (This PR.)
2. Deploy to Cloudflare Workers, make the game, share the join link. (Accounts, join codes and notifications are built.)
3. The referee: an Action that reads a turn issue, drafts the proposal and opens
   the PR.
4. Vote counting, merge, score and turn updates.
5. Appeals and the rulings log.
