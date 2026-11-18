// The island board, drawn two ways from the same data (GET /<slug>/api/board):
//   WebGL (three.js, in board-gl.js) when the browser has it, and a flat SVG map when it does not.
// Both are an ISOMETRIC view of square tiles at one fixed angle (2:1 dimetric), looking north-east
// from the south-west: x (east) runs up and to the right, y (north) up and to the left, so A1 is the
// corner nearest you. Both give the same small interface, so board.html does not care which it got:
//   const b = await createBoard(container, { onSelect(x, y) })   // onSelect(null, null) = tapped the sea
//   b.mode                'webgl' | 'svg'
//   b.setData(board)      redraw from an /api/board reply
//   b.select(x, y)        highlight a tile (null clears)
//   b.screenPos(x, y)     page coordinates of a tile's centre (tests use this to click it)
//   b.recenter()          back to the whole island in view (WebGL pans and zooms; the SVG is always whole)
//   b.refreshTheme()      re-read /theme.css (the colors changed, e.g. dark mode)
import { readTheme, shade } from "/js/theme.js";

export const HALF = 0.48;                 // half the side of a tile, leaving a thin gap between tiles
export const ELEV_DEG = 30;               // 2:1 dimetric: a square reads as a diamond twice as wide as tall
export const SLAB = { meadow: 0.28, forest: 0.28, water: 0.12, stone: 0.36, sand: 0.22 };
export const SLAB_DEPTH = 0.35;           // slabs run this far below the sea so the island has an edge
const COS = Math.cos((ELEV_DEG * Math.PI) / 180), SIN = Math.sin((ELEV_DEG * Math.PI) / 180);
const R2 = Math.SQRT1_2;
// The one place a tile coordinate becomes a place on screen (SVG; the WebGL camera does the same).
// right = (x - y) / sqrt2, up = (x + y) / sqrt2 * sin(e) + z * cos(e), z = height above the sea.
export const project = (x, y, z = 0) => [(x - y) * R2, (x + y) * R2 * SIN + z * COS];

export function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch { return false; }
}

export async function createBoard(container, handlers) {
  if (hasWebGL()) {
    try {
      const m = await import("/js/board-gl.js");
      return m.createGLBoard(container, handlers);
    } catch (e) {
      console.warn("WebGL board unavailable, drawing the flat map instead:", e);
      container.replaceChildren();
    }
  }
  return createSvgBoard(container, handlers);
}

const NS = "http://www.w3.org/2000/svg";
const el = (name, attrs = {}, parent) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};
const pts = (list) => list.map(([a, b]) => `${a.toFixed(3)},${(-b).toFixed(3)}`).join(" ");

function pawn(parent, sx, sy, hex, ink, scale = 1) {
  const g = el("g", { transform: `translate(${sx} ${-sy}) scale(${scale})`, "pointer-events": "none" }, parent);
  el("ellipse", { cx: 0, cy: 0.03, rx: 0.3, ry: 0.12, fill: ink, opacity: "0.55" }, g);
  el("path", { d: "M-0.22 0 Q-0.13 -0.5 0 -0.5 Q0.13 -0.5 0.22 0 Z", fill: hex, stroke: ink, "stroke-width": "0.04" }, g);
  el("circle", { cx: 0, cy: -0.64, r: 0.18, fill: hex, stroke: ink, "stroke-width": "0.04" }, g);
}

export function createSvgBoard(container, { onSelect } = {}) {
  container.dataset.renderer = "svg";
  const svg = el("svg", { class: "hex-svg", role: "img", "aria-label": "Island board (flat map). The same tiles are listed below the board for keyboard and screen reader use." });
  svg.style.cssText = "width:100%;height:100%;display:block";
  container.appendChild(svg);
  let theme = readTheme(), selected = null, last = null;
  const centers = new Map();

  function setData(board) {
    last = board;
    centers.clear();
    svg.replaceChildren();
    const S = board.size, benched = board.pieces.filter((p) => !p.at);
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const t of board.tiles) for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      for (const z of [-SLAB_DEPTH, 1]) {
        const [px, py] = project(t.x + dx * HALF, t.y + dy * HALF, z);
        minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, -py); maxY = Math.max(maxY, -py);
      }
    }
    const pad = 1.0, benchH = benched.length ? 1.5 : 0;
    svg.setAttribute("viewBox", `${minX - pad - 0.8} ${minY - pad} ${maxX - minX + 2 * pad + 1.6} ${maxY - minY + 2 * pad + benchH}`);
    const g = el("g", {}, svg);
    const order = [...board.tiles].sort((a, b) => (b.x + b.y) - (a.x + a.y));
    for (const t of order) {
      const base = theme.terrain[t.terrain]?.color || theme.terrain.meadow.color;
      const h = SLAB[t.terrain] ?? 0.28, x = t.x, y = t.y;
      const P = (dx, dy, z) => project(x + dx * HALF, y + dy * HALF, z);
      // the two faces you can see (south and west), then the top
      el("polygon", { points: pts([P(-1, -1, h), P(1, -1, h), P(1, -1, -SLAB_DEPTH), P(-1, -1, -SLAB_DEPTH)]), fill: shade(base, 0.7) }, g);
      el("polygon", { points: pts([P(-1, -1, h), P(-1, 1, h), P(-1, 1, -SLAB_DEPTH), P(-1, -1, -SLAB_DEPTH)]), fill: shade(base, 0.82) }, g);
      const on = selected && selected.x === x && selected.y === y;
      const top = el("polygon", {
        points: pts([P(-1, -1, h), P(1, -1, h), P(1, 1, h), P(-1, 1, h)]), fill: base,
        stroke: on ? theme.select : t.owner ? t.owner.color.hex : "rgba(0,0,0,.18)",
        "stroke-width": on ? 0.09 : t.owner ? 0.12 : 0.02, "stroke-linejoin": "round",
        "data-x": x, "data-y": y, style: "cursor:pointer",
      }, g);
      top.addEventListener("click", () => onSelect && onSelect(x, y));
      const [cx, cy] = project(x, y, h);
      centers.set(`${x},${y}`, [cx, cy, top]);
      const deco = (dx, dy) => project(x + dx, y + dy, h);
      if (t.terrain === "forest") for (const [dx, dy] of [[-0.18, -0.12], [0.2, 0.1], [-0.05, 0.22]]) { const [a, b] = deco(dx, dy); el("path", { d: `M${a - 0.12} ${-b} L${a} ${-b - 0.36} L${a + 0.12} ${-b} Z`, fill: theme.decorForest, "pointer-events": "none" }, g); }
      if (t.terrain === "stone") for (const [dx, dy, r] of [[-0.14, 0.04, 0.13], [0.16, -0.1, 0.1]]) { const [a, b] = deco(dx, dy); el("circle", { cx: a, cy: -b - r * 0.6, r, fill: theme.decorStone, "pointer-events": "none" }, g); }
      if (t.terrain === "water") { const [a, b] = deco(0, 0); el("path", { d: `M${a - 0.25} ${-b} q0.125 -0.09 0.25 0 t0.25 0`, stroke: "#e9f4fb", "stroke-width": 0.04, fill: "none", "pointer-events": "none" }, g); }
      if (on) top.parentNode.appendChild(top);
    }
    const gp = el("g", {}, svg);
    benched.forEach((p, i) => pawn(gp, (i - (benched.length - 1) / 2) * 0.95, -(maxY + pad * 0.5 + 0.7), p.color.hex, theme.pawnInk, 1.2));
    for (const p of board.pieces) if (p.at) { const t = board.tiles.find((u) => u.x === p.at.x && u.y === p.at.y); const [a, b] = project(p.at.x, p.at.y, SLAB[t?.terrain] ?? 0.28); pawn(gp, a, b - 0.02, p.color.hex, theme.pawnInk, 1.25); }
    // faint edge labels: A-H along the south edge, 1-8 along the west edge, and the selected tile's name
    const lab = (txt, a, b, extra = {}) => { const t = el("text", { x: a, y: -b, "text-anchor": "middle", "font-size": 0.42, fill: theme.label || "currentColor", opacity: 0.55, "pointer-events": "none", ...extra }, g); t.textContent = txt; };
    const colName = (x) => board.tiles.find((t) => t.x === x && t.label)?.label.replace(/[0-9]+$/, "");
    for (let x = 0; x < S; x++) { const [a, b] = project(x, -0.95, 0); lab(colName(x) || "", a, b - 0.2); }
    for (let y = 0; y < S; y++) { const [a, b] = project(-0.95, y, 0); lab(String(y + 1), a - 0.15, b - 0.1); }
    if (selected) { const t = board.tiles.find((u) => u.x === selected.x && u.y === selected.y); const c = centers.get(`${selected.x},${selected.y}`); if (t && c) lab(t.label, c[0], c[1] + 0.9, { "font-size": 0.38, opacity: 1, "font-weight": "bold" }); }
  }
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const onScheme = () => { theme = readTheme(); if (last) setData(last); };
  mq.addEventListener?.("change", onScheme);
  return {
    mode: "svg",
    setData(b) { setData(b); },
    select(x, y) { selected = x == null ? null : { x, y }; if (last) setData(last); },
    screenPos(x, y) { const c = centers.get(`${x},${y}`); const b = c?.[2].getBoundingClientRect(); return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null; },
    recenter() {},
    refreshTheme: onScheme,
    destroy() { mq.removeEventListener?.("change", onScheme); svg.remove(); },
  };
}
