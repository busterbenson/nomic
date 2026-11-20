# 6. Rule structure: precedence, mutability, paradox

Researched 2026-11-20. Suber's own text couldn't be fetched for this page (his site refused the connection); his precedence rules are quoted from [page 4](04-judgment-and-disputes.md), which read them through the Wayback Machine.

## Summary
- Every Nomic settles conflicts by ranking rules. Suber: immutable beats mutable, then the lower number. Agora replaced the two classes with a numeric Power. BlogNomic resets most rules each dynasty and puts a protected Appendix above everything.
- Paradox, a conflict the rules can't settle, is a real way for games to break, and in Agora a way to win.
- The recurring failure is self-reference: a precedence rule that the rules it ranks can change.

## Sources
- **Suber.** "Immutable rules take precedence over mutable ones" ([Wikipedia](https://en.wikipedia.org/wiki/Nomic)); an immutable rule must be "transmuted" before it can change. 211: the lowest-numbered rule wins a conflict (see page 4).
- **Agora** ([ruleset](https://agoranomic.org/ruleset/slr.txt)): Rule 1030, "In a conflict between Rules with different Power, the Rule with the higher Power takes precedence." Rule 105: "This rule provides the only mechanism by which rules can be created, modified, or destroyed." Rule 2140, "Power Controls Mutability": "no entity with power below the power of this rule can..."
- **BlogNomic** ([ruleset](https://wiki.blognomic.com/index.php?title=Ruleset)): "The Appendix has precedence over any other Rule." "If two contradicting parts have equal precedence, the part with more limited scope applies." A rule is "Each individually numbered and titled block of text." At a new dynasty "the entire Dynastic Ruleset is repealed", except rules the winner keeps.
- **A precedence deadlock** ([Andre's thesis, 1996](https://agoranomic.org/Herald/theses/html/1996-11-13-Andre.html)): rule 1482 ranked rules by Mutability Index; a new rule claimed precedence over 1482 itself. "Both claim to be the winner, and who is to arbitrate? The Rules can't tell you."
- **Anti-deadlock rules** ([Vanyel's thesis](https://agoranomic.org/Herald/theses/html/XXXX-XX-XX-Vanyel.html), quoting an alternative initial set): Rule 109, "The adoption of Rule Changes must never become completely impermissible." Rule 204: if play becomes impossible, the first player unable to take a turn wins.
- **Wins through rule structure** ([ais523's history of wins](https://agoranomic.org/Herald/theses/html/2010-08-10-ais523.html)): CFJ 2650 ruled a self-contradictory contract a genuine paradox win, "only the second genuine win via an actual paradox in Agora's history"; the 2009 Junta amended the "Win by Junta" rule to trigger itself; Proposal 6069 "created a rule that could be made to state anything", enabling a dictatorship.

## Patterns that worked
- One numeric rank (Power) instead of fixed classes, so rules can be promoted and demoted through play.
- Definitions ("rule", "gamestate", what outranks what) kept in a protected section above ordinary rules.
- A narrower-scope tiebreak, so most conflicts settle without a judge.
- A rule that the amendment process itself must always stay usable.

## Problems to avoid
- Precedence rules that the rules they rank can change (Andre's deadlock).
- A rule that "can be made to state anything".
- Rules whose effect depends on order, which a player can sequence to win (Junta 2009).
- Paradox as an accidental end of the game.

## What it means for Promptocracy
- Decided 2026-11-20: no rule is untouchable. The old "what no proposal can change" rule retires and its items become unanimous rules. Marks are Promptocracy's Power: unanimous outranks majority.
- With nothing untouchable, an anti-deadlock rule matters more: proposing and voting must always stay possible. (Library note, not decided.)
- 108 already orders conflicts (core over majority, then older). Agora's rule that a change can't give itself more power than the vote that made it would close the "promote yourself" hole. (Library note.)
- The night's order is a rule (107.2), and the Junta win shows order is an exploit surface. The Champion's no-vote change is the Proposal 6069 shape; bound it away from the veto, the win and the marks themselves. (Library note.)
