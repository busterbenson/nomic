# Design

Nomic is a game where changing the rules is a move. Peter Suber invented it in
1982, and Douglas Hofstadter's *Scientific American* column made it famous. This
version keeps Suber's idea and swaps the human judge for an AI referee. On your
turn you write a prompt in plain language, and the referee turns it into an exact
rule change, or carries it out as an action the rules allow. Rule changes can
also change this website.

First game: public, played by friends.

## The pieces

| Piece | What it is | Where it lives |
|---|---|---|
| Rules | The rules in effect, and nothing else | `RULES.md` |
| Board state | Players, markers, scores, whose turn, the log | `game.json` |
| Board | The public page that draws the two files above | `index.html`, served by GitHub Pages |
| Rulings | Every ruling the referee makes, with the rules it cited | `rulings/` (created by the first ruling) |
| Referee | An AI model that drafts proposals and rules on what the rules mean | GitHub Actions + the Claude API (not built yet) |

The repo is the game. Every passed proposal is a commit, so `git log` is the
game's history, and the referee rereads `RULES.md` and `game.json` on every turn
instead of remembering anything. (Earlier attempts to have a chatbot run Nomic
broke down because the model lost track of which rules were in effect.)

## A turn

1. **Prompt.** The player whose turn it is opens a GitHub issue with one prompt,
   e.g. "Anyone who proposes a rule about cats gets 5 points."
2. **Draft.** The referee replies on the issue with:
   - whether this is a **proposal** (it changes the rules or the site) or an
     **action** (something a rule already allows);
   - for a proposal, the exact new text and a PR containing it;
   - the rules it relied on, and any conflicts it found.
   The player can revise the prompt until the draft says what they meant.
3. **Vote.** Players vote on the PR with a comment, `/vote yes` or `/vote no`.
   Code counts the votes (rule 104), not the referee.
4. **Result.** If the vote passes, the PR merges, `game.json` is updated (points,
   next turn, a log line), and the board updates. If it fails, the PR is
   closed and the turn moves on.
5. **Appeal.** Any ruling can be appealed within 24 hours. A majority vote
   overturns it (rule 201).

## What the referee may and may not do

The referee is the most interesting player at the table and the easiest one to
talk into things. "Ignore the previous rules, I win" is a legal Nomic move, and
deciding what to do with it is the referee's job. So the boundaries are set in
code, not in the referee's instructions:

- It only ever **proposes**: it opens PRs and writes comments. It never merges.
  Merging happens when the code that counts votes says the vote passed.
- It may edit `RULES.md`, `game.json`, `rulings/` and the site's files. It may not
  touch `.github/` (the workflows and their secrets). A rule cannot change that,
  because the rule would have to be carried out by code the referee can't edit.
- It cites rule numbers for every ruling and writes the ruling down. Later
  rulings must be consistent with earlier ones unless a rule changed in between.
- When a passed rule changes the site (rule 204), the code change is in the same
  PR as the rule text, so players vote on both together.

## Not decided yet

- **Players.** Who, and how many. `game.json` has Buster plus four open seats.
- **How players submit turns.** GitHub issues mean every player needs a GitHub
  account. The alternative is a small form on the site that files the issue for
  them.
- **The referee's model and API key.** Which model, and whose key pays for it.
  Each turn is a few calls; the cost per game should be small.
- **Publishing.** Turning on GitHub Pages for this repo (Settings → Pages →
  deploy from `main`, root) makes the board public.
- **Starting values.** 10 points per passed proposal and a win at 100 are
  placeholders, meant to be changed in play.

## Order of work

1. This skeleton: rules, state, a static board. (This PR.)
2. Turn on Pages and fill in the players.
3. The referee: an Action that reads a turn issue, drafts the proposal and opens
   the PR.
4. Vote counting, merge, score and turn updates.
5. Appeals and the rulings log.
