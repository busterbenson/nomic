// The board's GEOMETRY: which coordinates are land, who neighbours whom, how a tile is
// named, and the terrain generator. Plain JavaScript with no imports, so the Worker (esbuild)
// and scripts/seed-tiles.mjs (node) share ONE implementation.
//
// The world is an infinite square grid of signed integer coordinates (x, y): x runs east,
// y runs north. Only tiles that are LAND exist as rows in the `tiles` table; everything
// else is open sea. A new game starts with an island on x 0..7, y 0..7. As a default
// (a rule may change it) land can only exist at x >= 0 and y >= 0.
//
// Tiles are named like chess squares: column letters for x (A..Z, then AA, AB, ...) and
// the row number for y + 1, so "C4" is x 2, y 3 and "AA12" is x 26, y 11.

import { DEFAULT_SETTINGS, landAllowed } from "./settings.js";
export { landAllowed };

// Rules (and later the referee) get both kinds of neighbour. Adjacency in the game is orthogonal.
export const ORTHOGONAL = [[1, 0], [0, 1], [-1, 0], [0, -1]];
export const DIAGONAL = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
export const neighbors = (x, y) => ORTHOGONAL.map(([dx, dy]) => [x + dx, y + dy]);
export const diagonals = (x, y) => DIAGONAL.map(([dx, dy]) => [x + dx, y + dy]);

const MAX_COORD = 1_000_000;
export const validCoord = (x, y) => Number.isSafeInteger(x) && Number.isSafeInteger(y) && Math.abs(x) <= MAX_COORD && Math.abs(y) <= MAX_COORD;

// ---- labels -------------------------------------------------------------
export function columnLabel(x) {
  if (!Number.isInteger(x) || x < 0) return null;
  let n = x + 1, s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
// "C4" for x 2, y 3. Coordinates that have no chess name (negative) fall back to "(x, y)".
export function coordLabel(x, y) {
  const c = columnLabel(x);
  return c && Number.isInteger(y) && y >= 0 ? `${c}${y + 1}` : `(${x}, ${y})`;
}
// "c4" / "C4" / "AA12" -> {x, y}, or null. Letters then digits, nothing else; rows start at 1.
export function parseLabel(s) {
  if (typeof s !== "string") return null;
  const m = /^([A-Za-z]{1,4})([1-9][0-9]{0,6})$/.exec(s.trim());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { x: col - 1, y: Number(m[2]) - 1 };
}

// ---- terrain generator --------------------------------------------------
// mulberry32: a tiny seeded PRNG. Deterministic across runtimes.
export function rng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const key = (x, y) => `${x},${y}`;
const pickOne = (rand, arr) => arr[Math.floor(rand() * arr.length)];

// The island's outline: a width x height rectangle with each corner eroded (settings board.erosion),
// plus up to max_bays small bites out of the sides, so it reads as an island.
export function islandLand(width, height, seed, erosion = DEFAULT_SETTINGS["board.erosion"]) {
  const rand = rng(seed ^ 0x51ed270b);
  const gone = new Set();
  const lx = width - 1, ly = height - 1;
  for (const [cx, cy] of [[0, 0], [lx, 0], [0, ly], [lx, ly]]) {
    const sx = cx === 0 ? 1 : -1, sy = cy === 0 ? 1 : -1;
    // the corner, then its neighbours along the two edges, in a random order
    const order = [[cx, cy], ...(rand() < 0.5 ? [[cx + sx, cy], [cx, cy + sy]] : [[cx, cy + sy], [cx + sx, cy]])];
    for (const [x, y] of order.slice(0, erosion.corner_tiles)) gone.add(key(x, y));
  }
  const bays = erosion.max_bays > 0 ? Math.floor(rand() * (erosion.max_bays + 1)) : 0;
  const sideLen = Math.min(width, height);
  for (let i = 0, tries = 0; i < bays && tries < 40; tries++) {
    const [bx, by] = pickOne(rand, [[2 + Math.floor(rand() * Math.max(1, width - 4)), 0], [2 + Math.floor(rand() * Math.max(1, width - 4)), ly], [0, 2 + Math.floor(rand() * Math.max(1, height - 4))], [lx, 2 + Math.floor(rand() * Math.max(1, height - 4))]]);
    if (gone.has(key(bx, by)) || bx < 0 || by < 0 || bx > lx || by > ly || sideLen < 5) continue;
    gone.add(key(bx, by)); i++;
  }
  const land = [];
  for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) if (!gone.has(key(x, y))) land.push([x, y]);
  return land;
}

// Grow one clump of `terrain` from a random tile of `pool`, up to `size` tiles, by annexing
// orthogonal neighbours that are also in `pool`.
function growClump(rand, pool, terrain, size, grid) {
  const keys = [...pool];
  if (!keys.length) return 0;
  const start = pickOne(rand, keys);
  const clump = [start];
  pool.delete(start);
  grid.set(start, terrain);
  while (clump.length < size) {
    const options = [];
    for (const k of clump) {
      const [x, y] = k.split(",").map(Number);
      for (const [nx, ny] of neighbors(x, y)) if (pool.has(key(nx, ny))) options.push(key(nx, ny));
    }
    if (!options.length) break;
    const pick = pickOne(rand, options);
    pool.delete(pick);
    grid.set(pick, terrain);
    clump.push(pick);
  }
  return clump.length;
}

// Returns [{x, y, terrain}] for the island, from the game's seed and its settings (board.island,
// board.erosion, board.terrain, board.land_bounds): the default terrain most everywhere, the other
// kinds in clumps. With the defaults: a lake INSIDE the island, sand along the coast, forest and stone.
// Same seed and settings, same island.
export function generateTiles(seed = 1, settings = DEFAULT_SETTINGS) {
  const rand = rng(seed);
  const { width, height } = settings["board.island"];
  const terrain = settings["board.terrain"];
  const land = islandLand(width, height, seed, settings["board.erosion"]).filter(([x, y]) => landAllowed(x, y, settings));
  const set = new Set(land.map(([x, y]) => key(x, y)));
  const isCoast = ([x, y]) => neighbors(x, y).some(([nx, ny]) => !set.has(key(nx, ny)));
  const coast = new Set(land.filter(isCoast).map(([x, y]) => key(x, y)));
  const inner = new Set(land.filter((t) => !isCoast(t)).map(([x, y]) => key(x, y)));
  const grid = new Map();
  const budget = Math.round(land.length * terrain.share);
  // each kind's `share` is its portion of the non-default land; portions are scaled if they add up to more than 1
  const total = Math.max(1, Object.values(terrain.kinds).reduce((n, k) => n + k.share, 0));
  let used = 0;
  for (const [kind, k] of Object.entries(terrain.kinds)) {
    const want = Math.min(budget - used, Math.max(k.share > 0 ? 2 : 0, Math.round((budget * k.share) / total)));
    const pool = new Set([...set].filter((t) => !grid.has(t) && (k.where === "inner" ? inner.has(t) : k.where === "coast" ? coast.has(t) : true)));
    let left = want, guard = 0;
    while (left > 0 && pool.size && guard++ < 30) left -= growClump(rand, pool, kind, Math.min(left, k.clump), grid);
    used += want - left;
  }
  return land.map(([x, y]) => ({ x, y, terrain: grid.get(key(x, y)) || terrain.default }));
}

// Tile props are a JSON object of at most 4 KB (rules and the referee may put anything in it).
export const MAX_PROPS_BYTES = 4096;
export function validProps(v) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  try {
    return new TextEncoder().encode(JSON.stringify(v)).length <= MAX_PROPS_BYTES;
  } catch {
    return false;
  }
}

// The SQL that creates a board's tiles (also used by the Worker's lazy seeding). Terrain names are
// checked by the settings validator (lowercase words), so literals are safe.
// Values are integers and fixed words, so literals are safe.
export function tileInsertSql(gameId, seed, settings, nowIso) {
  const rows = generateTiles(seed, settings);
  const esc = (s) => String(s).replace(/'/g, "''");
  const out = [];
  for (let i = 0; i < rows.length; i += 40) {
    const vals = rows.slice(i, i + 40)
      .map((t) => `('${esc(gameId)}', ${t.x}, ${t.y}, '${t.terrain}', '${esc(nowIso)}')`)
      .join(", ");
    out.push(`INSERT OR IGNORE INTO tiles (game_id, x, y, terrain, updated_at) VALUES ${vals};`);
  }
  return out;
}
