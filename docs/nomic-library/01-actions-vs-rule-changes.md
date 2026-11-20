# 1. Actions vs rule changes

Researched 2026-11-19 for Buster's question: how should Nomic handle proposals that don't edit rules and just perform actions?

## Summary
1. Every mature Nomic checked lets a vote change gamestate directly. Only Suber's original doesn't, and it has almost no gamestate beyond points.
2. The usual pattern is one proposal pipeline carrying two kinds of effect: rule change and gamestate change. The scoping clause is always "except as prohibited by other rules."
3. The dangers are retroactivity, ambiguous or compound text, and whoever applies the result gaining an edge. Communities fixed these with explicit bans.
4. Chalant's lean is close to what BlogNomic and Nomic World do, and stricter than Agora.
5. Pick: ACTION as a fixed catalog of coded action types. The vote is the higher of the action type's mark and the strictest rule it touches. No override. Recorded in History.

## Findings by game

**Suber's Nomic (1982)** ([initial rules, archived](https://web.archive.org/web/20231202073855/http://legacy.earlham.edu/~peters/writing/nomic.htm))
- Only rule-changes are proposed. 103: "A rule-change is any of the following: (1) the enactment, repeal, or amendment of a mutable rule; (2) ... amendment of an amendment...; or (3) the transmutation of an immutable rule into a mutable rule or vice versa."
- Other moves are turn actions, such as the die roll in 202. 116: "Whatever is not prohibited or regulated by a rule is permitted ... with the sole exception of changing the rules."
- 107: "No rule-change may have retroactive application." 111 lets players object to proposals that compound "two or more rule-changes."
- 110: an immutable rule beats a conflicting mutable one. 109: transmutation needs unanimity and "must be stated explicitly."
- 108: every proposal is numbered "whether or not the proposal is adopted."
- It has no mechanism for one-off events.

**Agora** ([Short Logical Ruleset](https://agoranomic.org/ruleset/slr.txt), [Swann's history](https://agoranomic.org/wiki/wiki/Library/Swann-1996.html))
- Rule 105 defines rule changes and is "the only mechanism" for changing rules. It says nothing to stop a proposal also changing gamestate.
- Rule 106: a proposal "applies the changes that it specifies in its text, except as prohibited by other rules." If one change can't happen, "that does not preclude the other changes." "A proposal can neither delay nor extend its own effect."
- Override works through power. Rule 2140: nothing with lower power can change a higher-power instrument. A proposal's power is capped by its adoption index.
- Rule 105 voids ambiguity: "Any ambiguity ... causes that change to be void." It also requires the full text to be published 4 to 60 days before it takes effect.
- Routine actions use "Tabled Actions" (Rules 1728 and 2124): With N Support, Without N Objections, With N Agoran Consent, With T notice. Intent is announced and ripens after about four days.
- Rule 2202: ratification without objection "CANNOT cause the repeal, amendment, enactment, or mutation of any Rule." Ratifying a known-wrong document is "the Class 8 Infraction of Endorsing Forgery."
- Rule 2201: retroactive changes "are secured with power threshold 3."
- Rule 1698 blocks any change that would "ossify" Agora or end it.

**BlogNomic** ([Ruleset](https://wiki.blognomic.com/index.php?title=Ruleset), [FAQ](https://wiki.blognomic.com/index.php?title=FAQ))
- One pipeline: a Proposal may "change the Ruleset or Gamestate." It applies as steps; a step that can't apply "immediately ... or at all" is ignored.
- "Core Proposal" is defined over Core rules or Core-defined gamestate, or upholding, reverting or rejecting Core actions. Dynastic is the parallel definition.
- Calls for Judgement are the repair channel, for disputes, urgent issues and "mistakes in gamestate tracking." They can retroactively Uphold or Reject an action.
- Gamestate lives in one tracked place and can "only be applied by editing that data in that place."
- An illegal post "may no longer have any effect on the ruleset or the gamestate."
- Fair play: players "should not use a Core ... scam to directly or indirectly cause a Orienteer to achieve victory."
- The FAQ names "admin advantage" as a known problem with no clean fix: the admin who applies a change can act on it first.

**Nomic World, Rule 107** ([Parsing Proposals](https://nomic.net/deadgames/nomicworld/geoff/107.html))
- The closest published match to ACTION. A proposal is typed blocks (Enact, Repeal, Reenact, Amend, Transmute, Change, plus Emergency, Seconds and Comment).
- Change: "If the game state change specified in the Body does not directly contradict any rules, the game state is changed."
- All or nothing: if any step is impossible, "the game is returned to its state before the first Block."

**Not covered:** PerlNomic and Nomic Chess (a quick search found nothing usable).

## Failure modes and fixes
- **Vague or compound effects:** Suber 111 bans compound proposals, Agora 105 voids ambiguity, Nomic World uses typed blocks with atomic rollback.
- **Retroactivity:** Suber bans it; Agora allows it only at high power and never for rules.
- **Action contradicting a rule:** all four games make it fail.
- **Scam in the foundation:** Agora's "Contests" loophole produced "a half-dozen scams" until one scam barred Contests altogether (Swann). BlogNomic bans Core scams that win outright.
- **Gamestate proposal that awards a win:** no documented case found; plausible, not cited.
- **The applier's edge:** named by BlogNomic, fixed by no one. It matters here, since Chalant applies every change.
- **Irreversible effects:** no explicit rule found; BlogNomic's Revert/Uphold/Reject repair after the fact.

## Recommendation
- **A. No actions:** a one-off is a rule that does the thing and repeals itself. Nothing to build, but clutter and a full rule vote + code review each time.
- **B. ACTION with a fixed catalog (pick):** each action type (revive, grant item, move piece) is defined in rules and code. Safe and testable; players can't ask for something nobody coded.
- **C. ACTION as anything the moderator can implement, with override:** flexible, but Chalant becomes an unreviewable lawmaker and the tests can't cover it.

B in detail:
1. Have action proposals: a resurrection is a move, not a law.
2. Scope: a fixed catalog. Adding an action type is a rule change (text, code, tests) at the Core mark.
3. Votes: the higher of the action type's own mark and the strictest rule it touches (Suber 109/110, Agora 2140).
4. Override: no. An action may only do a transition the rules already allow ("except as prohibited by other rules"). To break a rule, amend it first and act the next day.
5. Timing: at midnight with the count, never retroactive, one action per proposal, all-or-nothing on failure.
6. Core: 103.5, "an action may do only what the game's rules already permit." The catalog sits outside Core.
7. Record: a numbered History entry in the same P-sequence, adopted or not (Suber 108): action type, parameters, votes, before/after state, test id. Not in the rulebook.
8. Applier's edge: publish the diff and test result before midnight.
