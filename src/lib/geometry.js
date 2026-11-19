// The board's GEOMETRY: how coordinates are named, which tiles a move charts, and the starting
// island. Plain JavaScript with no imports (apart from board-rules.js, also plain), so the Worker
// (esbuild), scripts (node) and the tests share ONE implementation.
//
// The world is an infinite grid of plain consecutive integers (x, y, z), stored as they are.
// Only the LABELS skip zero, like years (1 BC is followed by 1 AD):
//   columns  ... 3W 2W 1W | 1E 2E 3E ...      x = -1 is 1W, x = 0 is 1E
//   rows     ... 2N 1N | 1S 2S ...             y = 0 is 1N, y = -1 is 1S  (y grows northward)
// So 1W and 1E are neighbours (x = -1 and 0), and so are 1N and 1S (y = 0 and -1).
// A tile reads row first, then column: "3N 2E" is x = 1, y = 2.
// z is the level, labelled the same way: z = 0 (the ground) is 1U, z = 1 is 2U, z = -1 is 1D. Only z = 0 is in use so far.
import { DIAGONAL_MOVES } from "./board-rules.js";

const MAX_COORD = 1_000_000;
export const validCoord = (x, y, z = 0) =>
  [x, y, z].every((n) => Number.isSafeInteger(n) && Math.abs(n) <= MAX_COORD);

// ---- labels -------------------------------------------------------------
export const xLabel = (x) => (x >= 0 ? `${x + 1}E` : `${-x}W`);
export const yLabel = (y) => (y >= 0 ? `${y + 1}N` : `${-y}S`);
// "3N 2E" for x = 1, y = 2.
export const coordLabel = (x, y) => `${yLabel(y)} ${xLabel(x)}`;
// Levels skip zero too: ... 2D 1D | 1U 2U ... (z = -1 is 1D, z = 0, the ground, is 1U).
export const zLabel = (z) => (z >= 0 ? `${z + 1}U` : `${-z}D`);
// The full name of a tile, as the board shows it: "3N 2E 1U".
export const tileLabel = (x, y, z = 0) => `${coordLabel(x, y)} ${zLabel(z)}`;

// "3N 2E" or "3N 2E 1U" (any case, spaces around and between) -> {x, y, z} (z is 0 when not given); null for
// anything else. Zero is not a row, a column or a level.
export function parseLabel(s) {
  if (typeof s !== "string") return null;
  const m = /^\s*([1-9][0-9]{0,6})\s*([NSns])\s+([1-9][0-9]{0,6})\s*([EWew])(?:\s+([1-9][0-9]{0,6})\s*([UuDd]))?\s*$/.exec(s);
  if (!m) return null;
  const r = Number(m[1]), c = Number(m[3]);
  const y = m[2].toUpperCase() === "N" ? r - 1 : -r;
  const x = m[4].toUpperCase() === "E" ? c - 1 : -c;
  const z = m[5] === undefined ? 0 : m[6].toUpperCase() === "U" ? Number(m[5]) - 1 : -Number(m[5]);
  return { x, y, z };
}

// ---- neighbours -----------------------------------------------------------
export const ORTHOGONAL = [[1, 0], [0, 1], [-1, 0], [0, -1]];
export const DIAGONAL = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
export const neighbors = (x, y) => ORTHOGONAL.map(([dx, dy]) => [x + dx, y + dy]);
export const diagonals = (x, y) => DIAGONAL.map(([dx, dy]) => [x + dx, y + dy]);

// Is (tx, ty) within `distance` steps of (x, y), and not the same tile? A step is one tile north, south,
// east or west; with DIAGONAL_MOVES (an open question) a diagonal step counts as one too.
export function withinSteps(x, y, tx, ty, distance, diagonal = DIAGONAL_MOVES) {
  const dx = Math.abs(tx - x), dy = Math.abs(ty - y);
  const steps = diagonal ? Math.max(dx, dy) : dx + dy;
  return steps >= 1 && steps <= distance;
}

// ---- what a move charts ---------------------------------------------------------
// The offsets (dx, dy) of every tile charted around a piece: the square of half-width `radius` with its
// four corners cut off, i.e. tile centres within Euclidean distance radius + 0.5 (2.5 for the default
// radius 2). Radius 2 gives a 5x5 square minus its 4 corners: 21 tiles, the piece's own included.
export function chartOffsets(radius) {
  const out = [], limit = (radius + 0.5) ** 2;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) if (dx * dx + dy * dy <= limit) out.push([dx, dy]);
  return out;
}
export const chartedAround = (x, y, radius) => chartOffsets(radius).map(([dx, dy]) => [x + dx, y + dy]);

// ---- the starting island ---------------------------------------------------------
// A width x height block of charted tiles centred on the origin: for 8 x 8, columns 4W..4E (x -4..3) and
// rows 4N..4S (y 3..-4). Sizes are even so the centre falls on the seam between 1W/1E and 1N/1S.
export function islandCoords(width, height) {
  const out = [], x0 = -width / 2, y0 = -height / 2;
  for (let x = x0; x < x0 + width; x++) for (let y = y0; y < y0 + height; y++) out.push([x, y]);
  return out;
}
