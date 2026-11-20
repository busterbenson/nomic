// The API a game's rule modules import:  import { defineRule, refuse, ... } from "promptocracy/engine";
// Plain JavaScript with a .d.ts beside it, because Node does not strip types under node_modules and the games'
// tests import this file from there. ADDITIVE ONLY: a name exported here is a promise to every game.
export { defineRule, refuse, effects, HOOKS, ACTION_KINDS } from "./hooks.js";
export { chartOffsets, chartedAround, withinSteps, tileLabel, validCoord } from "../lib/geometry.js";
export { DIAGONAL_MOVES, SHARED_TILES } from "../lib/board-rules.js";
export const ENGINE_VERSION = 1;
