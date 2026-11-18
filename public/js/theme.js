// Reads the board's colors from the CSS tokens in /theme.css (the one file to restyle the site),
// so the WebGL scene and the SVG fallback follow the same palette as the page, light and dark.
const cssVar = (cs, name, fallback) => (cs.getPropertyValue(name).trim() || fallback);

export function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, f) => cssVar(cs, n, f);
  return {
    terrain: {
      meadow: { label: "Meadow", color: v("--terrain-meadow", "#a9c47c") },
      water: { label: "Water", color: v("--terrain-water", "#6fa8cf") },
      forest: { label: "Forest", color: v("--terrain-forest", "#5a8a5f") },
      stone: { label: "Stone", color: v("--terrain-stone", "#a3a29c") },
      sand: { label: "Sand", color: v("--terrain-sand", "#e3d097") },
    },
    decorForest: v("--decor-forest", "#33583d"),
    decorStone: v("--decor-stone", "#7c7c79"),
    seaLine: v("--sea-line", "#5b7480"),
    seaAlpha: parseFloat(v("--sea-line-alpha", "0.3")),
    select: v("--tile-select", "#ffffff"),
    hover: v("--tile-hover", "#ffffff"),
    pawnInk: v("--pawn-ink", "#1d1a16"),
    label: v("--board-label", "#3d4a52"),
    skyLight: v("--light-sky", "#ffffff"),
    groundLight: v("--light-ground", "#8d8f96"),
    skyStrength: parseFloat(v("--light-sky-strength", "1.5")),
    sunStrength: parseFloat(v("--light-sun-strength", "1.5")),
  };
}

// Multiply a #rrggbb color by f (used to shade the sides of the SVG slabs).
export function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((u) => Math.max(0, Math.min(255, Math.round(u * f))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
