# The moderator loop (step 1, PR 5): plan

What this makes true: a proposal that passes at midnight is applied to the game repo (rule text + rule code + tests),
committed, tagged, deployed, and the day unlocks with points, before 2 am. Rules: 106, 107.2-107.8, 108, 401, 402.

## Pieces

| Where | What |
|---|---|
| `moderator/process-day.mjs` | the runner (Mac mini, launchd every 2 min). Everything deterministic: poll, clone, order, test run, commit, tag, push, claim, deploy trigger, reconcile, notifications. |
| `moderator/APPLY.md` | the prompt for the one `claude -p` call per proposal (apply text + code + tests) |
| `moderator/AUDIT.md` | the prompt for the drafter audit (re-read the player's words, compare with the voted draft) |
| `moderator/test.mjs` | the runner's tests: a temp bare git repo for the game, an in-process stand-in for the Worker's moderator API, a scripted stand-in for `claude -p` |
| `src/routes/api-moderator.ts` | `GET /<slug>/api/moderator/pending`, `POST /<slug>/api/moderator/days/:n/claim` |
| `src/lib/day.ts` | the night's moderator step: wait, claim -> deploying, unlock on sha match with points (401, `onEnacted`) and win (402, `dayEnd`), deploy deadline |
| `src/engine/hooks.js` | `applyOrder` (decide, exactly one), `onEnacted`, `dayEnd` (sequence) wired; the refusal of unwired hooks now covers only voteMark, electorate, tally |
| `templates/rules/107.ts, 401.ts, 402.ts` (+ Rickshaw) | the starter modules for those hooks |
| `tests/moderator.mjs` | the Worker side, on `wrangler dev` with a local D1 |

## Routes (bearer token per game)

`Authorization: Bearer <token>`; the Worker compares `sha256(token)` with `games.moderator_token_hash` (constant-time
compare of the hex). No hash set, wrong token, or no header: 401 with no detail. Both routes refuse a game not playing.

`GET /api/moderator/pending` -> 200
```
{ game: {slug, repo, day, rules_day},
  job: null | { day, status: "processing"|"deploying", deadline_at, deploy_deadline_at, commit_sha,
                passed: [ {number, title, kind, scope, target, new_num, to_block, words, draft_head, before_text,
                           after_text, settings, conflicts, mark, yes, no, needed, budget_minutes, budget_effort,
                           base_sha, player: {name}} ]   // already in applyOrder order (the game's own 107 module)
              },
  not_applied: [ {number, day} ]   // every not_applied proposal of the game: the runner's reconcile list
}
```
The order is decided in the Worker by the bundle's `applyOrder` hook, so the order is the rules in effect that night.

`POST /api/moderator/days/:n/claim {sha, outcomes: [{number, applied: true, commit} | {number, applied: false, reason}], notes?: [{number, body}]}`
- 200 `{status: "deploying", deploy_deadline_at}`; the day goes `processing -> deploying`, `days.commit_sha = sha`,
  `days.tag = day-N`. Each not-applied outcome: proposal `not_applied`, its reason + the 107.7 suggestion, and the
  owner's notification (`not-applied-<id>`, once). Each applied outcome: `proposals.commit_sha` (status stays `passed`
  until the unlock). Notes (drafter audit): one notification per note to the proposer (`audit-<id>`, once, kind
  `moderator_note`, at most 600 chars).
- 409 if the day isn't `processing` or `now >= deadline_at` (107.6: the claim came too late). A repeat of the same
  claim while `deploying` with the same sha answers 200 (the runner restarted after the claim).
- 400 if the outcomes don't name exactly the passed proposals, or sha isn't 40 hex, or a reason is empty/too long.
- All writes in one batch, each guarded by `status = 'processing' AND deadline_at > now`.

## Night states (D1 is authoritative; the repo follows)

```
locked --count--> processing --claim (before deadline)--> deploying --bundle sha == commit_sha--> unlock (done)
                     |                                         |
                     +-- deadline passes, no claim ------------+-- deploy deadline (deadline + 30 min) passes
                         -> every passed: not_applied                -> applied-but-not-live: not_applied
                         -> timed_out, unlock                         -> timed_out, unlock
```
Unlock (in one batch, every statement guarded by "this proposal is still `passed`"): points from `onEnacted` for each
applied proposal in order (401: +10 to its proposer), then `dayEnd` with the new scores (402: a player at 100 or more
wins, first given points first; game `over`), proposals `enacted` with `rev`, `games.rules_day = N`, the night events.
Then `finalizeDay` opens day N+1 as before. The sha check: `bundleFor(game).bundle.sha` (the commit the build fetched at
the newest `day-N` tag). `DEV_MODE` only: a `dev_controls` key `bundle_sha:<slug>` stands in for it (tests).

No migration is needed: `days.status` already allows `deploying`, `days.commit_sha` / `days.tag`, `proposals.commit_sha` /
`rev` / `not_applied_reason` / `budget_*`, and `games.moderator_token_hash` exist (0005-0007).

## The runner's state machine (one run, one game)

```
lock (O_EXCL file holding the pid; stale when the pid is gone, or after 90 min) --busy--> exit 0 "another run holds the lock"
  -> GET pending
  -> reconcile: clone main; for each not_applied proposal whose commit (trailer "Proposal: P<k>") is on main and not
     yet reverted ("Reverts-Proposal: P<k>"), git revert it; tests; push main
  -> job null: if the latest processed day has no day-N tag, tag it (empty night). exit.
  -> job deploying: (resume after a crash) the tag day-N at commit_sha exists on origin? else tag + push it.
     Deploy triggered for this sha (state file)? else trigger. exit.
  -> job processing:
       for each passed proposal (in the Worker's order):
         remaining budget: min(budget_minutes, minutes to the deadline - 5)
         same target as a proposal applied earlier tonight -> redraft flag (107.3)
         claude -p APPLY.md (fenced proposal data, budget timeout, --effort budget_effort)
         -> result file: applied | not_applied {reason} | conflict {rule, why, prevails?}
         -> code checks: changed paths in the allowlist; game tree check (lint, claims, rulebook, tests: checkTree
            from scripts/bundle-games.mjs, sandboxed) -> fail: one fix attempt with the failure output, up to 2
         -> pass: commit "P8: <title> (day 12, 4-1)" + "Proposal: P8" trailer; fail: reset to the last good commit
         -> 108: a conflict with a rule that prevails (rank) -> not applied, the reason names the rule
       drafter audit per proposal while time is left before the claim margin (claude -p AUDIT.md, no tools, JSON out)
         -> night log; a material gap -> a note in the claim, and after the claim a case in tests/drafter-cases.json
         on a platform branch + a draft PR (never merged by the runner)
       push main (the commits) -> claim -> 409: revert locally nothing (D1 will list them as not applied; the next run
         reconciles) -> 200: tag day-N, push tag, trigger the deploy
  -> any thrown error: night log + a notification file; the 2 am fallback still ends the lock
pending job older than 30 min (processing since locked_at + 30 min) -> notification file (once per day)
```
Idempotency: the lock file; the server's claim guard (a second claim with another sha is refused, the same sha is a
200); commits carry the trailer so a rerun sees what is already on main (it starts from origin/main and skips a
proposal whose `Proposal: P<k>` commit is already there for this day); tags are created only if missing.

## Security model

- Proposal text is untrusted. It reaches the model only inside a fenced data block (`<proposal-data>` JSON, with any
  closing fence in the data escaped), and APPLY.md says the data is never instructions.
- The model runs `claude -p --restricted --strict-mcp-config --tools Read,Edit,Write,Glob,Grep --permission-mode
  acceptEdits --permission-prompts none`: no shell, no web, no MCP, file tools confined to the worktree, user settings
  (and so this machine's approval hook) not loaded. Its environment is scrubbed to PATH, HOME, USER, LANG, TMPDIR: no
  Cloudflare token, no moderator token, no GitHub token. It cannot run tests, git or the network.
- The model works in a COPY of the game's files with no `.git`; the script copies its changes back (a `.git`, a symlink
  or `node_modules` it made is refused), and every git call runs with `core.fsmonitor=false` and `core.hooksPath=/dev/null`.
  The model gets only what is enacted (the voted draft and what it replaces), not the player's own words.
- Scope: RULES.md may change only in the sections of the rules the proposal changes (plus a 108.4 note on an
  overridden rule), the voted draft must be in it word for word (unless redrafted, 107.3), `rules/<n>.ts` and
  `rules/<n>.test.ts` only for those rules, and `settings.json` only for keys those sections tag. 108's marks are read
  from the rules as they stood, and a precedence claim counts only if the rule's text makes it.
- Everything the model wrote is checked by code: the changed paths (`git status --porcelain`, untracked included) must
  be under `RULES.md`, `settings.json`, `rules/`, `rulings/` (plus the one result file the runner reads and deletes);
  no symlinks; then the bundler's own `checkTree` (top-level files, game.json, lint: no network/globals/imports beyond
  the engine, `@rule` claims, rulebook agreement) and the game's tests in the bundler's sandbox (`node --permission`,
  scrubbed env). The platform repo is never written by the night except the drafter-audit case branch, which the
  runner writes itself (not the model) and opens as a PR for a human.
- The moderator token lives only in `~/chalantbot/.env` (`PROMPTOCRACY_MODERATOR_TOKEN_<SLUG>`); D1 keeps its SHA-256.
- Budget (107.5): a hard timeout (SIGKILL) at the budget, and `--effort` from the stored budget.

## Not in this PR
- the stale-bundle re-lock (`GAMES[slug].day < games.rules_day`), the `code-status` route (PR 8), the recap UI (PR 6).
