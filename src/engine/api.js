// The API a game's rule modules import:  import { defineRule, refuse, ... } from "promptocracy/engine";
// Plain JavaScript with a .d.ts beside it, because Node does not strip types under node_modules and the games'
// tests import this file from there. ADDITIVE ONLY: a name exported here is a promise to every game.
export { defineRule, refuse, effects, HOOKS, ACTION_KINDS } from "./hooks.js";
export { chartOffsets, chartedAround, withinSteps, tileLabel, validCoord } from "../lib/geometry.js";
export { DIAGONAL_MOVES, SHARED_TILES } from "../lib/board-rules.js";
export const ENGINE_VERSION = 1;

/**
 * An attribute of a catalog entry, the only way rule code reads one: attr(entry, "speed"). The key is a literal a rule defines
 * (the claims check refuses any other), so code reads what a rule defines and never flavor or a made-up name. Undefined when the
 * entry has no such attribute. @rule 703.1, 703.2
 */
export function attr(entry, key) {
  return entry && entry.attrs && Object.hasOwn(entry.attrs, key) ? entry.attrs[key] : undefined;
}
