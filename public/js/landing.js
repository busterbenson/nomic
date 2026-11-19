// The picture on the front page: a small island with a few pieces, drawn by the board's own renderer. It is a picture, not a game.
import { ensureDefs } from "/js/pieces.js";
import { sceneSVG } from "/js/board.js";

const tiles = [];
for (let x = -4; x < 4; x++) for (let y = -4; y < 4; y++) if (!((x === -4 && y === 3) || (x === 3 && y === -4) || (x === 3 && y === 3) || (x === -4 && y === -4))) tiles.push({ x, y, z: 0 });
const colors = {
  vermilion: { key: "vermilion", main: "#D75553", shade: "#A7262B", tint: "#E6958F", deep: "#731B1D" },
  cobalt: { key: "cobalt", main: "#227FD9", shade: "#145697", tint: "#78A8E0", deep: "#123962" },
  marigold: { key: "marigold", main: "#C88528", shade: "#92601B", tint: "#DFB586", deep: "#67451A" },
  teal: { key: "teal", main: "#22817E", shade: "#135553", tint: "#73A3A0", deep: "#0F3433" },
};
const piece = (c, shape, x, y, mirrored) => ({ name: c, color: { ...colors[c], hex: colors[c].main }, shape, mirrored, at: { x, y, z: 0 } });
const board = { tiles, pieces: [piece("vermilion", "keeper", 0, 2), piece("cobalt", "robot", 1, -2, true), piece("marigold", "frog", -3, 0), piece("teal", "diver", -1, -1, true)] };
ensureDefs();
const svg = document.getElementById("hero-board");
const r = sceneSVG(board, { id: "hero" });
svg.innerHTML = r.markup;
const b = r.box, pad = 30;
svg.setAttribute("viewBox", `${b.x - pad} ${b.y - pad - 30} ${b.w + pad * 2} ${b.h + pad * 2 + 30}`);
