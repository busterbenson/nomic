# 8. Game state and economies: ledgers, currencies, contracts

Researched 2026-11-20.

## Summary
- Nomics keep state in one defined place (a wiki page, an officer's report) and say that nothing outside it counts.
- Agora's economy is many currencies, each defined by a rule, some reset on a schedule so nobody hoards.
- Contracts let players trade, and they are the main route to scams.

## Sources
- **BlogNomic** ([FAQ](https://wiki.blognomic.com/index.php?title=FAQ), [ruleset](https://wiki.blognomic.com/index.php?title=Ruleset)): "The 'game pieces' of BlogNomic are known as gamestate." Changes are made by editing the place where the gamestate is tracked. "The Ruleset and Gamestate can only be altered in manners specified by the Ruleset." The Appendix: gamestate is "Any information which the Ruleset regulates the alteration of." Some values are "tracked privately by the Referee" ([front page](https://blognomic.com/)).
- **Agora's assets** ([ruleset](https://agoranomic.org/ruleset/slr.txt)):
  - Rule 2555, Blots: "an indestructible fixed currency with ownership restricted to persons."
  - Rule 2166: "The rules collectively have Mint Authority. Contracts have Mint Authority." "An asset defined by rule or regulation is public; any other asset is private."
  - Rule 2690, Spendies: "At the beginning of each month, every player is granted 20 Spendies", and "At the end of each month, all Spendies are destroyed." They are "tracked by the Spendor in eir weekly report": an officer owns the ledger and publishes it.
  - Rule 2659, Stamps: "Any player CAN pay a fee of 5 Spendies to grant emself X stamps of eir own type."
  - Rule 2499, Welcome Packages: a new player may gain "15 spendies, if e has not been granted any spendies since e last registered."
  - Rule 1742, contracts: "It is IMPOSSIBLE for a person to become a party to a contract without eir consent."
- **Economy scams** ([ais523's history of wins](https://agoranomic.org/Herald/theses/html/2010-08-10-ais523.html)): Clout (2009) used "four different submarine contracts" to outvote everyone; Solitude (2009) used contracts to idle or restrict every other active player; High Score (2009) used a deliberately false report that ratified itself.

## Patterns that worked
- One named place for state, and a rule that anything outside it doesn't count.
- A sink: Spendies are destroyed every month.
- Assets defined by rule are public by default.
- Each ledger owned by an officer who reports on a schedule.
- No contract without consent.

## Problems to avoid
- Mint authority in too many hands (contracts minting was how Agora's scams worked).
- Reports that become true by default.
- Currency that buys votes or rule power (Clout): economic strength turns into control of the rules.
- Hidden state the moderator can't audit.

## What it means for Promptocracy
- The site's database is the one ledger, the moderator applies changes to it only through rule code with tests, and the History page is the published report. That is BlogNomic's model.
- Points are already the currency. Decide explicitly that points never buy votes or change marks. (Library note, not decided.)
- Any economy (step 3's catalog of items) should arrive with a sink. (Library note.)
- Contracts, if they ever come, are the most likely scam path; limit them to moving points or items, never rules or votes. (Library note.)
- No source covered an economy added mid-game; treat that as untested.
