# Promptocracy rules parity

Compares the mechanics the site will enforce (SPEC-CHECKLIST v32, PLAN) with the draft rulebook (the `RULES_MD` in mockup-v32, rules 101-708) and the live Rickshaw `RULES.md`. Numbers below are the draft's. "Step" is the build step that ships the code, so the text ships with it. Pending items (marked **P**) are written both ways; **lean** marks the one I would take.

## 1. Gap table

| ID | Mechanic the site will enforce | Coverage today | Change | Target | Step |
|---|---|---|---|---|---|
| G1 | Midnight lock: no move, piece change, vote, proposal or End turn from midnight until the day is processed (site, API, MCP) | none (203.1 only defines the day) | add | 203.4 | 1 |
| G2 | **P** 2 am deadline: unfinished passed proposals become "not applied", play resumes | none | add (A/B) | 203.5 | 1 |
| G3 | End turn is final; skipped parts are skipped; day still closes at midnight. **P** early close | none; contradicts 104.3 ("vote until midnight") | add + reword | 202, 104.3, 203.1 | 1 |
| G4 | Votes and totals hidden until midnight; who has voted shows; all revealed after | none | add | 104.7 | 1 |
| G5 | **P** change a vote until midnight | 104.3 silent | add (A/B) | 104.3 | 1 |
| G6 | **P** withdraw a confirmed proposal before it reaches the ballot | none | add (A/B) | 103.4 | 1 |
| G7 | **P** electorate fixed at day start (joiners, revived players vote from next day) | 104.1/104.2 silent on timing | add (A/B) | 104.2 | 1 |
| G8 | **P** non-votes count as no, for every mark | 104.1 says it | keep; alt text kept for reference | 104.1 | 1 |
| G9 | Drafting is free; only a confirmed proposal uses the day's one; P-numbers in confirm order; one proposal a day | 103.3 partial | reword | 103.3 | 1 |
| G10 | Needed votes fixed at confirm; adding or repealing a rule needs the block's mark | 105.1 says "change any rule" | reword + add | 105.1, 105.4 | 1 |
| G11 | Points only when a change is applied; a passed change that can't be applied fails (no points; counts as failed for 602) | 401 and 104.4 disagree on what "passes" | reword | 401, 104.4 | 1 (602 part: 2) |
| G12 | Win check order, same-night tie, game over | 402 says "first to reach"; nothing on ties or what follows | add | 402.2, 402.3 | 1 |
| G13 | Moves: one space, charted tiles only, no shared tile, immediate and final, first to move wins the tile | 504.1 (sharing) and 202 (one space); "charted only" was in live 202, dropped in draft | add | 504.3 | 1 |
| G14 | Days numbered from 1; game start; direct edits before day 1 | intro text only | add | 203.1 | 1 |
| G15 | Each player has one color, unique | none | add | 102.4 | 1 |
| G16 | Numbers tagged `[setting: key]` are the game's settings; changing the number changes the setting | none (tags unexplained) | add | 302.5 | 1 |
| G17 | Rule changes ship as text + code + tests; failure with reason; tag per day; platform code is not amendable | contradicts 302 | reword + add | 302.1-302.6 | 1 |
| G18 | Rule numbering: next free number in the block, repeal keeps history, move leaves a forwarder | none | add | 103.5 | 1 |
| G19 | **Non-blocking** timezone change takes effect at next midnight in the old zone | none | add | 203.1 | 3 (low) |
| G20 | Midnight order includes full-moon heal at midnight, neutral creature moves, Ghosts | 203.2 contradicts 601.5 (6 pm) and omits 606 | reword | 203.2 | 2 |
| G21 | Give a heart: next to the dead piece, giver keeps 1 heart, one a day, free of the move, 3-day window | 601.3 omits all but the 3 days | reword | 601.3 | 2 |
| G22 | Ghost: in the dead player's color; player is out of play (no act, no vote, not counted) | 601.4 says "monster"; 104.2 names only the dead | reword | 601.4, 104.2, 605 | 2 |
| G23 | Full-moon heal at the midnight closest to the full moon | contradicts 601.5 (6 pm) | reword | 601.5 | 2 |
| G24 | Moon phases are real; new-moon day, full-moon day defined | 604 uses "new-moon day" undefined | add | 607 | 2 |
| G25 | Hostile creature = monster; Blob is what 602 spawns; neutral creatures are pieces | 504.1, 602, 606.1 use "monster" only | reword | 504.1, 602, 606.1 | 2 |
| G26 | "Next to" (8 neighbours) and straight-line distance for 505, 602, 603, 606 | undefined | add | 501.4 | 2 |
| G27 | Catalog proposals: votes needed, ids (C4, T2, I1), the "comes with" rule passes or fails with the entry | 701 silent | add | 701.2, 701.3 | 3 |
| G28 | Crafting uses pack items; work in progress holds a pack slot; pick-up needs room | 707/708 silent (Q5 lean) | reword | 707, 708 | 3 |
| G29 | Using a piece takes the day's move; describing does not; art-limit failures don't count | 704 ambiguous (optional; 704 is decided) | reword (optional) | 704 | 3 |

## 2. Proposed text

Tags: **Add** = new text; **Reword** shows before then after.

**G1** Add **203.4** "From midnight until the moderator has processed the day that just ended, the game is locked: nobody can move, change their piece, vote, propose or end their turn, on the site or through an AI client (rule 204). Play resumes when processing is done."

**G2 (P)** Add **203.5**.
- A (lean): "The moderator has until 2:00 am to process the day. A passed proposal not applied by then is not applied: it gives no points and counts as failed (rule 104.4). Play resumes, and the proposer may propose it again."
- B: "The game stays locked until the day is processed. If processing fails, the moderator says so and the lock stays on."
Conflict to settle: S1-END-05 says a failed run keeps the lock; PLAN says the lock always ends. A follows PLAN.

**G3** Add to **202**: "A player may end their turn at any time. Ending is final: after it they can't move, change their piece, vote or propose until the next day, and what they hadn't done is skipped."
Reword **104.3** "...may vote yes or no on each one until midnight." to "...until midnight or until they end their turn."
**P** early close, **203.1** last sentence. A (lean): "A day always runs to midnight, even if every living player has ended their turn." B: "If every living player has ended their turn, the day closes at once and rule 203.2 runs."

**G4** Add **104.7** "Nobody sees how anyone voted, or any total, until midnight. During the day everyone can see who has voted on a proposal, and how many have. After midnight every vote is shown."

**G5 (P)** Append to **104.3**. A (lean): "A player may change their vote until midnight, unless they have ended their turn." B: "A vote can't be changed once it is cast."

**G6 (P)** Add **103.4**. A (lean): "The proposer may withdraw a confirmed proposal until it goes on the ballot. A withdrawn proposal doesn't use up the day's proposal." B: "A confirmed proposal can't be withdrawn."

**G7 (P)** Add to **104.2**. A (lean): "The players who may vote on a day, and who count for what a vote needs, are the living players when the day starts. A player who joins or comes back during the day votes from the next day." B: "They are the living players at midnight, when votes are counted (rule 203.2)."
Watch: OPEN-12's lean "a revived player can still vote" contradicts A. With a fixed electorate that player is not in it; I wrote A so the two agree.

**G8 (P)** 104.1 already says "Not voting counts as no" for both marks; keep. If Buster flips it, replace the majority line with: "Majority: more than half of the votes cast, as long as at least half of all living players voted." (Unanimous unchanged.)

**G9** Reword **103.3**. Before: "...and the player confirms the draft. A confirmed proposal goes on the next day's ballot."
After: "...and the player confirms the draft, changes their words, or cancels. Drafting costs nothing: only a confirmed proposal is the player's one proposal for the day. Each confirmed proposal gets the next number (P1, P2, ...) and goes on the next day's ballot."

**G10** Reword **105.1** "...to change any rule in the block." to "...to change, add or repeal any rule in the block." Add **105.4** "The votes a proposal needs are set when it is confirmed, from the marks in effect then." (PLAN's choice, not yet Buster's.)

**G11** Reword **401** to "A player whose proposal passes and is applied gets 10 points when it is applied." Append to **104.4** "A passed proposal that can't be applied fails: it gives no points, and counts as failed in rule 602."

**G12** Add **402.2** "Points are given in the order proposals are applied (rule 104.4). If several players pass 100 on the same night, the first one to be given them wins." Add **402.3** "When a player wins, the game is over. Nothing more can be played; the board, the rules and the history stay readable." Keep the aside in 402.1.

**G13** Reword **504.1**. Before: "Pieces cannot share a tile. Monsters are pieces." After: "Pieces cannot share a tile. Monsters and other creatures are pieces." Add **504.3** "A player's piece moves one space onto a charted tile with no piece on it (rule 202). A move happens the moment the player makes it and can't be undone. If two players want the same tile, the first to move there gets it."

**G14** Add **203.1** second sentence: "The game's first day is day 1, and days are numbered from there. Before day 1 the game is being set up, and the starter rules can be edited directly." What starts the game is unstated in my sources (moderator-enforced, see section 4).

**G15** Add **102.4** "Each player has one color, chosen when they join. No two players have the same color."

**G16** Add **302.5** "A number tagged [setting: key] in a rule is the value the game uses for that key. A proposal that changes the number changes the setting."

**G17** Reword **302**. Before: "A proposal may change the website's code as well as this file. If it passes, both changes go live together."
After:
- **302.1** A proposal may change this file, the settings, and the code that carries out the rules.
- **302.2** Every rule has code and tests that check it. A change to a rule is made with its code and tests in the same step, and all go live together.
- **302.3** If a passed proposal's code and tests can't be made to pass, it fails, and the moderator says why (rule 104.4).
- **302.4** When a day is processed, the moderator tags the game's files with that day's number, so the rules in effect on any day can be read back.
- **302.6** Some parts of the site are not rules and no proposal can change them: who is signed in, the lock (rule 203.4), ending a turn (rule 202), and that votes are counted by code (rule 104.5). A proposal that would is refused. (Buster decides: see section 3, C2.)

**G18** Add **103.5** "A new rule gets the next free number in its block. A repealed rule stays in the history and its number isn't used again. A moved rule leaves a note at its old number." (Number reuse is my inference from "struck and kept in history".)

**G19 (non-blocking)** Add to **203.1**: "If the time zone setting changes, it takes effect at the next midnight in the old zone."

**G20** Reword **203.2**. Before: "...votes are counted and passed changes applied (rule 104.4) and points awarded (rule 401); monsters move and bite (rules 603, 604); players at 0 hearts die; players dead for 3 days become monsters (rule 601); if nothing passed, a monster appears (rule 602). Full-moon healing (rule 601.5) is not part of this order: it happens at 6 pm."
After: "...votes are counted and passed changes applied (rule 104.4), points awarded (rule 401) and the game won if a player has reached the points to win (rule 402); on a full-moon day, living players heal (rule 601.5); monsters move and bite (rules 603, 604) and neutral creatures move (rule 606); players at 0 hearts die; players still dead after 3 days become Ghosts (rule 601.4); if nothing passed, a Blob appears (rule 602)."
Heal goes before bites; that keeps the old effect of a 6 pm heal. My lean.

**G21** Reword **601.3**. Before: "Within 3 days of a death, any living player may give the dead player one of their own hearts. The dead player comes back with 1 heart, where their piece stands."
After: "On any of the 3 days after the day a player died, a living player next to their piece (rule 501.4) may give them one of their own hearts. The giver must keep at least 1 heart and may give only one heart a day. Giving costs no move. The dead player comes back with 1 heart, where their piece stands."

**G22** Reword **601.4** per the decision. Before: "A player still dead 3 days after dying becomes a monster where their piece stands."
After: "A player still dead at the midnight that ends the third day after they died becomes a Ghost where their piece stood: a hostile creature (catalog C2) in their color. The player is then out of play: they stay on the player list but can't act or vote, and don't count as a player for voting, rule 403 or rule 605."
Reword **104.2** "Dead players (rule 601)" to "Dead players and players who have become Ghosts (rule 601)". Reword **605** "every player dead" to "every player dead or a Ghost".

**G23** Reword **601.5**. Before: "At 6 pm in the game's time zone on a full-moon day, every living player heals 1 heart." After: "At the midnight that ends a full-moon day (rule 607), every living player heals 1 heart." (Max 3 still applies, rule 601.1.)

**G24** Add **607 The moon**: "**607.1** The moon's phases are the real ones, worked out from the date. **607.2** A full-moon day, or a new-moon day, is the day (rule 203.1) that ends at the midnight closest to the exact moment of that moon in the game's time zone."

**G25** Reword **606.1**. Before: "A creature marked neutral in the catalog never bites." After: "A creature is hostile unless the catalog marks it neutral. A monster is a hostile creature. A neutral creature never bites." Reword **602** "one monster appears" to "one Blob (catalog C1) appears". This settles OPEN-04 with no mass rename.

**G26** Add **501.4** "Next to means any of the 8 tiles around a tile, diagonals included. A distance in tiles (rules 505, 602, 603, 606) is the straight line from the center of one tile to the center of the other. Rule 606.2 counts living players only." The straight-line choice is mine; 505 already measures center to center.

**G27** Add **701.2** "A catalog proposal needs the votes of block 700 (rule 105)." Add **701.3** "A new entry gets the next number of its kind (C4, T2, I1). A proposal may carry the rule that puts the entry on the board (rule 705); the two pass or fail together (rule 104.6)."

**G28** Reword **708**. Before: "A recipe turns the items it lists into a new item. Crafting is free, with no daily limit. A recipe may take more than one day: its result appears after that many days."
After: "A recipe turns the items it lists, from your pack, into a new item in your pack. Crafting is free, with no daily limit, and you can craft anywhere. A recipe may take more than one day: the work in progress takes one pack slot until it is done, then becomes the new item." Reword **707** last sentence: "Picking up an item on your own tile needs a free slot in your pack. Dropping is free."

**G29 (optional)** Reword **704** into three clauses. **704.1** "A player may ask for at most 3 drawings of a new piece a day. A failed drawing, including one that breaks the art limits (rule 706), doesn't count." **704.2** "Once a day, instead of moving, a player may use a piece they have drawn, new or saved. This takes the day's move." **704.3** "No vote is needed. Color stays the player's own. A player may delete any version except the one in use." Skip if the mockup wording stands as decided.

## 3. Rules that say something the site will not do

- **C1 Live file is the old model.** Live 103 (turns in join order), 104 ("48 hours"), 203 (skip after 24 hours), 202 (prompt per turn) and 104/105 mention "prompt". The draft replaces them; each clause ships in the PR that ships its code. Live 202 carries `[setting: turn.move_distance]`; the draft has no such tag, so `settings.json` must drop it (the rulebook test checks tags against keys).
- **C2 302 promises site code; the plan allows only game rule code.** The moderator may touch only `RULES.md`, `settings.json`, `rules/` and `rulings/`. Fix: G17. **Buster decides** whether to state 302.6. It is the honest version of "the rules are the game" (a proposal can't remove the lock or vote counting).
- **C3 Failed processing.** S1-END-05 keeps the lock after a failure; PLAN unlocks at the deadline. Fix: G2.
- **C4 104.3 vs End turn.** "Vote until midnight" vs "End turn is final". Fix: G3.
- **C5 601.5 vs 203.2.** 6 pm vs midnight. Decided; fix: G20, G23.
- **C6 601.3 vs the checklist.** Rule lets "any living player" give; the site needs adjacency, a floor of 1 heart, once a day. Fix: G21.
- **C7 603.1 vs S2-CRE-05.** The rule says "no other monster closer"; the checklist says "creature". A crow must not shield a player. Build the rule text.
- **C8 403 is unenforceable by code.** "Unable to complete a turn" never happens: every part of a turn is optional (103.2) and End turn exists. List under moderator-enforced; OPEN-15 says do not reword.
- **C9 Ghosts and voting.** S1-VOT-10 says Ghosts don't vote; 104.2 names only the dead. Fix: G22.
- **C10 OPEN-12 lean vs fixed electorate.** See G7.
- **C11 601.2 and 104.2 cite rule 601** though the 600 block ships in step 2. Step 1's RULES.md must omit those clauses (PLAN already says so).
- **C12 Intro and 101 name "the `main` branch" and the repo** while S1-RUL-16 forbids showing a repo link or line. Text is harmless; reword only if OPEN-15 is approved.
- **C13 "Passed" is used three ways** (voted yes, applied, not applied). Fix: G11.

## 4. Moderator-enforced (no code planned)

- 101 Follow the rules; 106.1-106.3 (drafting, drawing the catalog, rulings written to `rulings/`, precedent).
- 102.2 invites and 102.3 removal by proposal: no code until invites ship; PLAN Q9 keeps live 102 until then.
- 301 appeals: code after PR 7. Open: does an appeal use the proposer's one proposal a day? Lean: no, and it has its own ballot row.
- 302 as a whole (the moderator applies it by hand until the tooling exists), 403 Paradox.
- 703 Looks (image model plus tracing) and the judged parts of 706 ("no text or logos", "reads at phone size"); the footprint, height and palette limits are checkable by code.
- Starting the game (status setup to day 1): nothing in my sources says who or what triggers it.

## 5. Left out, and why

Pill and chip styling, button emphasis, toasts, board colors, tile art and dark mode; bell, email wording and digest layout (203.3 already covers that an email exists); the move bar's priority order; history rail, rule-card back stack and counts; hover and keyboard behavior; join page copy and "no GitHub link" (presentation); sample data (X-01 to X-10); the Items preview and Driftwood 709 (a demo rule); LLM-judge test recording (implementation); counts like 10 points or 3 hearts as settings (the clause itself carries the number); crow placement (OPEN-03, 705 already says nothing appears until a rule puts it there); the "propose a change" menu kinds (reword, add, repeal, lock, move are UI over 103.3 and 105.3).

## Buster must decide (all non-blocking; lean first)

1. Early close: no. 2. Non-votes count as no for all marks: yes. 3. Change vote and withdraw proposal: yes, yes. 4. Electorate fixed at day start: yes (and a revived or new player votes next day). 5. 2 am deadline gives "not applied": yes.
Mine, not yet his: stored mark at confirm (G10); tie goes to the first points given (G12); straight-line distance and 8-neighbour "next to" (G26); heal before bites (G20); repealed numbers not reused (G18); appeals don't use the day's proposal; state 302.6 (C2).
