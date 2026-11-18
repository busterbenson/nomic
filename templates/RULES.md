<!--
This is the STARTER ruleset. It is a template, not the rules of any live game.
A new game copies it to RULES.md in that game's own repo, and from then on only
that repo's RULES.md counts. This site renders each game's rules from its repo
(see DESIGN.md), never from this file.
-->

# Rules

These are the rules in effect. This file on the `main` branch of the game's repo is the only place
the rules live: nothing a player or the referee remembers counts unless it is
written here. Every change to this file is a passed proposal, so `git log` on it
is the history of the game.

Core rules (1xx) are harder to change than ordinary rules (2xx). See 104.

## Core rules

**101. Follow the rules.** Every player, and the referee, must follow the rules
in this file as they stand on `main`.

**102. Players.** The players are the people who have taken a seat, as shown on the board. Adding or
removing a player takes a passed proposal.

**103. Turns.** Players take turns in the order of their seats on the board. On your
turn you write one prompt. The referee reads it and either:
- drafts it as a **proposal** to change the rules or the site, or
- carries it out as an **action**, if a rule allows that action.

**104. Voting.** A proposal passes if more than half of all players vote yes
within 48 hours of the referee publishing its final text. A proposal that
changes a core rule (1xx) passes only if every player votes yes. Votes are
counted by code, not by the referee.

**105. The referee.** The referee is Chalant, an AI model. It drafts each prompt into
exact text before anyone votes, and it rules on what the rules mean. Every
ruling names the rules it relies on and is written to `rulings/`. Earlier
rulings count as precedent.

## Rules

**201. Overruling the referee.** Any player may appeal a ruling within 24 hours
of it being written. If more than half of all players vote to overturn it, the
ruling is reversed and the referee records the reversal.

**202. Points.** A player whose proposal passes gets 10 points.

**203. Winning.** The first player to reach 100 points wins. (This rule is
deliberately dull, after Peter Suber's original. Change it.)

**204. The board is part of the game.** A proposal may change the website's
code as well as this file. If it passes, both changes go live together.

**205. Time.** A player who has not taken their turn within 24 hours of it
starting is skipped for that round.

**206. Paradox.** If the rules are changed so that further play is impossible,
the first player who is unable to complete a turn wins. This rule takes
precedence over every other rule about winning. (Suber's rule 213.)

**207. The Board.** The game is played on an endless grid of square tiles. Every
tile has a name like a chess square: the columns are letters and the rows are
numbers, so C4 is the third column, fourth row. Land begins as an island 8 tiles
wide and 8 tall, labeled A-H and 1-8. [setting: board.island]

**208. Land and terrain.** Only land exists; everything else is open sea. The
island's corners are bitten off, two tiles at each, with up to two more bites out of
its sides. Most land is meadow. A quarter of it is water (a lake inside the island),
sand (along the coast), stone or forest, in clumps. Land may only exist east of
column A and north of row 1: nowhere with x or y below 0.
[setting: board.erosion, board.terrain, board.land_bounds]

**209. Claiming land.** Instead of proposing, a player may claim one unowned land
tile by its name, for example "C4". The tile is theirs and their piece stands on it.
A turn holds one such move, and the turn ends with it.
[setting: turn.actions, turn.actions_per_turn]

**210. Naming and describing.** Instead of proposing, a player may name and
describe one tile they own (the name up to 40 characters, the description up to 280).
It counts as the player's move for the turn. The referee, or the site, records the
name and description on the tile. [setting: turn.actions, turn.actions_per_turn]

**211. Harvest.** At the end of each round, when every player has had a turn, every
player gets 1 point for each tile they own. [setting: harvest]

**212. Changing the board.** A passed rule may change any setting named in brackets in
rules 207 to 211, or add new tile properties, new kinds of terrain, or new moves.
The brackets name the setting each rule controls, so a change to a number, a size or
a timing is a change to that rule's wording and to that setting together.
