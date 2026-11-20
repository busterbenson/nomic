# AGENTS.md — working on Promptocracy

Read this before changing anything here. It holds the decisions and conventions that aren't obvious from the code. `CLAUDE.md` imports it.

## What this is

Promptocracy is a self-amending game (after Peter Suber's Nomic) at promptocracy.us. This repo is the **platform**: one Cloudflare Worker + D1 database hosting many games. Each game has its own public GitHub repo holding its rules (first one: `busterbenson/promptocracy-rickshaw`, Rickshaw Game 1). Chalant, the AI, is the game's **moderator** (never "referee").

Owner: Buster Benson. He decides game design; agents build what he approved.

## Hard rules for anyone working here

1. **Don't invent mechanics.** The game grows through play. If a build needs a mechanic that isn't decided, stop and ask (with a lean). Don't add claiming, terrain, harvesting, tile properties, etc. by default.
2. **The rules are the game.** Every rule change ships as rule text + enforcing code + tests, together. Never add rule text before the PR that implements it; never add behaviour no rule states. Rules that need judgment call a small model (Haiku/Jev/Flash) behind a test with recorded answers.
3. **Every engine function is claimed by a rule.** Tag it `@rule <n>` (JSDoc). `scripts/check-rule-claims.mjs` (in `npm test`) fails on unclaimed engine code or a tag naming a rule that doesn't exist. Site plumbing (sign-in, email, DB) is claimed by 302 / 102. Repealing a rule means its code is removed or reassigned in the same change.
4. **No margin context in the UI.** No intro paragraphs, captions, eyebrow labels, hint lines or "how this works" asides. If it matters to play, it's a rule; otherwise the UI carries it.
5. **Vocabulary:** moderator (not referee); players "join the game" (not "take a seat"); creatures (hostile / neutral), Blob, Ghost, Crow; "Use this piece" / "Change your piece"; "You" for the center-on-my-piece button.

## Architecture (decided 2026-11-19; detail in docs/step1-plan.md)

- **The game's repo is the game.** Per rule: text in `RULES.md`, code in `rules/<n>.ts` (handlers for engine hooks), tests in `rules/<n>.test.ts`. Settings (`[setting: key]`) are data in `settings.json`, no code.
- **Bundled at deploy.** A Worker can't load code at runtime, so the build fetches each game repo at its latest `day-N` tag, validates it (manifest, allowed paths, lint: no network calls, no imports beyond the engine API), runs its tests, and bundles text + settings + modules. The rulebook served is the bundled text, so it always matches the running code.
- **Shared, dumb engine.** It runs the day loop and calls hooks. Rules never edit each other's code; each registers handlers. Combine modes: `veto` for can-I hooks (any rule may refuse, with a reason naming its rule), `sequence` for effects (rule-number order), `decide` for single values (precedence rule picks; lower number wins). A capability the engine lacks gets a new hook for all games, separately from the rule that needs it. A function claimed by more than 3 rules is a smell: split it into hooks.
- **The moderator** may only touch a game repo's `RULES.md`, `settings.json`, `rules/`, `rulings/`. It runs on Buster's Mac mini (headless Claude Code via launchd), not in the Worker.

## The day (decided 2026-11-19)

- Days run midnight to midnight in the game's time zone. **No early close.**
- **Midnight lock:** from midnight until the previous day is processed, the game is locked on web, API and MCP (no moves, votes, proposals, End turn). Every write route checks the clock itself, not only the cron's flag. The page says the moderator is processing day N.
- A turn: move one space (or change your piece's shape instead), propose one change, vote on each proposal. **End turn is final**; votes can change and a proposal can be withdrawn until midnight or until you End turn.
- Votes are hidden until midnight. **Not voting counts as no** for every mark. The electorate is fixed at the start of the day.
- Proposals: reword a rule or one clause (scope step: whole rule vs clause), add a clause, add a rule (pick a block), repeal, move, lock/unlock (unanimity mark); catalog proposals come with step 3. Code drafts mechanical changes; a small model (Haiku) drafts rewording. The vote mark is stored at confirm.
- **Midnight processing:** count votes (code), roll proposals, apply each passed proposal in order as one commit (text + code + tests) in the game repo, tests must pass, tag `day-N`, deploy, unlock when the deployed version matches. Points (401) when a change takes effect.
- **Failures:** each rule implementation has its own budget (time + effort, a setting). Over budget, or not done by **2 am**, = "not applied", no points, and the proposal goes **back to its owner with the moderator's reason and a suggestion** (split it, simplify it). Two rules that can't both hold: the core (unanimous) one prevails over a majority one, otherwise the **older** one prevails; the other goes back with reasons (a core meta rule).

## Rule text decisions

- 600 (hearts + creatures) and 700 (making things) are **starter rules**, but their text enters a game's RULES.md in the step that ships their code (step 2, step 3).
- 601.4: a player dead for 3 days becomes a **Ghost** (in their color). 601.5: heal 1 heart at the **midnight nearest the actual full moon** in the game's time zone.
- The 29 approved additions/rewordings are in `docs/rules-parity.md` (e.g. 203.4 the lock, 302 rewording + 302.6 unamendable core, 104.3 vs End turn, give-a-heart limits, 501.4 adjacency = 8 neighbours). A rulebook reorganization (blocks, order, renumbering map) is in progress and needs Buster's approval before anyone renumbers.

## Design reference

- The agreed UI is the clickable mockup "Promptocracy Play Mockup" (claude.ai artifact 9fUrG28r7RVxJi9Lu7Q9wo, v32). `docs/spec-checklist.md` is the acceptance checklist derived from it (159 items by step and screen, plus OPEN questions and sample-data items NOT to build). Each PR ticks its items in the PR body and names anything it leaves out.
- Button emphasis: filled = expires or already started; ghost = available, not urgent; link = always available and reversible. One filled button per surface. The move bar shows at most one contextual action.
- Links: rules/clauses are accent pills with the number only (tap = preview, then open, with Back); proposals are ink pills ("P8"); players are pills with their piece + name.

## Build plan

Step 1 (the day loop) is 8 PRs, in order, in `docs/step1-plan.md` section 7. Then step 2 (600), step 3 (700). Planning and the tricky parts (midnight processing, the lock, migrations, rules-as-code) use Opus; implementation and review use Sonnet; Codex reviews every PR.

## Operations

- **Deploy:** merging to main deploys the Worker via Workers Builds. Verify on the live site after.
- **D1 migrations:** back up first, apply to preview, then prod, with the d1-migration skill (`~/chalantbot/repos/skills/d1-migration/`). Never `wrangler d1 export --remote` on a live DB.
- **Secrets:** never print them. Cloudflare token comes from `~/chalantbot/.env` (`CLOUDFLARE_WORKERS_TOKEN`).
- **Game repos:** a game in setup (Rickshaw has one player) can have its starter rules edited directly; once play starts, rules change only by proposal.
