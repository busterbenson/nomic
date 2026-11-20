# 2. Points and win conditions

Researched 2026-11-19. Primary sources linked; gaps listed at the end.

Decided since (Buster, 2026-11-20): winning an Era makes the winner Champion, who names the next Era and can change one rule without a vote (even a locked one) unless every living player votes to reject it. The ultimate win is being the only player alive. The recommendations below were written before that.

## Summary
1. Suber's original awards points by die roll, not by voting. Dissent bonuses and proposal penalties are optional extras in its mutable rules. First to 100 wins, and rule 213 makes the first player unable to complete a turn the winner.
2. Suber reportedly made the win rule plain on purpose so players would change it (Wikipedia; his own site was unreachable).
3. BlogNomic and Agora keep going by never letting a win end the game. BlogNomic resets most rules per dynasty; Agora gives the winner a title and carries on.
4. Nomic World shows that points for voting create blocs and deadlocks; raising the threshold stalled a game; "second place wins" changed how people played.
5. Promptocracy's 401 pays only for passing proposals (favors proposal-writing), and 402 ends the game once with nothing after it.

## Sources and key quotes
- Suber 1982 ([foldoc](https://foldoc.org/pub/games/nomic/original), [unseelie](https://unseelie.org/rpg/nomic.html)): 202 "throwing one die once and adding the number of its points on its face to one's score"; 203 unanimity at first; 204 "the players who vote against winning proposals shall receive 10 points apiece" (only once unanimity ends); 206 "the player who proposed it loses 10 points"; 208 "The winner is the first player to achieve 100 (positive) points"; 112 the win state can't change from "achieving n points"; 213 the paradox win, which "takes precedence over every other rule determining the winner". [Wikipedia](https://en.wikipedia.org/wiki/Nomic): the win rule was "deliberately boring so that players will quickly amend it".
- BlogNomic: a Declaration of Victory, then "a new Dynasty begins, with the Victor" ([proposal](https://blognomic.com/archive/core_dynastic_a_sect_is_a_cult_but_is_a_cult_a_sect)); the winner's Ascension Address sets the theme, and "Dynastic rules not listed to be kept are repealed". [Post-dynastic discussion](https://blognomic.com/archive/ascension_update_and_post_dynastic_discussion): what kills dynasties is a dense ruleset, no on-ramp, "no clear goal to aim for", late-game asymmetry. A [proposal cap](https://blognomic.com/archive/proposal_cap) reduced "half-baked proposal ideas" and was "encouraging the quieter players to get involved". [History](https://kevan.org/gndt/bnhistory/round2.html).
- Agora: "may be won, but the game never ends" ([old rules](https://faculty.washington.edu/kerim/agora/rules)); [current ruleset](https://agoranomic.org/ruleset/flr.txt) Rule 2449 awards the Patent Title of Champion; many win routes (2465 Victory by Apathy with a 14-day repeat throttle, 2553 Win by Paradox, 2438 Ribbons).
- Nomic World ([summaries](https://discmaster.textfiles.com/file/11902/2014.06.ftp.cse.unsw.edu.au.tar/ftp.cse.unsw.edu.au/tmp_amd/malcolmr/nomic/articles/summaries.txt)): "The first and greatest focus of legislative activity has been scoring." Game 2 deadlocked: a supermajority + 10 points for voting against passed proposals made a blocking bloc. Game 3: points per judgement call, uncapped. Game 4: points for refusing to second. Game 5/6: a threshold of 5*(P+1) made the game "stretch on and on". Game 6: second place wins.
- [Committee Nomic](https://idraluna-archives.bearblog.dev/play-report-committee-nomic/): dissent points made scores climb too fast; replaced with a gated "magic bean"; a leader tax above 100 (whose missing floor backfired).
- [Sockpuppets](https://jefftkaufman.substack.com/p/nomic-report-sockpuppets-thwarted): fake accounts to reach a supermajority, fixed by self-authored joins.

## Problems and fixes
- Voting/dissent rewards make blocs and blockades (Nomic World 2; Committee Nomic).
- Spam and exploits: cap proposals per player (BlogNomic).
- Runaway leaders: tax above a line, second-place-wins.
- Never-ending: scaled thresholds stalled (Nomic World 5/6); Agora sidesteps by never ending.
- Too fast: cheap points (Committee Nomic, early Nomic World).
- Vote trading: no Nomic rule fix found (Suber 210 banned conspiring; voided online). Manage by design.

## Recommendations for Promptocracy (agent's own ideas, marked)
1. (own idea, after BlogNomic/Agora) Winning ends a ROUND, not the game: a title (Champion), points reset, rules and board carry over, a permanent record of champions.
2. Pay for something other than passing: a small daily random award (Suber's die) plus a smaller pass bonus (5 not 10). Don't pay for dissent (Nomic World 2 deadlock).
3. Keep one proposal a day as the spam cap; no penalty for failed proposals (it punishes quiet players at 8).
4. (own idea) A leader brake only if a runaway shows up; wait for evidence.
Don't change: 403 (paradox win), the plain 100-point race in 402, the one-a-day limit.

## Gaps
Suber's own commentary unreachable (Earlham refused, the Harvard PDF 403); BlogNomic's current ruleset and Wikipedia page 404; nothing found for PerlNomic and B Nomic.
