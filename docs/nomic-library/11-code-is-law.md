# 11. Code is law: automated enforcement, bots and AI moderation

Researched 2026-11-20, in two passes: AI-first and code-enforced games, then the history behind them.

## Summary
- No public game has Promptocracy's full loop (players propose in words, an AI writes the rule as code and tests, it deploys). The closest are prototypes.
- Where rules are code, loopholes are code too; where rules are text, officers and reports keep the state.
- Every system needs a written answer to "when the text and the code disagree, which wins?" Beanstalk is what happens without one.

## AI-first and code-enforced games
- **Patch Notes** ([github.com/joselson/nomic-llm](https://github.com/joselson/nomic-llm)): a daily browser Nomic. Each day every player submits an idea; at night "Claude compiles the ideas into game mechanics written as pure data in a custom DSL"; anonymous vote; the winner "goes live the next day". Each mechanic is simulated before the vote, validation errors go back to the model for retries, and every idea is logged to decide what the rules language should learn next. Its validated language "is the main safety boundary between player ideas and the running game." A prototype, not yet playtested.
- **Nomic Arena** ([github.com/wj-jason/nomic](https://github.com/wj-jason/nomic)): LLM players and a judge LLM; the engine rejects impossible rulings, retries up to three times, then drops what it can't apply; a "human on appeal" judge mode.
- **Jeff Kaufman's GitHub Nomic** ([reports](https://www.jefftk.com/p/nomic-report), [game 2](https://www.jefftk.com/p/nomic-game-2-another-conclusion)): a pull request merges if `validate.py` on master says so; you win by making the build fail with a win message. Game 2 was won by a timing attack on a merge commit's timestamp, and a merge commit can carry changes never in the tested PR. "If I know it's dodgy but I can't exploit it then I shouldn't let anyone else take that opportunity!" It died of review friction.
- **PerlNomic** ([KDE blog, 2006](https://blogs.kde.org/2006/11/06/perlnomic/)): "All of the 'rules' of PerlNomic are written in Perl, and interpreted by perl." Points for accepted patches; no judge, which "sometimes allows for unintended loopholes!" Players built an insurance company and a voting party. Its site no longer resolves.
- **Research:** [NomicLaw](https://arxiv.org/abs/2508.05344) (LLM players "spontaneously form alliances, betray trust"); a May 2026 study of self-amending LLM societies (arXiv 2605.17510; read via a summary) found mid-sized models adapted best, large ones flip-flopped, mixed groups deadlocked.

## Text vs. code
- **Agora keeps text first** ([ruleset](https://agoranomic.org/ruleset/flr.txt)): officers, not bots, keep the state ("Activity is a secured player switch tracked by the Registrar", Rule 2646; the Registrar's weekly report, Rule 2139). In a self-ratification scam a wrong report became official, "causing the gamestate to be updated to match the report" ([ais523](https://agoranomic.org/Herald/theses/html/2010-08-10-ais523.html)).
- **Beanstalk** (April 2022; [analysis](https://medium.com/immunefi/hack-analysis-beanstalk-governance-attack-april-2022-f42788fc821e), [The Register](https://www.theregister.com/2022/04/18/beanstalk_loses_182m_flash_loan/)): an attacker borrowed voting power for one transaction, passed a malicious proposal and drained about $181 million. The one-day delay before emergency actions ran was too short to stop it. Critics called "the code allowed it" a might-is-right defense ([The Tie](https://thetie.io/insights/research/code-is-law)).

## Patterns that worked
- Text and code as one artifact, so there's one thing to read.
- A delay between deciding and doing, long enough for someone to object.
- Simulate or test a change before it's voted on or goes live.
- Check that what deploys is the commit that was tested.

## Problems to avoid
- Code that acts faster than anyone can check.
- No written tie-break for text vs. code.
- Rewards a script can farm; automated players racing human ones.
- Randomness derived from something a player can influence (commit timestamps).

## What it means for Promptocracy
- Promptocracy ships every rule as text + code + tests, and the rulebook served is the bundled text at the same tag as the code, so text and code can't silently drift. A rule should still say which wins if they ever disagree; Agora's text-first answer fits a moderator who can be asked to explain itself. (Library note.)
- The daily cycle is a built-in delay: vote by day, apply at night. Publishing each change's diff and test result before it goes live (the moderator's night log) keeps a window to challenge it. (Library note.)
- Starling and Gremlin are the "simulate before the vote" step in conversational form: the draft slip and the work order show what will change before anyone votes.
- See [rule structure](06-rule-structure.md) and [judgment and disputes](04-judgment-and-disputes.md).
