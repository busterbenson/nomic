# Rules

These are the rules of the bundled fixture game. The Worker answers /api/rules from the bundle, not from GitHub.

## 100. Core rules [unanimous]

### 101 Follow the rules
Every player must follow the rules in this file.

## 200. Players and turns [majority]

### 201 Game size
A game has at most 8 players. [setting: max_players]

### 202 Your turn
Moves are closed in the fixture game, which is how the tests know its own module is in charge. [setting: turn.move_distance]

### 204 AI clients
A player may connect an AI client. [setting: mcp_enabled]

## 500. The board [majority]

### 503 The island
The game starts with an 8x8 charted island. [setting: board.island]

### 504 Moving and charting
Charting reaches two tiles. [setting: board.chart_radius]

### 505 New players
New players start on a random unoccupied charted tile.
