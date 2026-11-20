# 4. Judgment and disputes: CFJs, appeals, ratification

Researched 2026-11-20. Suber's initial set has no rules 215 or 216; judgment is 212 and the impossibility rule is 213.

## Summary
- Games differ on who judges: Suber uses the previous player, Agora a judge assigned by an office, BlogNomic a vote of everyone.
- Each has a check: overruling in Suber, reconsideration and "moot" in Agora, the community rejecting a call in BlogNomic. Precedent is advisory almost everywhere.
- The strongest repair tool is ratification after the fact, and Agora's version was narrowed after a crisis.

## Sources
**Suber, 1982** ([initial set](http://web.archive.org/web/2015/http://www.earlham.edu/~peters/writing/nomic.htm))
- 212: "the player preceding the one moving is to be the Judge… Disagreement… may be created by the insistence of any player." "The Judge's Judgment may be overruled only by a unanimous vote of the other players taken before the next turn is begun." "New Judges are not bound by the decisions of old Judges." When "the rules are silent, inconsistent, or unclear… the Judge shall consider game-custom and the spirit of the game."
- 213: if a move's legality "cannot be determined with finality… the first player unable to complete a turn is the winner." 211: the lowest-numbered rule wins a conflict.

**Agora** ([ruleset](https://agoranomic.org/ruleset/slr.txt))
- Rule 991: "Any person… can initiate a Call for Judgement." The Arbitor assigns "any eligible player" as judge, excluding the caller. Rule 591 lists the judgements (TRUE, FALSE, IRRELEVANT, INSUFFICIENT and others).
- Rule 911: a Motion to Reconsider within seven days; with enough support any player can send a judgement to Moot, a public vote to AFFIRM, REMAND or REMIT.
- Rule 217: "the text of the rules takes precedence. Where the text is silent, inconsistent, or unclear, it is to be augmented by game custom, common sense, past judgements, and consideration of the best interests of the game."
- Rule 2202: "A player CAN, without objection, ratify a specified public document." It "CANNOT cause the repeal, amendment, enactment, or mutation of any Rule." Knowingly ratifying a wrong document is the infraction "Endorsing Forgery."
- Rule 1551: ratification makes the gamestate what it would be "if, at the truth time, the gamestate had been minimally modified to make the ratified document as true and accurate as possible", and it "CANNOT occur if it would add inconsistencies between the gamestate and the rules." Rule 2201: some public documents ratify themselves after two weeks without a challenge.
- The Annabel Crisis ([Kerim Aydin, agora-discussion](https://go.mail-archive.com/agora-discussion@agoranomic.org/msg52111.html)): a long-time player's second identity sent "I deregister", and six months later it was held to apply to him. He had been Promotor, so "none of those proposals were ever distributed or adopted." A proposal ratified everything he had done, and the episode "became the case study for self-ratification."

**BlogNomic** ([ruleset](https://wiki.blognomic.com/index.php?title=Ruleset))
- Calls for Judgement are "intended to be used only to resolve disagreements about the interpretation of the Ruleset, to address aspects of the game that need urgent attention, or to address mistakes in gamestate tracking." A CfJ passes by vote like a proposal.
- To uphold an action is "to retroactively declare the attempt to have been successful… even if it were originally illegal"; to reject is the opposite. An enacted Declaration of Victory upholds everything that led to it.
- Ambiguity: interpretations "that would make non-dynastic gameplay nonfunctional or unplayable are ignored in favour of interpretations that leave the game functioning."
- Admins resolve votes, but "a Votable Matter's illegal resolution may be overturned", and an admin who uses access "for the purpose of causing any Orienteer… to gain… gameplay advantage" breaks Fair Play.
- The Emperor can veto proposals but not CfJs. The [shortest dynasty](https://wiki.blognomic.com/index.php?title=The_First_Dynasty_of_Anthony) ended when the veto was used "carelessly" and a CfJ removed the Emperor.

**Early Agora** ([Vlad](https://agoranomic.org/wiki/wiki/Library/Vlad-1999.html)): a judge hostile to the Walrus Scam ruled, "on what many regarded as spurious grounds", that the walruses "never existed", which "increased the ill-will."

## Patterns that worked
- A judge who isn't a party and isn't chosen by the one who benefits.
- A window before a judgement is final, with a public way to challenge it.
- Ratification that can fix the gamestate but never rule text (Agora 2202).
- A list of what a dispute may be about (BlogNomic CfJ scope).
- When text is ambiguous, prefer the reading that keeps the game playable.

## Problems to avoid
- A conflicted or hostile judge.
- Ratification as a back door to rule changes.
- A gamestate that's silently wrong for months (Annabel).
- One decider nobody can review. Suber's unanimous overrule gives the judge too much power in a big group.
- An unchecked power with only social remedies (BlogNomic's veto).

## What it means for Promptocracy
- The moderator applies passed changes. It shouldn't settle ambiguous text on its own authority, so disputes need a different decider and a public challenge window before a contested application goes live. (Library note, not decided.)
- Uphold / Reject is the cleanest repair for an overnight application error: a vote that keeps or reverts one specific application. Copy Agora's limit with it: a repair can fix the gamestate, never change rule text.
- The night log (each change's diff and test result) is the record players would challenge, and over time it becomes precedent.
- Decide what can review a Champion's no-vote change. BlogNomic's veto, and the dynasty its misuse ended, is the cautionary case.
