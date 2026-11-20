# 3. Voting: thresholds, quorum, abstention, blocs

Researched 2026-11-20. Sources are linked; rule quotes are from each game's primary text. Suber's original is quoted through the Wayback Machine (the Earlham page is gone). Agora quotes are from today's [Short Logical Ruleset](https://agoranomic.org/ruleset/slr.txt), BlogNomic quotes from today's [wiki Ruleset](https://wiki.blognomic.com/index.php?title=Ruleset).

## Summary
- Voting rules start strict and loosen. Suber starts at unanimity and the game switches itself to majority; Agora moved to weighted, tunable thresholds; BlogNomic uses a plain quorum plus a time-based fallback.
- The recurring failure is thin turnout: non-votes and tiny quorums let strange things pass.
- Nearly every long-running game ended up with a rule for players who don't show up.

## Sources
**Suber, 1982** ([initial set](http://web.archive.org/web/2015/http://www.earlham.edu/~peters/writing/nomic.htm))
- 203: "A rule-change is adopted if and only if the vote is unanimous among the eligible voters. If this rule is not amended by the end of the second complete circuit of turns, it automatically changes to require only a simple majority."
- 105: "Every eligible voter must participate in every vote on rule-changes." Voting is a duty, with no abstaining.
- 205 / 207: "An adopted rule-change takes full effect at the moment of the completion of the vote." "Each player always has exactly one vote."
- 210: "Players may not conspire or consult on the making of future rule-changes unless they are team-mates." An early ban on blocs.
- Note 5 explains starting at unanimity: "a kind of social contract in which no player can be overruled until she consents to take the risk by switching to majority rule." Unanimity also leaves nothing to trade, so no logrolling.

**Agora** ([ruleset](https://agoranomic.org/ruleset/slr.txt))
- Rule 955: "The outcome is ADOPTED if F/A >= AI and F/A > 1 (or F>0 and A=0), otherwise REJECTED." AI is the adoption index, a per-proposal threshold from 1.0 to 9.9.
- Rule 1950: the proposer can raise a proposal's AI, never lower it. Rule 106: a new rule's power is the minimum of 4, the proposal's AI and the referendum's AI. How hard a rule is to change follows how many votes made it, which is the nearest thing in any game to Promptocracy's marks.
- Rule 879 (quorum): "2/3 of the number of voters on the referendum that had been most recently resolved… the minimum quorum of an Agoran decision is 2." Quorum follows recent turnout, so it shrinks as the game does.
- Rule 2168: a decision headed for FAILED QUORUM gets its voting period stretched to 14 days, once, and the vote collector posts "a humiliating public reminder naming the slackers."
- Rule 2528: PRESENT is a valid vote. Rule 683: "To 'change' one's vote is to retract eir previous ballot (if any), then submit a new one", only inside the voting period. Rule 2422: voting strength defaults to 3, range 0-15. Rule 2127 allows conditional votes, evaluated at the end of the period.

**BlogNomic** ([ruleset](https://wiki.blognomic.com/index.php?title=Ruleset), [FAQ](https://wiki.blognomic.com/index.php?title=FAQ))
- Quorum is "half the number of Orienteers in that subset, rounded down, plus one." A matter passes if FOR reaches quorum, or after 48 hours with more than one vote and more FOR than AGAINST.
- Your vote is "the last valid voting icon that they have used", so changing it is free until an admin resolves the matter. The author's vote defaults to FOR.
- DEFERENTIAL is a built-in proxy: "an indication of confidence in the Referee", counted as the Referee's vote. It dates from 2003, when players were penalised for not voting and wanted a way to register "their lack of opinion" ([history](https://kevan.org/gndt/bnhistory/round2.html)).
- Dormancy: fewer than four active players puts the game on Hiatus; a player goes idle after 168 hours without activity. The FAQ says quiet dynasties "got quieter and quieter" until someone proposed "I win."

**Vote buying in early Agora** ([Vlad's history, 1999](https://agoranomic.org/wiki/wiki/Library/Vlad-1999.html)): coercive proposals "attempt to bribe voters into passing them by offering rewards to those voting FOR", banned since Proposal 326. The Walrus Scam (page 5) got around the ban.

## Patterns that worked
- A built-in sunset on unanimity (Suber 203).
- Quorum tied to recent turnout (Agora 879), with one extension when quorum fails (Agora 2168).
- Proposals that time out (BlogNomic's 48-hour fallback).
- A player floor below which the game pauses (BlogNomic Dormancy).
- A "defer to the moderator" vote (DEFERENTIAL) instead of a custom proxy system.

## Problems to avoid
- Silence passing things. In Agora's Black Repeals, many players, "concerned with RL duties and assuming they would fail, didn't vote at all", and every repeal had more FOR than AGAINST ([Vlad](https://agoranomic.org/wiki/wiki/Library/Vlad-1999.html)).
- Vote rewards, which turn votes into currency.
- Whoever counts the votes gaining from how they're counted (BlogNomic's admin advantage).
- A quorum players can't see.

## What it means for Promptocracy
- Already decided: not voting counts as no for every mark, votes are hidden until midnight, and the electorate is fixed at the start of the day. That closes the Black Repeals hole: silence can't pass anything.
- Marks behave like Agora's adoption index. Agora's rule that a rule's power is capped by the vote that made it is a ready model if marks ever become more than majority and unanimous.
- Unanimity among 8 is cheap at the start and fragile as players die or go quiet. "Unanimous" means all living players under not-voting-is-no, so one absent player blocks every unanimous change.
- The Champion's change passes unless every living player rejects it. If not voting counts as a rejection there, absent players help the veto; if the veto needs an active rejection, one quiet player lets any Champion change through. A rule should say which. (Library note, not decided.)
- A DEFERENTIAL-style vote would defer to the moderator, which here is Chalant. Don't add one: the moderator shouldn't hold proxy votes. (Library note.)
