// A game's BOARD SETTINGS: every number and switch of the board and its moves, as data. The code
// reads them from here and from the game's own `settings` column; it never hard-codes them. A
// future passed rule changes a value (or adds a terrain kind), not code. templates/RULES.md states
// each one in plain words and names it in brackets ("[setting: board.island]"), and a test keeps
// the two lists identical.
//
// Plain JavaScript with no imports so the Worker (esbuild) and scripts/*.mjs (node) share it.
// A game stores only the settings it changes; the rest come from DEFAULT_SETTINGS.

export const DEFAULT_SETTINGS = {
  // How big the starting island is, in tiles. It occupies x 0..width-1, y 0..height-1.
  "board.island": { width: 8, height: 8 },
  // Corners are bitten off so it reads as an island: this many tiles per corner (1 = the corner
  // tile only), plus up to max_bays more tiles bitten out of the sides.
  "board.erosion": { corner_tiles: 2, max_bays: 2 },
  // Terrain: `default` covers most of the land; `share` of the land is made of the other kinds,
  // each taking `share` of that (in order), in clumps of up to `clump` tiles. `where` is "inner"
  // (never on the coast, so a lake is a lake), "coast", or "any". A rule may add a kind here.
  "board.terrain": {
    default: "meadow",
    share: 0.25,
    kinds: {
      water: { share: 0.27, where: "inner", clump: 4 },
      sand: { share: 0.27, where: "coast", clump: 4 },
      stone: { share: 0.18, where: "any", clump: 3 },
      forest: { share: 0.28, where: "any", clump: 5 },
    },
  },
  // Where land may exist on the endless grid (null = no limit). The default is the north-east
  // quadrant: x >= 0 and y >= 0.
  "board.land_bounds": { min_x: 0, min_y: 0, max_x: null, max_y: null },
  // The moves a player may make INSTEAD of proposing.
  "turn.actions": { claim: true, describe: true },
  // How many such moves a turn holds. The turn ends with the last one.
  "turn.actions_per_turn": 1,
  // Points for owned tiles: points_per_tile each, at "end_of_round" (everyone, when the turn order
  // wraps) or "end_of_turn" (the player who just moved).
  harvest: { points_per_tile: 1, when: "end_of_round" },
};

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isNum = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const NAME = /^[a-z][a-z0-9_-]{0,19}$/;
const orNull = (v, f) => v === null || f(v);

// Each validator returns an error string or null.
const VALIDATORS = {
  "board.island": (v) => (exactly(v, ["width", "height"]) || (!isInt(v.width, 4, 16) || !isInt(v.height, 4, 16) ? "width and height must be whole numbers from 4 to 16" : null)),
  "board.erosion": (v) => (exactly(v, ["corner_tiles", "max_bays"]) || (!isInt(v.corner_tiles, 1, 3) || !isInt(v.max_bays, 0, 4) ? "corner_tiles must be 1 to 3 and max_bays 0 to 4" : null)),
  "board.terrain": (v) => {
    const e = exactly(v, ["default", "share", "kinds"]);
    if (e) return e;
    if (typeof v.default !== "string" || !NAME.test(v.default)) return "default must be a terrain name (lowercase letters, digits, - and _)";
    if (!isNum(v.share, 0, 0.6)) return "share must be a number from 0 to 0.6";
    if (!isObj(v.kinds)) return "kinds must be an object";
    for (const [name, k] of Object.entries(v.kinds)) {
      if (!NAME.test(name) || name === v.default) return `terrain kind "${name}" is not a valid new name`;
      if (!isObj(k) || exactly(k, ["share", "where", "clump"])) return `kind "${name}" needs exactly share, where and clump`;
      if (!isNum(k.share, 0, 1) || !["inner", "coast", "any"].includes(k.where) || !isInt(k.clump, 1, 12)) return `kind "${name}": share 0 to 1, where inner|coast|any, clump 1 to 12`;
    }
    return null;
  },
  "board.land_bounds": (v) => exactly(v, ["min_x", "min_y", "max_x", "max_y"]) ||
    (!["min_x", "min_y", "max_x", "max_y"].every((k) => orNull(v[k], (n) => isInt(n, -1000000, 1000000))) ? "bounds must be whole numbers or null"
      : (v.min_x !== null && v.max_x !== null && v.min_x > v.max_x) || (v.min_y !== null && v.max_y !== null && v.min_y > v.max_y) ? "a minimum is above its maximum" : null),
  "turn.actions": (v) => exactly(v, ["claim", "describe"]) || (typeof v.claim !== "boolean" || typeof v.describe !== "boolean" ? "claim and describe must be true or false" : null),
  "turn.actions_per_turn": (v) => (isInt(v, 1, 10) ? null : "must be a whole number from 1 to 10"),
  harvest: (v) => exactly(v, ["points_per_tile", "when"]) || (!isInt(v.points_per_tile, 0, 100) || !["end_of_round", "end_of_turn"].includes(v.when) ? "points_per_tile 0 to 100, when end_of_round or end_of_turn" : null),
};
function exactly(v, keys) {
  if (!isObj(v)) return "must be an object";
  const extra = Object.keys(v).filter((k) => !keys.includes(k));
  const missing = keys.filter((k) => !(k in v));
  return extra.length ? `unknown key ${extra[0]}` : missing.length ? `missing key ${missing[0]}` : null;
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
export function settingsForSize(width, height = width) {
  const s = structuredClone(DEFAULT_SETTINGS);
  s["board.island"] = { width, height };
  return s;
}

// Where land may exist, from the settings.
export function landAllowed(x, y, settings = DEFAULT_SETTINGS) {
  const b = settings["board.land_bounds"];
  return Number.isInteger(x) && Number.isInteger(y) &&
    (b.min_x === null || x >= b.min_x) && (b.max_x === null || x <= b.max_x) &&
    (b.min_y === null || y >= b.min_y) && (b.max_y === null || y <= b.max_y);
}
