# 5. Loopholes and scams

Researched 2026-11-20.

## Summary
- Both long-running games tolerate scams with a check: Agora allows them if they cause "minimal disruption"; BlogNomic treats a scam as legitimate only if the players vote FOR its result.
- Prevention is cultural first (declared stances, fair-play rules) and mechanical second (protected core rules, ratification, power levels).
- Every fix adds rule text, and new text is new surface for the next scam.

## Sources
**Agora**
- [Glossary](https://agoranomic.org/glossary.html): "Scams are generally allowed in Agora, as long as the scammers cause minimal disruption to the game. That said, when a scam is occurring most players will try to stop it."
- The Walrus Scam, early 1994 ([Vlad](https://agoranomic.org/wiki/wiki/Library/Vlad-1999.html)): a "Scam to circumvent the Rule prohibiting coercive voting… First of the Great Scams." Walruses were a new currency "turned into Marks 10 ^-31 seconds after their creation", so the vote reward was paid and then vanished. A CFJ ruled they never existed.
- The Black Repeals, April 1994 (same source): a player "made 165 Protoproposals, one for each Rule in the ruleset, each proposing that one Rule be repealed", and won a CFJ that the proposal limit was ineffective. With low turnout, "all the Black Repeals had more FOR votes than AGAINST." CFJ 143 undid them on a narrow ground (the proposals had no titles), and it worked because "no one seriously opposed the decision."
- A Secret Word Contest was scammed by a player who "posted the dictionary, an act that was not well-received"; another 1994 scam filed several hundred CFJs (same source).
- On word-meaning scams ([Favor's thesis](https://agoranomic.org/wiki/wiki/Library/favor.html)): they "are welcomed and relished by some Players, and despised by others."
- Scam-for-win is still alive: "After a successful scam, nichdel and ais523 received wins and ais523 now leads a Junta" ([Agora blog, 2017](https://agoranomic.org/blog/general/2017/05/24/hopefully-weekly.html)).

**BlogNomic**
- Fair Play ([ruleset](https://wiki.blognomic.com/index.php?title=Ruleset)): "A Orienteer should not deliberately exploit bugs or unexpected behaviours in the software running the game." "A Orienteer should not use a Core, Building Blocks, or Appendix rules scam to directly or indirectly cause a Orienteer to achieve victory." "Orienteers should not intentionally introduce scams into the Core Rules or Appendix." "A single person should not control more than one non-Idle Orienteer." "Orienteers should vote against any DoV that relies on having broken a fair play rule."
- [Community Guidelines](https://wiki.blognomic.com/index.php?title=Community_Guidelines): "BlogNomic is specifically a social game that occasionally involves deceit"; critiques should aim "at plays, not players."
- [Imperial Styles](https://wiki.blognomic.com/index.php?title=Imperial_Styles): each dynasty's Emperor declares a stance on scams at the start, from Scam-Friendly to Scam-Averse.
- [The Art of the Scam](https://wiki.blognomic.com/index.php?title=The_Art_of_the_Scam) (a player's essay): "Successful scams are exploitations, not violations." "A scam only truly succeeds if the community would vote FOR it." Its taxonomy: found, text-injection, brute-force, inheritance, forced (the scammer writes the loophole), and timing or admin scams. On cost: Fair Play, Gamestate Tracking and Clarifications are over 40% of the roughly 11,000-word core. On defence: "The best defence against scams is and always has been the community's collective memory."
- Named scams: text injection in the [Second Dynasty of Habanero](https://wiki.blognomic.com/index.php?title=The_Second_Dynasty_of_Habanero); a spell loop that handed a partner the win in the [Third Dynasty of Bucky](https://wiki.blognomic.com/index.php?title=The_Third_Dynasty_of_Bucky). The [victories index](https://wiki.blognomic.com/index.php?title=History_of_victories) defines "Scam: A player exploits the rules in an unexpected manner to achieve victory."

**Automated Nomic** (closest to Promptocracy): Jeff Kaufman's GitHub-run Nomic. [Game 2](https://www.jefftk.com/p/nomic-game-2-another-conclusion) was won by a timing attack on the random source; he wrote that he should have deleted the risky PR: "if I know it's dodgy but I can't exploit it then I shouldn't let anyone else take that opportunity!" In [Game 3](https://www.jefftk.com/p/nomic-game-3) he spotted a win from 1,000 identical "lose a point" pull requests that git didn't treat as conflicts.

## Patterns that worked
- A fence around the shared core: no core scams, no planting them (BlogNomic).
- A stance declared up front, so newcomers know the norm (Imperial Styles).
- A verdict after the fact (a vote on the result) instead of a rule defining "scam". The essay says nobody "has ever articulated a clear concept of what a scam is."
- Undo the scam on a narrow ground and fix the rule, not the player (CFJ 143).
- Moderator-neutrality text.

## Problems to avoid
- Anything automatic (code, timing, random seeds) is a target.
- Defining "scam" in a rule: the definition becomes the next loophole.
- One person, several accounts.
- The moderator's timing advantage.
- Scams that break a mechanic so badly nobody will build on it again.

## What it means for Promptocracy
- The overnight application is the biggest surface: the moderator has the timing edge and its code can have bugs. Rule 107.2 already fixes the order changes apply in, and tests must pass before anything goes live. Publishing each change's diff before it goes live covers the rest.
- A Champion who can change a locked rule without a vote is a built-in scam route. Keep that change away from the Era win and from the veto itself. (Library note, not decided.)
- Agora's "minimal disruption" plus BlogNomic's vote on the result make a workable pair: let a loophole play stand, then let the players uphold or reject it.
- "Only player alive" invites extra accounts. A one-person-one-player rule is worth having before it's needed. (Library note.)
