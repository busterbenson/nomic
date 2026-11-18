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

export const ISLAND_SIZE = 8;
export const MIN_SIZE = 4;
export const MAX_SIZE = 16;
export const TERRAINS = ["meadow", "water", "forest", "stone", "sand"];
// Rules (and later the referee) get both kinds of neighbour. Adjacency in the game is orthogonal.
export const ORTHOGONAL = [[1, 0], [0, 1], [-1, 0], [0, -1]];
export const DIAGONAL = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
export const neighbors = (x, y) => ORTHOGONAL.map(([dx, dy]) => [x + dx, y + dy]);
export const diagonals = (x, y) => DIAGONAL.map(([dx, dy]) => [x + dx, y + dy]);

export const validSize = (n) => Number.isInteger(n) && n >= MIN_SIZE && n <= MAX_SIZE;
// The default limit on where land may exist. A game's rules may lift it.
export const landAllowed = (x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0;
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

// The island's outline: a size x size square with each corner eroded by two tiles (the corner and
// one neighbour along an edge), plus 0-2 small bays bitten out of the sides, so it reads as an island.
export function islandLand(size, seed) {
  const rand = rng(seed ^ 0x51ed270b);
  const gone = new Set();
  const last = size - 1;
  for (const [cx, cy] of [[0, 0], [last, 0], [0, last], [last, last]]) {
    gone.add(key(cx, cy));
    const sx = cx === 0 ? 1 : -1, sy = cy === 0 ? 1 : -1;
    gone.add(pickOne(rand, [key(cx + sx, cy), key(cx, cy + sy)]));
  }
  const bays = Math.floor(rand() * 3);
  for (let i = 0, tries = 0; i < bays && tries < 40; tries++) {
    const t = 2 + Math.floor(rand() * (size - 4)); // never next to a corner
    const [bx, by] = pickOne(rand, [[t, 0], [t, last], [0, t], [last, t]]);
    if (gone.has(key(bx, by))) continue;
    gone.add(key(bx, by)); i++;
  }
  const land = [];
  for (let x = 0; x < size; x++) for (let y = 0; y < size; y++) if (!gone.has(key(x, y))) land.push([x, y]);
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

// Returns [{x, y, terrain}] for the island: meadow by default, about a quarter of it not.
// A lake of water tiles INSIDE the island (never on the coast); sand along the coast; forest and
// stone in clumps. Same size and seed, same island.
export function generateTiles(size = ISLAND_SIZE, seed = 1) {
  const rand = rng(seed);
  const land = islandLand(size, seed);
  const set = new Set(land.map(([x, y]) => key(x, y)));
  const isCoast = ([x, y]) => neighbors(x, y).some(([nx, ny]) => !set.has(key(nx, ny)));
  const coast = new Set(land.filter(isCoast).map(([x, y]) => key(x, y)));
  const inner = new Set(land.filter(([x, y]) => !coast.has(key(x, y)) && !isCoast([x, y])).map(([x, y]) => key(x, y)));
  const grid = new Map();
  const budget = Math.round(land.length * 0.25);
  const lake = Math.max(3, Math.round(budget * 0.27));
  const sand = Math.max(3, Math.round(budget * 0.27));
  const stone = Math.max(2, Math.round(budget * 0.18));
  const forest = Math.max(3, budget - lake - sand - stone);
  const free = new Set(set);
  const take = (terrain, want, pool, maxClump) => {
    let left = want, guard = 0;
    while (left > 0 && pool.size && guard++ < 30) {
      const got = growClump(rand, pool, terrain, Math.min(left, maxClump), grid);
      left -= got;
    }
    for (const k of grid.keys()) free.delete(k);
  };
  take("water", lake, new Set([...inner]), lake);
  for (const k of grid.keys()) inner.delete(k);
  // keep sand off tiles beside the lake, so the lake reads as a lake
  take("sand", sand, new Set([...coast].filter((k) => free.has(k))), sand);
  take("stone", stone, new Set([...free]), 3);
  take("forest", forest, new Set([...free]), 5);
  return land.map(([x, y]) => ({ x, y, terrain: grid.get(key(x, y)) || "meadow" }));
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

// The SQL that creates a board's tiles (also used by the Worker's lazy seeding).
// Values are integers and fixed words, so literals are safe.
export function tileInsertSql(gameId, size, seed, nowIso) {
  const rows = generateTiles(size, seed);
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
