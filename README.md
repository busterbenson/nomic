# nomic

A modern interpretation of the game of nomic, powered by AI.

Nomic is a game where changing the rules is a move. In this version, players
write their turns as plain-language prompts, and an AI referee turns each one
into an exact rule change for the table to vote on, or carries it out if the
rules already allow it. Rules can change the scoring, the turn order, the win
condition, the referee's own powers, and this website.

- `RULES.md`: the rules in effect
- `game.json`: players, markers, scores, whose turn
- `index.html`: the public board, drawn from the two files above
- `DESIGN.md`: how the game works and what is still undecided
