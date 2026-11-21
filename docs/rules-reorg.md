# Promptocracy rulebook: reorganization proposal

> **Update 2026-11-20 (Buster): rule 110 is retired.** No rule is untouchable. Its eight items are ordinary rules with a unanimous mark: sign-in is 102.5, the proposal limit 103.2, hidden votes 104.4, votes counted by code 104.5, the lock 107.1, the deadline 107.6, End turn 202.4 (rule 202 is marked), the day 203.1 (rule 203 is marked). Until an item's engine hook ships, a proposal on it is refused at drafting with "Not wired yet" (`src/lib/proposals.js`, `NOT_WIRED`). 110.2 (numbers the site's code relies on never move) went with it; the claims checker holds the code to the template's numbers. Below is the proposal as it was approved on 2026-11-19.

Sources: draft `RULES_MD` in mockup-v32 (101-708), PARITY G1-G29 (decided text), PLAN section 1, SPEC-CHECKLIST, the live template and Rickshaw `RULES.md`, and today's six decisions. No repo was edited.

**Short answer.** Yes, but the rulebook doesn't need a full rewrite. Blocks 200-700 are fine and keep their numbers. Most of the problems are in two places. The core block mixes the constitution with turn mechanics. And the machinery that makes the game self-amending is spread across a majority block (203.4/203.5), a block that no longer has a job (302), and nowhere at all (conflicts, budgets, what happens to a proposal that isn't applied). The fix is to make block 100 the constitution: how rules change, how the night applies them, how conflicts resolve, and what the site itself guarantees. Then move the turn clauses down to 202, where their duplicates already are.

The organizing principle: **block 100 holds every rule the shared site carries out, plus the rules about rules. Blocks 200 and up hold what each game's own rule modules carry out.** That principle is what decision (6) needs. Platform code is shared by every game, so the numbers it tags with `@rule` must mean the same thing in every game.

---

## 1. Diagnosis

1. **The core block mixes two jobs.** 101, 105 and 106 are the constitution. 103 "Turns" is gameplay, and 202 restates it: 103.2 points to "the parts in rule 202", and 103.1 points to 203 for what a day is. Core text depends on a majority block for its own meaning.
2. **The engine's fixed gates sit in a majority block.** The lock (203.4) and the 2 am deadline (203.5) are in [m] block 200. Meanwhile 302.6, also [m], says no proposal can change them. A majority could repeal 302.6 itself. Text that the site will not let you change is marked as changeable by majority.
3. **Block 300 lost its job.** "Proposals and rulings" holds neither: proposing is in 103, rulings are in 106. After parity, 302 is six clauses about the night pipeline (code and tests, failure, tags, settings, fixed parts) that belong to the constitution.
4. **One outcome, four homes.** "A passed proposal that doesn't take effect" is covered in 104.4 (redraft fails), 104.4 append (can't be applied), 302.3 (tests won't pass) and 203.5 (deadline). Today's decision (1), sending it back to its owner, needs one place, and so does budget decision (2).
5. **There is no conflict rule.** The only precedence in the book is ad hoc (403 "takes precedence over every other rule about winning"). Decisions (3) and (4) have no home.
6. **Rules about the rulebook are scattered.** Numbering (103.5) sits under Turns, and settings tags (302.5) sit under the site. Both are parsed by platform code (`rulebook.js`, `settings.js`), so a majority could reword them in ways the parser won't follow.
7. **104.4 and 104.6 are in Voting but are not about voting.** One is applying a change; the other is a proposal's scope.
8. **Smaller items, all kept for stability:** 607 The moon comes after its users (601.5, 604); 706 Art limits sits three rules from 703 Looks; the intro paragraph repeats G14 ("edited directly before day 1"), which now lives in 203.1.

---

## 2. Proposed outline

Marks: **[u]** unanimous, **[m]** majority. **Core = every rule marked unanimous** (new 105.5). That is block 100, rule 301 and block 600. "=" means the number is unchanged.

### 100. Core rules [u]: the constitution and the site's own machinery
Reason: everything here is either the game governing itself or something the shared platform enforces. Same numbers in every game.

| # | Title | Gist |
|---|---|---|
| 101 = | Follow the rules | Everyone, the moderator included, follows this file on `main`. |
| 102 = | Players | 102.1 who plays; 102.2 invites; 102.3 removal by proposal; 102.4 one unique color (G15). |
| 103 | **Proposals** (was "Turns") | 103.1 plain words, the moderator drafts, confirm, change or cancel; drafting is free (old 103.3 + G9). 103.2 **one confirmed proposal a day**, numbered P1, P2... in confirm order, goes on the next day's ballot (G9 tail, decision 5). 103.3 withdraw before the ballot (G6). 103.4 scope: any number of rules, catalog entries, settings and their code; strictest part sets the votes; passes or fails whole (old 104.6 + G17 302.1). |
| 104 = | Voting | 104.1 = thresholds, non-votes count as no; 104.2 = electorate fixed at day start, dead players and Ghosts excluded (G7, G22); 104.3 = ballot timing, vote until midnight or End turn, change vote (G3, G5); **104.4 votes hidden until midnight** (G4, was 104.7); 104.5 = counted by code. |
| 105 = | Votes needed | 105.1 marks, "change, add or repeal" (G10); 105.2 = own mark; 105.3 = changing a mark; 105.4 = needed votes fixed at confirm (G10); **105.5 core rules defined** (new). |
| 106 = | The moderator | 106.1-106.3 unchanged. |
| 107 | **The night** (new) | 107.1 **midnight lock** (G1, was 203.4); 107.2 apply in proposal order, revision +1 (old 104.4); 107.3 same-rule redraft (old 104.4); 107.4 text, code and tests ship together (G17 302.2); **107.5 budget per change** (decision 2); 107.6 the 2 am deadline (G2, was 203.5); **107.7 not applied: back to the owner** (decision 1, merges 302.3, G11's append and G2's consequences); 107.8 day tag (G17 302.4). |
| 108 | **When rules conflict** (new) | Decisions (3) and (4): rank, then age, then number. Text in section 4. |
| 109 | **Numbers and settings** (new) | 109.1 numbering, repeal and forwarders, and code follows a moved rule (G18 + decision 6); 109.2 `[setting: key]` (G16). |
| 110 | **What no proposal can change** (new, was 302.6) | 110.1 the site's fixed parts; 110.2 numbers the site's code relies on never move. |

### 200. Players and turns [m]: what you do on a day
Reason: the turn and the day's shape, which a majority should be able to tune (time zone, night order, what a turn holds). The site's fixed parts in here are named by 110.

| # | Title | Gist |
|---|---|---|
| 201 = | Game size | At most 8 players `[setting: players.max]`. |
| 202 | Your turn (now in clauses) | 202.1 one turn a day each, everyone at once, no order (old 103.1); 202.2 the parts: move or change your piece, propose one change, vote (old 202 list); 202.3 every part optional, skipping costs nothing (old 103.2); **202.4 End turn is final** (G3, decision 5); 202.5 free actions: items, crafting, giving a heart (old 202 last line). |
| 203 = | Days | 203.1 = midnight to midnight, day 1, setup, time-zone change (G14, G19); 203.2 = the midnight order (G20); 203.3 = the email. (203.4 and 203.5 move to 107.) |
| 204 = | Playing through an AI | Unchanged (the UI and README cite it). |

### 300. Rulings [m] (retitled from "Proposals and rulings")
Reason: kept so that 301, which the UI, DESIGN.md and tests/design.mjs all cite, keeps its number. It is also the home for later rules about challenging the moderator. **Stability over neatness:** folding 301 into core next to 106 would read better, but it is core either way through its own [u] mark.

| 301 = [u] | Overruling the moderator | Unchanged. **302 is retired** (its contents moved to 103.4, 107, 109 and 110) and is not reused. |
|---|---|---|

### 400. Points and winning [m]: unchanged numbers
401 = points only when applied (G11). 402.1 = 100 to win; 402.2 tie goes to whoever was given points first (G12); 402.3 game over (G12). 403 = Paradox, whose precedence claim now works through 108.2.

### 500. The board [m]: unchanged numbers
501.1-501.3 =, 501.4 "next to" and distance (G26); 502 =; 503 =; 504.1 creatures are pieces (G13, G25), 504.2 =, 504.3 one space onto charted tiles, first to move wins the tile (G13); 505 =.

### 600. Hearts and monsters [u]: unchanged numbers, and core
601.1-601.5 (G21-G23), 602 Blob (G25), 603, 604, 605 (G22), 606.1 (G25), 606.2, 606.3, 607 The moon (G24). 607 stays last because 109.1 gives a new rule the next free number. That is the numbering rule doing its job.

### 700. Making things [m]: unchanged numbers
701.1 catalog, 701.2 votes needed, 701.3 ids and "comes with" (G27); 702-703 =; 704.1-704.3 (G29, if taken); 705-706 =; 707 (G28); 708 (G28). **Stability over neatness:** 706 Art limits belongs next to 703, but the mockup cites 704 and 706 three times each, and the order costs readers nothing.

---

## 3. Renumbering map (old -> new)

"Old" is the draft plus the parity targets. Everything not listed is unchanged.

| Old | New | Note |
|---|---|---|
| 103 "Turns" (title) | 103 "Proposals" | same number, new job |
| 103.1 | 202.1 | "(rule 203)" reference kept |
| 103.2 | 202.3 | |
| 103.3 (G9 text) | 103.1 + 103.2 | the drafting sentence goes to .1; "only a confirmed proposal...", the P-number and the ballot go to .2 |
| 103.4 (G6) | 103.3 | |
| 103.5 (G18) | 109.1 | plus a new sentence on code (section 4) |
| 104.4 | 107.2 + 107.3 | "At midnight" dropped: 107 is the night |
| 104.4 append (G11) | 107.7 | merged |
| 104.6 | 103.4 | + "settings, and the code that carries them out" (G17 302.1) |
| 104.7 (G4) | 104.4 | fills the freed slot |
| 105.5 | new | core defined |
| 202 (list) | 202.2 | |
| 202 (free-actions line) | 202.5 | |
| 202 + End turn (G3) | 202.4 | |
| 203.4 (G1) | 107.1 | the lock becomes [u] |
| 203.5 (G2) | 107.6 + 107.7 | the deadline in .6; its consequences in .7 |
| 302 (title + live text) | retired | |
| 302.1 (G17) | 103.4 | |
| 302.2 | 107.4 | |
| 302.3 | 107.7 | |
| 302.4 | 107.8 | |
| 302.5 (G16) | 109.2 | "number" -> "value" (section 4) |
| 302.6 | 110.1 | list widened (section 4) |
| 402 | 402.1 | as G12 already does |
| 701 / 704 | 701.1 / 704.1 | as G27 and G29 already do |

**Unchanged:** 101; 102.1-102.4; 104.1, 104.2, 104.3, 104.5; 105.1-105.4; 106.1-106.3; 201; 203.1-203.3; 204; 301; all of 400, 500, 600 and 700. That is about 65 of 84 rules and clauses.

**Cross-references to update:** 202.2's "rule 103.3" -> 103.1; 203.2's "rule 104.4" -> 107.2; 402.2's "rule 104.4" -> 107.2; 701.3's "rule 104.6" -> 103.4; G2's "(rule 104.4)" -> 107.7; 302.6's "203.4" -> 107.1 and "202" -> 202.4.

**Live repos (old turn model) -> new:** live 103 Turns -> replaced by 103 and 202; live 104 -> 104; **live 105 The moderator -> 106**, as the draft already had; live 202 -> 202.2 + 504.3; live 203 Time (24-hour skip) -> repealed, replaced by 203.1 and 107; live 302 -> retired; the rest stay.

---

## 4. New rule text (exact)

**105.5** Rules marked unanimous, by their block or by their own mark, are the core rules.

**107 The night**

**107.1** From midnight until the moderator has processed the day that just ended, the game is locked: nobody can move, change their piece, vote, propose or end their turn, on the site or through an AI client (rule 204). Play resumes when processing is done.

**107.2** Passed proposals are applied to this file in the order they were proposed. Each one raises the revision of the rule it changes by one.

**107.3** If two passed proposals change the same rule, the moderator redrafts the later one onto the new text. If it no longer makes sense, it is not applied (rule 107.7).

**107.4** Every rule has code and tests that check it. A change to a rule is made with its code and tests in the same step, and all go live together.

**107.5** Each passed proposal has its own budget: the moderator may spend at most 20 minutes [setting: night.apply_minutes] applying it, at medium effort [setting: night.apply_effort]. The budget is separate from the deadline in rule 107.6. A proposal that runs over its budget is not applied (rule 107.7).

**107.6** The moderator has until 2:00 am to process the day. When the deadline passes, every passed proposal not yet applied is not applied (rule 107.7), and play resumes.

**107.7** A passed proposal is not applied if its code and tests can't be made to pass, if it no longer makes sense (rule 107.3), if it runs over its budget (rule 107.5), if a rule that prevails over it stands in the way (rule 108.4), or if the deadline passes (rule 107.6). It gives no points, and rule 602 treats it as not passed. It goes back to its proposer with the moderator's reason and a suggestion, such as splitting it into smaller proposals or simplifying it. The proposer may confirm it again as a later day's one proposal.

**107.8** When a day is processed, the moderator tags the game's files with that day's number, so the rules in effect on any day can be read back.

**108 When rules conflict**

**108.1** Two rules conflict when they can't both be followed. A core rule prevails over a majority rule. Between two rules of the same kind, the older one prevails: the one added first. Amending or moving a rule doesn't make it newer. Between rules added at the same time, like the starter rules, the lower number prevails.

**108.2** A rule that says it prevails over another rule, or gives way to one, is followed, but only within its kind: a majority rule can't prevail over a core rule.

**108.3** A proposal doesn't conflict with the rules it changes. When drafting, the moderator names any other rule the proposal would conflict with, so the proposer can change that rule too.

**108.4** If a passed proposal conflicts with a rule that prevails over it, it is not applied, and the reason names that rule (rule 107.7). If the proposal prevails, it is applied, and the rule it overrides gets a note saying where it gives way.

**108.5** When rules in effect conflict in a case nobody foresaw, the moderator rules by rule 108.1 (rule 106), and the ruling can be appealed (rule 301).

**How (3) and (4) relate.** They are one ordering, not two rules: **rank (core over majority) > an explicit claim within that rank > age > number.** (3) is the main rule. (4) becomes its last tiebreak, and that tiebreak decides every conflict among the starter rules, because they are all the same age. So in early play, "lower number wins" is what players will see. I would not adopt (4) on its own, for three reasons. (a) A new rule could outrank an old one just by being added to a low block, so block choice becomes a power move. (b) Renumbering would change precedence, so a reorganization would be a stealth policy change. (c) "Sent back" only makes sense when the newcomer loses, which needs age. Ordering the blocks from foundational (100) to specific (700) is what makes the number tiebreak sensible. Suber's original Nomic also ranks immutable rules over mutable ones, then uses the lowest number.

**109 Numbers and settings**

**109.1** A new rule gets the next free number in its block. A repealed rule stays in the history and its number isn't used again. A moved rule leaves a note at its old number. Code names the rules it carries out by number, so moving a rule moves those names with it, in the same step (rule 107.4).

**109.2** A value tagged [setting: key] in a rule is the value the game uses for that key. A proposal that changes the value changes the setting. (G16 said "number"; 107.5's effort is a word.)

**110 What no proposal can change**

**110.1** Some parts of the game are run by the site itself, the same in every game, and no proposal can change them, this rule included: signing in, days running midnight to midnight (rule 203.1), one proposal a day (rule 103.2), ending a turn (rule 202.4), hidden votes (rule 104.4), votes counted by code (rule 104.5), the lock (rule 107.1) and the deadline (rule 107.6). Their settings can still be changed. A proposal that would change them is refused when it is drafted.

**110.2** The site's own code carries out rules 102 to 110 and rules 201, 202.4, 203 and 204. These keep their numbers in every game: they may be amended where rule 110.1 allows, but not moved.

---

## 5. Migration

**Order of work.**
1. Land the reorganized full draft as the canonical text: one doc in PR 1 (for example `docs/rules-draft.md`, beside `docs/rules-parity.md`), plus the mockup's `RULES_MD`.
2. Each step PR copies its clauses from that doc, already in the new numbers. Nothing ships in old numbers, so there is nothing to migrate later.
3. Update PLAN, PARITY and SPEC-CHECKLIST with this map, as an appendix, not by rewriting them.

**Template** (`templates/RULES.md`). Replaced clause by clause through the step PRs, the same way PLAN already does it. The format comment gains one line pointing to 109.1. Step 1's 100 block is 101-110 without the step-2 references (601 in 104.2, rule 602 in 107.7, "change their piece" in 107.1). Those words enter with step 2, the same omission PLAN already makes.

**Rickshaw Game 1.** One player, setup. Check `games.status` first (PLAN). While it is `setup`, direct edits are allowed (203.1), so the new numbering goes in with each R-PR as an ordinary commit: no proposals, no forwarders, no P-numbers to fix. 109.1's forwarders only apply from day 1. If Rickshaw has already started, the reorg becomes one proposal under 103.4: unanimous, because it touches core, and with one player that is one vote.

**@rule tags and hooks.** Nothing is tagged yet: the engine doesn't exist, and a grep finds no `@rule` in either repo. So the tags start in the new numbers.
- Tag clauses where a clause exists.
- Platform test: every exported engine function has a tag, and its tags name only numbers in 110.2.
- Game test (`rulebook.test.ts`): every tag in `rules/` resolves to a rule or clause in `RULES.md`.

PLAN section 1 changes like this:

| Hook / gate | Was | Now |
|---|---|---|
| `actionAllowed` | 202 (one move + one proposal), 504 | 202.2, 504.3; one proposal a day becomes an engine gate, 103.2 |
| `voteMark` | 105, 104.6, 105.3 | 105, 103.4 |
| `electorate` / `tally` | 104.2 / 104.1 | unchanged |
| `applyOrder` | 104.4 | 107.2 |
| `onEnacted` / `dayEnd` | 401 / 402, 203.2 | unchanged |
| engine gates | lock 203.4, End turn (none) | lock 107.1, End turn 202.4, hidden votes 104.4, deadline 107.6 |
| `process-day.mjs` | 302.2-302.4, 2 fix attempts | 107.4, 107.5 (budget replaces the fixed attempts), 107.7 (`not_applied` + reason + suggestion), 107.8 |
| new `rank(a, b)` | none | 108.1; used by the moderator's draft-time conflict check |
| `settings.js` / `rulebook.js` | 302.5 / 103.5 | 109.2 / 109.1 |

R-steps: R2 = 202.1-202.4, 203.1, 107.1. R3 = 103.1-103.4, 105. R4 = 104.1-104.5, 107.6, 107.7. R5 = 107.2-107.5, 107.8, 108, 109, 110, 401, 402. R6 = 203.3.

The `not_applied` row needs a `suggestion` text column next to `why` in migration 0006, and the proposer's drafts list needs to show returned proposals.

**Other citations to fix in the PR that touches each one:**
- mockup: "rule 103.2" -> 202.3;
- DESIGN.md: 302 -> 103.4/107;
- tests/design.mjs: 103 -> 103/202.

Citations of 104, 201, 204 and 301 stay.

**Later games.** Renumbering mid-game is a `move` proposal like any other (the schema already has `kind = 'move'`):
- it needs the strictest mark it touches: moving a rule into or out of block 100 needs unanimous (105.1);
- it leaves forwarders (109.1);
- its apply step updates the game's own `@rule` tags and tests in the same commit (107.4);
- it doesn't change precedence, except tiebreaks among same-age rules (108.1);
- it can't move a number in 110.2, because the platform's tags rely on it.

A game's numbering can therefore drift from the template's above 110, and the platform never notices. The template changes only through platform PRs.

---

## Buster must decide (non-blocking; lean first)

1. **(3) + (4) as one ordering:** rank > claim > age > number. Lean: yes. Pure "lower number wins" makes block choice and renumbering into power moves.
2. **Block 600 is [u], so under 108 it is core and outranks the board and points rules.** Lean: keep it. It protects the monster pressure from a majority vote.
3. **108.4 when the proposal wins:** the overridden rule stays, with a note, rather than being amended or "sent back". Lean: yes. A rule in effect has no one to send it back to.
4. **110.1 widened beyond parity's four items** (adds day boundaries, one proposal a day, hidden votes, the deadline). Lean: yes. The site enforces them anyway, so it is honest to refuse such a proposal at drafting, not at 2 am.
5. **The lock and the deadline move into core (107.1, 107.6).** Lean: yes. The cost is that parity's "203.4" becomes 107.1.
6. **A returned proposal, confirmed again, is that day's one proposal.** Lean: yes. It keeps one-a-day absolute, and splitting it takes days anyway.
7. **Budget defaults:** 20 minutes at medium effort. "Effort" here means the moderator's effort level; if you meant fix attempts, the setting becomes `night.apply_attempts` (default 2, which is PLAN's).
8. **302 retired, not reused; 301's block kept as "Rulings".** Lean: yes.
