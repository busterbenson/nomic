// Board rules that are code constants rather than game settings, each ONE line to flip. Buster decided
// all of them on 2026-11-18; tests/board.mjs pins the current values. They are not named as numbers in
// templates/RULES.md, so they are not settings.
//
// P1  "One space" includes diagonals (any of the 8 neighbours).
// P2  Two pieces can NOT share a tile (a move onto an occupied tile is refused; a spawn picks an unoccupied one).
// P3  A new piece spawns only where the whole chart shape around it is already charted (see spawn in verify.ts).
export const DIAGONAL_MOVES = true;
export const SHARED_TILES = false;
