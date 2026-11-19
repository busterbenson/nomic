// The board, drawn two ways from the same data (GET /<slug>/api/board):
//   WebGL (three.js, in board-gl.js) when the browser has it, and a flat SVG map when it does not.
// Both are an ISOMETRIC view of blank square tiles at one fixed angle (2:1 dimetric), looking north-east
// from the south-west: x (east) runs up and to the right, y (north) up and to the left. Coordinates are NOT
// drawn by default: a tile's name ("3N 2E") shows on hover (mouse), on right-click, and on long-press (touch).
// Both renderers give the same small interface, so board.html does not care which it got:
//   const b = await createBoard(container, { onSelect(x, y) })   // onSelect(null, null) = tapped the sea
//   b.mode                'webgl' | 'svg'
//   b.setData(board)      redraw from an /api/board reply
//   b.select(x, y)        highlight a tile (null clears)
//   b.screenPos(x, y)     page coordinates of a tile's centre (tests use this to click it)
//   b.recenter()          back to the whole charted area in view (WebGL pans and zooms; the SVG is always whole)
//   b.refreshTheme()      re-read /theme.css (the colors changed, e.g. dark mode)
import { readTheme, shade } from "/js/theme.js";

export const HALF = 0.48;                 // half the side of a tile, leaving a thin gap between tiles
export const ELEV_DEG = 30;               // 2:1 dimetric: a square reads as a diamond twice as wide as tall
export const SLAB = 0.28;                 // every tile is the same blank slab
export const SLAB_DEPTH = 0.35;           // slabs run this far below the sea so the board has an edge
export const LONG_PRESS_MS = 500;
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

// The coordinate tag shared by both renderers: one small label for the hovered tile (mouse) and one for a
// tile pinned by right-click or long-press. `labelOf(key)` -> "3N 2E" | undefined; `posOf(key)` -> {x, y}
// in container pixels (the tag sits above that point) | null. Call update() whenever tiles move on screen.
export function makeTagger(container, labelOf, posOf) {
  const overlay = container.querySelector(".board-tags") || Object.assign(document.createElement("div"), { className: "board-tags" });
  if (!overlay.parentNode) container.appendChild(overlay);
  const mk = (cls) => { const d = document.createElement("div"); d.className = cls; d.hidden = true; overlay.appendChild(d); return d; };
  const els = { hover: mk("tag hover"), pin: mk("tag pin") };
  const keys = { hover: null, pin: null };
  const update = () => {
    for (const k of ["hover", "pin"]) {
      const key = keys[k], p = key && posOf(key), lab = key && labelOf(key);
      if (!p || !lab || (k === "hover" && keys.pin && keys.pin.x === key.x && keys.pin.y === key.y)) { els[k].hidden = true; continue; }
      els[k].textContent = lab; els[k].hidden = false;
      els[k].style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  };
  return {
    hover(key) { keys.hover = key; update(); },
    pin(key) { keys.pin = key; update(); },
    update,
    destroy() { overlay.remove(); },
  };
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
  const svg = el("svg", { class: "hex-svg", role: "img", "aria-label": "Board (flat map). The same tiles are listed below the board for keyboard and screen reader use." });
  svg.style.cssText = "width:100%;height:100%;display:block";
  container.appendChild(svg);
  let theme = readTheme(), selected = null, last = null;
  const polys = new Map();
  const labelOf = (k) => last && last.tiles.find((t) => t.x === k.x && t.y === k.y && t.z === 0)?.label;
  const posOf = (k) => {
    const poly = polys.get(`${k.x},${k.y}`);
    if (!poly) return null;
    const b = poly.getBoundingClientRect(), c = container.getBoundingClientRect();
    return { x: b.left + b.width / 2 - c.left, y: b.top - c.top };
  };
  container.style.position = "relative";
  const tagger = makeTagger(container, labelOf, posOf);
  const keyOf = (e) => { const n = e.target.closest?.("polygon[data-x]"); return n ? { x: Number(n.dataset.x), y: Number(n.dataset.y) } : null; };
  let press = null, longFired = false;
  svg.addEventListener("pointerover", (e) => { if (e.pointerType === "mouse") tagger.hover(keyOf(e)); });
  svg.addEventListener("pointerleave", () => tagger.hover(null));
  svg.addEventListener("contextmenu", (e) => { e.preventDefault(); tagger.pin(keyOf(e)); });
  svg.addEventListener("pointerdown", (e) => {
    tagger.pin(null); longFired = false; clearTimeout(press);
    if (e.pointerType !== "mouse") { const k = keyOf(e); press = setTimeout(() => { longFired = true; tagger.pin(k); }, LONG_PRESS_MS); }
  });
  for (const t of ["pointerup", "pointercancel", "pointermove"]) svg.addEventListener(t, () => { if (t !== "pointermove") clearTimeout(press); });
  svg.addEventListener("click", (e) => { if (longFired) { longFired = false; return; } const k = keyOf(e); onSelect && (k ? onSelect(k.x, k.y) : onSelect(null, null)); });

  function setData(board) {
    last = board;
    polys.clear();
    svg.replaceChildren();
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const t of board.tiles) for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      for (const z of [-SLAB_DEPTH, 1]) {
        const [px, py] = project(t.x + dx * HALF, t.y + dy * HALF, z);
        minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, -py); maxY = Math.max(maxY, -py);
      }
    }
    const pad = 1.0;
    svg.setAttribute("viewBox", `${minX - pad - 0.8} ${minY - pad} ${maxX - minX + 2 * pad + 1.6} ${maxY - minY + 2 * pad}`);
    const g = el("g", {}, svg);
    const order = board.tiles.filter((t) => t.z === 0).sort((a, b) => (b.x + b.y) - (a.x + a.y));
    for (const t of order) {
      const base = theme.tile, h = SLAB, x = t.x, y = t.y;
      const P = (dx, dy, z) => project(x + dx * HALF, y + dy * HALF, z);
      // the two faces you can see (south and west), then the top
      el("polygon", { points: pts([P(-1, -1, h), P(1, -1, h), P(1, -1, -SLAB_DEPTH), P(-1, -1, -SLAB_DEPTH)]), fill: shade(base, 0.7) }, g);
      el("polygon", { points: pts([P(-1, -1, h), P(-1, 1, h), P(-1, 1, -SLAB_DEPTH), P(-1, -1, -SLAB_DEPTH)]), fill: shade(base, 0.82) }, g);
      const on = selected && selected.x === x && selected.y === y;
      const top = el("polygon", {
        points: pts([P(-1, -1, h), P(1, -1, h), P(1, 1, h), P(-1, 1, h)]), fill: base,
        stroke: on ? theme.select : "rgba(0,0,0,.18)", "stroke-width": on ? 0.09 : 0.02, "stroke-linejoin": "round",
        "data-x": x, "data-y": y, style: "cursor:pointer",
      }, g);
      polys.set(`${x},${y}`, top);
      if (on) top.parentNode.appendChild(top);
    }
    const gp = el("g", {}, svg);
    for (const p of board.pieces) { const [a, b] = project(p.at.x, p.at.y, SLAB); pawn(gp, a, b - 0.02, p.color.hex, theme.pawnInk, 1.25); }
    tagger.update();
  }
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const onScheme = () => { theme = readTheme(); if (last) setData(last); };
  mq.addEventListener?.("change", onScheme);
  return {
    mode: "svg",
    setData(b) { setData(b); },
    select(x, y) { selected = x == null ? null : { x, y }; if (last) setData(last); },
    screenPos(x, y) { const c = polys.get(`${x},${y}`); const b = c?.getBoundingClientRect(); return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null; },
    recenter() {},
    refreshTheme: onScheme,
    destroy() { mq.removeEventListener?.("change", onScheme); tagger.destroy(); svg.remove(); },
  };
}
