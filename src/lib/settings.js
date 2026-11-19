// A game's BOARD SETTINGS: the numbers of the board and its moves, as data. The code reads them from
// here and from the game's own `settings` column; it never hard-codes them. templates/RULES.md states
// each one in plain words and names it in brackets ("[setting: board.island]"), and a test keeps the
// two lists identical.
//
// Plain JavaScript (imports only geometry.js) so the Worker (esbuild) and scripts/*.mjs (node) share it.
// A game stores only the settings it changes; the rest come from DEFAULT_SETTINGS.

import { chartOffsets } from "./geometry.js";

export const DEFAULT_SETTINGS = {
  // How many players a game seats. At most 8: there are eight piece colors, and the starting island has
  // 16 spawn spots. This is the ONE seat limit: joining reads it, nothing else caps seats.
  max_players: 8,
  // The starting island, in charted tiles, centred on the origin. Even numbers, so the centre is a seam.
  "board.island": { width: 8, height: 8 },
  // After a move, every tile within this many tiles of the piece is charted, as a square with its four
  // corners cut off (radius 2: a 5x5 square minus corners, 21 tiles).
  "board.chart_radius": 2,
  // How far a piece may move in one move, in tiles.
  "turn.move_distance": 1,
};

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const evenInt = (v, lo, hi) => isInt(v, lo, hi) && v % 2 === 0;

// Each validator returns an error string or null.
const VALIDATORS = {
  max_players: (v) => (isInt(v, 1, 8) ? null : "must be a whole number from 1 to 8"),
  "board.island": (v) => (exactly(v, ["width", "height"]) || (!evenInt(v.width, 4, 16) || !evenInt(v.height, 4, 16) ? "width and height must be even whole numbers from 4 to 16" : null)),
  "board.chart_radius": (v) => (isInt(v, 1, 5) ? null : "must be a whole number from 1 to 5"),
  "turn.move_distance": (v) => (isInt(v, 1, 5) ? null : "must be a whole number from 1 to 5"),
};
function exactly(v, keys) {
  if (!isObj(v)) return "must be an object";
  const extra = Object.keys(v).filter((k) => !keys.includes(k));
  const missing = keys.filter((k) => !(k in v));
  return extra.length ? `unknown key ${extra[0]}` : missing.length ? `missing key ${missing[0]}` : null;
}

// How many tiles a new piece could start on in a fresh island: those whose whole chart shape lies inside it.
// (One function, so the check below and the spawn rule cannot drift: it uses the same shape as a move.)
export function spawnSpots(width, height, radius) {
  const inside = (x, y) => x >= -width / 2 && x < width / 2 && y >= -height / 2 && y < height / 2;
  const off = chartOffsets(radius);
  let n = 0;
  for (let x = -width / 2; x < width / 2; x++) for (let y = -height / 2; y < height / 2; y++) if (off.every(([dx, dy]) => inside(x + dx, y + dy))) n++;
  return n;
}

// Checks a complete settings object. Returns a list of problems (empty = fine).
export function validateSettings(s) {
  if (!isObj(s)) return ["settings must be an object"];
  const errors = [];
  for (const k of Object.keys(s)) if (!Object.hasOwn(VALIDATORS, k)) errors.push(`unknown setting ${k}`);
  for (const k of Object.keys(VALIDATORS)) {
    if (!Object.hasOwn(s, k)) { errors.push(`missing setting ${k}`); continue; }
    const e = VALIDATORS[k](s[k]);
    if (e) errors.push(`${k}: ${e}`);
  }
  // The seats must fit: every player needs a spawn spot on the starting island.
  if (!errors.length) {
    const spots = spawnSpots(s["board.island"].width, s["board.island"].height, s["board.chart_radius"]);
    if (spots < s.max_players) errors.push(`max_players ${s.max_players} does not fit: this island and chart radius leave only ${spots} spawn spots`);
  }
  return errors;
}

// The settings a game runs on: its stored overrides on top of the defaults. A game's stored
// object (or JSON text) may hold only the settings it changes. Anything invalid falls back to the
// defaults for that one setting, so a bad value can never break the board.
export function getSettings(stored) {
  let over = stored;
  if (typeof stored === "string") { try { over = JSON.parse(stored); } catch { over = {}; } }
  if (!isObj(over)) over = {};
  const out = structuredClone(DEFAULT_SETTINGS);
  for (const [k, v] of Object.entries(over)) {
    if (!Object.hasOwn(VALIDATORS, k)) continue;
    const merged = isObj(v) && isObj(DEFAULT_SETTINGS[k]) ? { ...DEFAULT_SETTINGS[k], ...v } : v;
    if (!VALIDATORS[k](merged)) out[k] = merged;
  }
  return out;
}

// Defaults with the island made width x height (what create-game.sh --size writes).
export function settingsForSize(width, height = width, maxPlayers = DEFAULT_SETTINGS.max_players) {
  const s = structuredClone(DEFAULT_SETTINGS);
  s["board.island"] = { width, height };
  s.max_players = maxPlayers;
  return s;
}
