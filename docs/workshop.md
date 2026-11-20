# The Workshop: commissions as tickets, and Gremlin

Spec for Buster's OK (2026-11-20). Nothing here is built. It replaces the larger Workshop mockup (two benches, giving points, plaques) with the simplest version Buster asked for.

## Decided (Buster, 2026-11-20)

- Features are built only into a game's own repo and exist only for that game's players. Players can't propose changes to the platform.
- Everything new (a creature, a tile, an item, a feature like a forum) comes in as a **commission**. Plain rule changes (reword, add, repeal, move, mark) stay ordinary proposals.
- A commission creates a **ticket** that tracks everything about it: a brief, the catalog entries and rules it makes, an estimate, a cost, a log of tasks and progress, and a discussion.
- The Workshop is its own tab (it replaced the Catalog tab, Buster 2026-11-20): the ticket list first, then the catalog's groups. On a desktop the tab keeps room for a chat panel at its side (Gremlin, step 2).
- A live helper, **Gremlin**, builds the brief with the player in real time and answers ticket discussions. He is clearly not Chalant, has a gremlin-y personality, and escalates what he isn't comfortable with to Chalant.
- Gremlin is **not on the board** (Buster 2026-11-20): he is an NPC who lives in the Workshop tab. No creature, no piece, no tile.
- Gremlin **can charge points for a commission or offer it free**, by a generous but sometimes inconsistent logic; 0 by default for simple requests with no rules or code.

## The ticket

One page per commission, opened from the Workshop list or any pill that names it (`W3`).

| Field | What it holds | Who writes it |
|---|---|---|
| Title, number (W1, W2...) | | Gremlin drafts, the player confirms |
| Requester | player pill | |
| State | Draft → Proposed (on the ballot) → Approved (in the queue) → Building → Done; or Refused, Failed, Shelved | the site |
| Brief | what it is and what it does, in plain words | Gremlin, from the conversation |
| Makes | the catalog entries and rules it will add or change, as pills (dimmed until live) | Gremlin drafts, Chalant finalizes at build time |
| Estimate | nights | Gremlin's guess; Chalant can revise once building starts |
| Price | points the requester pays when it passes, with Gremlin's one-line reason ("Free. I like dragons.") | Gremlin |
| Running cost | what it costs the site each month, if anything (most game things cost nothing) | Gremlin, checked by Chalant |
| Tasks | a checklist | Gremlin drafts; Chalant edits, ticks, and adds a one-line log entry each night |
| Log | dated entries: drafted, approved, each night's progress, escalations, done | the site and Chalant |
| Discussion | a thread anyone in the game can post to | players, Gremlin, Chalant |

## The flow

1. **Commission.** On the Workshop tab, "Commission something" opens a draft ticket and a chat with Gremlin. The player describes it; Gremlin asks what he needs to know and fills in the brief, makes, estimate, cost and tasks as they go. Anything impossible (outside the game, against privacy, security or the law, or past the limits) is refused here, with the reason.
2. **Confirm.** The player confirms the ticket at Gremlin's price (they can haggle with him before confirming; the price is final once confirmed, and a player who can't afford it can't confirm). It is one of their proposals for the day (103.2) and goes on tomorrow's ballot, where the ballot row shows the brief, the estimate and the cost.
3. **Vote.** Like any proposal, at the mark of the block it adds to (105).
4. **Pay and queue.** A passed commission's price comes out of the requester's points (spent: it no longer counts toward winning), and the ticket is Approved and joins the queue: first approved, first built.
5. **Build.** Each night, after the night's other changes (107.2), Chalant works the ticket at the front of the queue within the limits: reads the whole thread first, works the tasks, ticks what's done, logs one line, answers the thread.
6. **Done.** When the work is finished and its tests pass, its rules and catalog entries go live together, like any change (107). The ticket shows Done and the History records it.
7. **Failed or shelved.** Three failed nights in a row send the ticket back to its requester with the reason (107.7). A ticket whose estimate grows past 2x its voted estimate goes back on the ballot before more work.

## Gremlin

- **What he does:** the commission chat (step 1) and live replies in ticket threads. He can write only that ticket's draft fields while it's a draft, and only thread posts afterwards. He can't change rules, run anything, build, or change an approved ticket.
- **Model:** Sonnet (judgment matters for sizing and "is this possible"); Haiku stays on the proposal drafter. Prompt caching keeps the repeated context cheap.
- **Context each turn:** the game's rulebook, the catalog, this ticket and its thread, the workshop limits, the Nomic library index, and his persona.
- **Persona:** a little scrappy workshop gremlin. Short sentences, workshop slang, fond of the word "contraption", cheerful about limits. Never promises an outcome, never says something is built, never pretends to be Chalant.
- **Escalation:** when he's unsure (a rules conflict, an estimate he can't size, anything that looks like a loophole), he says so in the thread ("Kicking this upstairs to Chalant.") and marks the ticket **Escalated**. Escalations reach Chalant during the day as a notification on the Mac mini, and Chalant answers in the thread; the night run reads every thread anyway.
- **Limits:** a per-player daily message cap (a setting); player text reaches the model only as data, fenced; no tools beyond writing the ticket fields and a post.

## Gremlin's prices

- Gremlin sets every ticket's price while drafting, in points: 0 for simple things with no rules or code (a new item's art and properties), more for things that need building.
- His logic is generous but a bit inconsistent on purpose. He prices by feel from a loose guide (a few points per night of work), and he can be charmed, grumpy or in a mood. He always gives a one-line reason on the ticket.
- The guide, the mood and the range are in his prompt, with a hard ceiling (a setting) so a mood can't price a ticket out of reach of every player.

## Limits from the world

The site sets how long Chalant can build each night, the most nights one ticket can take, and the game's monthly running-cost budget. They are shown in the Workshop. A proposal can reword the rule that describes them, but no vote changes those numbers.

## Rule text (draft, rules voice; block 800 "The workshop", majority)

**801.1** To add something new to the game (a creature, a tile, an item, or a feature like a forum), you commission it. A commission is one of your proposals for the day (103.2).
**801.2** A commission opens a ticket. Gremlin, the workshop's helper, drafts the ticket with you: what it is, what it makes, how many nights it takes, and what it costs to run.
**801.3** A commission that can't be built within the limits (802) is refused when it's drafted, with the reason.
**802.1** The site sets how long the moderator can build each night, the most nights one ticket can take, and what the game can spend each month to run what it has built. No vote changes those numbers.
**802.2** Nothing the workshop builds can share players' private information, weaken the site's security, break the law, or reach outside this game.
**803.1** A passed commission joins the workshop's queue. The moderator builds the ticket at the front of the queue each night, after the night's other changes (107.2), and logs its progress on the ticket.
**803.2** A ticket's rules and catalog entries go live together when it is finished and its tests pass (107).
**803.3** If a ticket fails 3 nights in a row, it goes back to its requester with the reason (107.7). If its estimate grows past twice what was voted on, it goes back on the ballot.
**801.4** Gremlin sets each commission's price in points when it's drafted, and says why. You pay it when the commission passes; points you pay no longer count toward winning (402). You can't confirm a commission you can't pay for.
**804.1** Anyone in the game can post in a ticket's discussion. Gremlin answers; he can't change an approved ticket, and he hands questions he can't answer to the moderator.

701 (catalog entries) then says a new entry comes in by commission (801).

## What's cut from the bigger design

Two benches, giving points, the points-ordered queue, plaques and ribbon-cuttings, scaffolding art, the cross-game workshop page.

## Build plan (each a PR, in order)

1. **Tickets and threads (platform, migration).** Tables for tickets, tasks, log and posts; the Workshop tab (the ticket list at the top, the catalog under it); the ticket page; posting in a thread; the ballot row for a commission. No Gremlin yet: the requester fills in the brief by hand.
2. **Gremlin (platform).** The commission chat and thread replies on Sonnet, the persona, prices, escalation (with a notification to the Mac mini), the daily cap, the safety fence.
3. **The night (moderator).** Read the queue and threads, work the front ticket, tick tasks, log, answer, go live when done, the 3-failed-nights and 2x-estimate rules.
4. **Rule text (Rickshaw).** Block 800, the 701 change, with the code each clause needs.

Before step 3 can build features like a forum, the platform needs general pieces rules can use: storage, player actions, and views drawn from a small set of building blocks. That's its own PR, between 2 and 3.

## Questions for Buster (lean first)

1. **Price ceiling:** lean 25 points (a quarter of the way to winning), a setting.
2. **Gremlin's daily cap:** lean 30 messages per player a day.
3. **Who can post in a thread:** lean every player in the game; Ghosts and dead players read only.
4. **Can the requester withdraw an approved ticket before it's built?** Lean yes; it goes to Shelved, and the price isn't refunded.
5. **Where Gremlin's tile is:** lean a charted tile next to where the first player started.
