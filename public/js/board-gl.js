// The WebGL board (three.js, vendored in /vendor). Blank square slabs on an endless grid seen from a
// FIXED isometric angle (2:1 dimetric, no rotation). Drag to pan, wheel or pinch to zoom, tap or click
// a tile to select it. Coordinates show only on hover, right-click or long-press. The sea around the tiles is a faint grid that fades out toward the edges of the
// view. It renders on demand (no animation loop), at a pixel ratio of at most 2, and nothing animates,
// so it behaves the same with prefers-reduced-motion. Colors come from /theme.css via theme.js.
import * as THREE from "/vendor/three.module.js";
import { readTheme } from "/js/theme.js";
import { ELEV_DEG, HALF, LONG_PRESS_MS, SLAB, SLAB_DEPTH, makeTagger } from "/js/board.js";

const ELEV = (ELEV_DEG * Math.PI) / 180;
const ZOOM_MIN = 0.45, ZOOM_MAX = 3;
const R2 = Math.SQRT1_2;

const slab = (h) => new THREE.BoxGeometry(HALF * 2, h + SLAB_DEPTH, HALF * 2).translate(0, (h - SLAB_DEPTH) / 2, 0);
const frame = (outer, inner, depth) => {
  const sq = (r) => [new THREE.Vector2(-r, -r), new THREE.Vector2(r, -r), new THREE.Vector2(r, r), new THREE.Vector2(-r, r)];
  const shape = new THREE.Shape(sq(outer));
  shape.holes.push(new THREE.Path(sq(inner).reverse()));
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }).rotateX(-Math.PI / 2);
};

export function createGLBoard(container, { onSelect } = {}) {
  const canvas = document.createElement("canvas");
  canvas.className = "hex-canvas";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Board. The same tiles are listed below the board for keyboard and screen reader use.");
  canvas.tabIndex = 0;
  container.dataset.renderer = "webgl";
  container.appendChild(canvas);
  const recenterBtn = document.createElement("button");
  recenterBtn.type = "button"; recenterBtn.className = "recenter"; recenterBtn.textContent = "Recenter";
  recenterBtn.setAttribute("aria-label", "Recenter the board on the charted tiles");
  container.appendChild(recenterBtn);

  let theme = readTheme();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  scene.add(camera);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8d8f96, 1.5);
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(-6, 12, 8);
  scene.add(hemi, sun);

  const world = new THREE.Group();
  scene.add(world);

  // ---- the faint endless grid: one big plane, lines at tile edges, faded by distance in view space
  const gridMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0.3 }, uCenter: { value: new THREE.Vector2() }, uHalf: { value: new THREE.Vector2(10, 8) }, uSin: { value: Math.sin(ELEV) } },
    vertexShader: "varying vec2 vXZ; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vXZ = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }",
    fragmentShader: `varying vec2 vXZ; uniform vec3 uColor; uniform float uAlpha; uniform vec2 uCenter; uniform vec2 uHalf; uniform float uSin;
      void main(){
        vec2 c = vXZ; vec2 g = abs(fract(c) - 0.5) / fwidth(c);
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        vec2 o = vXZ - uCenter;
        float sr = dot(o, vec2(0.70710678, 0.70710678));
        float su = dot(o, vec2(0.70710678, -0.70710678)) * uSin;
        float n = length(vec2(sr / uHalf.x, su / uHalf.y));
        float fade = 1.0 - smoothstep(0.35, 1.0, n);
        gl_FragColor = vec4(uColor, line * fade * uAlpha);
      }`,
  });
  const gridMesh = new THREE.Mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), gridMat);
  gridMesh.position.y = -SLAB_DEPTH - 0.005;
  gridMesh.renderOrder = -1;
  world.add(gridMesh);

  // ---- shared geometry and materials: a redraw only makes meshes
  const G = {
    slab: slab(SLAB),
    hover: frame(HALF + 0.03, HALF - 0.1, 0.02),
    sel: frame(HALF + 0.03, HALF - 0.15, 0.09),
    foot: new THREE.CylinderGeometry(0.27, 0.29, 0.06, 20),
    body: new THREE.CylinderGeometry(0.11, 0.21, 0.46, 20),
    head: new THREE.SphereGeometry(0.17, 20, 14),
  };
  const mats = new Map();
  const mat = (hex, extra = {}) => {
    const k = hex + JSON.stringify(extra);
    if (!mats.has(k)) mats.set(k, new THREE.MeshLambertMaterial({ color: hex, flatShading: true, ...extra }));
    return mats.get(k);
  };
  const hoverMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6 });
  const selMat = new THREE.MeshBasicMaterial();
  const hoverMesh = new THREE.Mesh(G.hover, hoverMat); hoverMesh.visible = false; world.add(hoverMesh);
  const selMesh = new THREE.Mesh(G.sel, selMat); selMesh.visible = false; world.add(selMesh);
  const tileGroup = new THREE.Group(); world.add(tileGroup);
  const pieceGroup = new THREE.Group(); world.add(pieceGroup);

  // ---- state
  let board = null, selected = null, hover = null;
  let w = 300, h = 270, dirty = false, zoom = 1, baseHalfW = 8, baseHalfH = 6, extent = 8;
  const home = new THREE.Vector3(), target = new THREE.Vector3();
  const picks = [], top = new Map(); // top: "x,y" -> {x, y, z} world position of a tile's top centre
  let tagger = null;

  const applyTheme = () => {
    theme = readTheme();
    hemi.color.set(theme.skyLight); hemi.groundColor.set(theme.groundLight); hemi.intensity = theme.skyStrength; sun.intensity = theme.sunStrength;
    gridMat.uniforms.uColor.value.set(theme.seaLine); gridMat.uniforms.uAlpha.value = theme.seaAlpha;
    hoverMat.color.set(theme.hover); selMat.color.set(theme.select);
  };

  function makePawn(hex) {
    const g = new THREE.Group();
    const foot = new THREE.Mesh(G.foot, mat(theme.pawnInk)); foot.position.y = 0.03; g.add(foot);
    const body = new THREE.Mesh(G.body, mat(hex)); body.position.y = 0.29; g.add(body);
    const head = new THREE.Mesh(G.head, mat(hex)); head.position.y = 0.66; g.add(head);
    return { g, parts: [foot, body, head] };
  }

  function build() {
    tileGroup.clear(); pieceGroup.clear(); picks.length = 0; top.clear();
    if (!board) return;
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const t of board.tiles) {
      if (t.z !== 0) continue; // only the ground level is drawn so far
      const X = t.x, Z = -t.y; // x runs east (+X), y runs north (-Z)
      const m = new THREE.Mesh(G.slab, mat(theme.tile));
      m.position.set(X, 0, Z);
      m.userData = { x: t.x, y: t.y };
      tileGroup.add(m); picks.push(m);
      top.set(`${t.x},${t.y}`, { x: X, y: SLAB, z: Z });
      minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x); minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y);
    }
    // the middle of the charted area: the camera's home
    home.set((minX + maxX) / 2, 0, -(minY + maxY) / 2);
    extent = Math.max(maxX - minX, maxY - minY) + 1;
    for (const p of board.pieces) {
      const { g, parts } = makePawn(p.color.hex);
      g.scale.setScalar(1.2);
      const t = top.get(`${p.at.x},${p.at.y}`);
      if (!t) continue;
      g.position.set(t.x, t.y + 0.04, t.z);
      for (const part of parts) part.userData = { x: p.at.x, y: p.at.y };
      picks.push(...parts);
      pieceGroup.add(g);
    }
    measure();
    markSelection();
    fit();
  }

  // The island's extent in view space, at the home camera: the zoom that shows all of it.
  function measure() {
    placeCamera(home);
    let mx = 0, my = 0;
    const v = new THREE.Vector3();
    for (const [, t] of top) for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      for (const y of [-SLAB_DEPTH, t.y + 1.0]) {
        v.set(t.x + dx * HALF, y, t.z + dz * HALF).applyMatrix4(camera.matrixWorldInverse);
        mx = Math.max(mx, Math.abs(v.x)); my = Math.max(my, Math.abs(v.y));
      }
    }
    baseHalfW = mx + 0.7; baseHalfH = my + 0.5;
  }

  function placeCamera(c) {
    const d = 60;
    camera.position.set(c.x - Math.cos(ELEV) * R2 * d, Math.sin(ELEV) * d, c.z + Math.cos(ELEV) * R2 * d);
    camera.lookAt(c.x, 0, c.z);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
  }
  const clampTarget = () => {
    const lim = extent * 0.9 + 4;
    target.x = Math.max(home.x - lim, Math.min(home.x + lim, target.x));
    target.z = Math.max(home.z - lim, Math.min(home.z + lim, target.z));
  };

  function fit() {
    if (!board) return;
    const aspect = w / h;
    const halfH = Math.max(baseHalfH, baseHalfW / aspect) / zoom;
    camera.left = -halfH * aspect; camera.right = halfH * aspect; camera.top = halfH; camera.bottom = -halfH;
    placeCamera(target);
    gridMat.uniforms.uCenter.value.set(target.x, target.z);
    gridMat.uniforms.uHalf.value.set(halfH * aspect * 1.05, halfH * 1.05);
    camera.updateMatrixWorld(true);
  }

  function markSelection() {
    const hv = hover && !(selected && hover.x === selected.x && hover.y === selected.y) ? hover : null;
    for (const [mesh, key] of [[selMesh, selected], [hoverMesh, hv]]) {
      const t = key && top.get(`${key.x},${key.y}`);
      mesh.visible = !!t;
      if (t) mesh.position.set(t.x, t.y + (mesh === selMesh ? 0.002 : 0.05), t.z);
    }
  }

  const proj = new THREE.Vector3();
  function toPage(v) {
    proj.copy(v).project(camera);
    return { x: ((proj.x + 1) / 2) * w, y: ((1 - proj.y) / 2) * h, behind: proj.z > 1 };
  }
  const labelOf = (k) => board && board.tiles.find((t) => t.x === k.x && t.y === k.y && t.z === 0)?.label;
  const posOf = (k) => { const t = top.get(`${k.x},${k.y}`); return t ? toPage(new THREE.Vector3(t.x, t.y + 0.5, t.z)) : null; };
  tagger = makeTagger(container, labelOf, posOf);
  const drawOverlay = () => tagger.update();

  function resize() {
    const r = container.getBoundingClientRect();
    w = Math.max(160, Math.round(r.width)); h = Math.max(160, Math.round(r.height));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    fit(); draw();
  }
  function draw() {
    if (dirty) return;
    dirty = true;
    requestAnimationFrame(() => { dirty = false; renderer.render(scene, camera); drawOverlay(); });
  }

  // ---- picking, panning, zooming
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const setRay = (cx, cy) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  };
  function pick(cx, cy) {
    setRay(cx, cy);
    const hit = ray.intersectObjects(picks, false)[0];
    return hit ? { x: hit.object.userData.x, y: hit.object.userData.y } : null;
  }
  const groundAt = (cx, cy) => { setRay(cx, cy); const p = new THREE.Vector3(); return ray.ray.intersectPlane(ground, p) ? p : null; };
  function zoomAt(cx, cy, factor) {
    const before = groundAt(cx, cy);
    zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor));
    fit();
    const after = groundAt(cx, cy);
    if (before && after) { target.x += before.x - after.x; target.z += before.z - after.z; clampTarget(); fit(); }
  }

  const ptrs = new Map();
  let startAt = null, moved = false, grab = null, pinch0 = null, zoom0 = 1, pressTimer = null, longFired = false;
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    tagger.pin(null); draw();
    clearTimeout(pressTimer); longFired = false;
    if (ptrs.size === 1 && e.pointerType !== "mouse") {
      const px = e.clientX, py = e.clientY;
      pressTimer = setTimeout(() => { if (!moved && ptrs.size === 1) { longFired = true; tagger.pin(pick(px, py)); draw(); } }, LONG_PRESS_MS);
    }
    if (ptrs.size === 1) { startAt = { x: e.clientX, y: e.clientY, t: performance.now() }; moved = false; grab = groundAt(e.clientX, e.clientY); canvas.style.cursor = "grabbing"; }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); zoom0 = zoom; moved = true; grab = null; }
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) {
      if (e.pointerType === "mouse") {
        const k = pick(e.clientX, e.clientY);
        if ((k && `${k.x},${k.y}`) !== (hover && `${hover.x},${hover.y}`)) { hover = k; tagger.hover(k); markSelection(); draw(); }
        canvas.style.cursor = k ? "pointer" : "grab";
      }
      return;
    }
    p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 2 && pinch0) {
      const [a, b] = [...ptrs.values()];
      const want = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom0 * (Math.hypot(a.x - b.x, a.y - b.y) / pinch0)));
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, want / zoom);
      draw();
      return;
    }
    if (!moved && startAt && Math.hypot(e.clientX - startAt.x, e.clientY - startAt.y) > 6) { moved = true; clearTimeout(pressTimer); }
    if (moved && ptrs.size === 1 && grab) {
      const g = groundAt(e.clientX, e.clientY);
      if (g) { target.x += grab.x - g.x; target.z += grab.z - g.z; clampTarget(); fit(); draw(); }
    }
  });
  const up = (e) => {
    const was = ptrs.has(e.pointerId);
    clearTimeout(pressTimer);
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch0 = null;
    canvas.style.cursor = e.pointerType === "mouse" ? "grab" : "";
    if (longFired) { longFired = false; return; } // a long-press shows the coordinates; it does not select
    if (was && e.type === "pointerup" && !moved && ptrs.size === 0 && e.button !== 2 && startAt && performance.now() - startAt.t < 700) {
      const k = pick(e.clientX, e.clientY);
      if (onSelect) onSelect(k ? k.x : null, k ? k.y : null);
    }
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && hover) { hover = null; tagger.hover(null); markSelection(); draw(); } });
  // right-click (desktop) pins the coordinates of the tile under the cursor; the browser menu stays out of the way
  canvas.addEventListener("contextmenu", (e) => { e.preventDefault(); tagger.pin(pick(e.clientX, e.clientY)); draw(); });
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); draw(); }, { passive: false });
  canvas.addEventListener("keydown", (e) => {
    const step = 0.8 / zoom;
    const k = { ArrowLeft: () => (target.x -= step * R2, target.z -= step * R2), ArrowRight: () => (target.x += step * R2, target.z += step * R2), ArrowUp: () => (target.x += step * R2, target.z -= step * R2), ArrowDown: () => (target.x -= step * R2, target.z += step * R2), "+": () => (zoom = Math.min(ZOOM_MAX, zoom * 1.15)), "-": () => (zoom = Math.max(ZOOM_MIN, zoom / 1.15)), "0": () => { zoom = 1; target.copy(home); } }[e.key];
    if (k) { e.preventDefault(); k(); clampTarget(); fit(); draw(); }
  });
  canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
  canvas.addEventListener("webglcontextrestored", () => draw());
  const recenter = () => { zoom = 1; target.copy(home); fit(); draw(); };
  recenterBtn.addEventListener("click", recenter);

  const ro = new ResizeObserver(resize);
  ro.observe(container);
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const onScheme = () => { applyTheme(); mats.clear(); build(); draw(); };
  mq.addEventListener?.("change", onScheme);
  applyTheme();
  resize();

  return {
    mode: "webgl",
    setData(b) { const first = !board; board = b; build(); if (first) target.copy(home); fit(); draw(); },
    select(x, y) { selected = x == null ? null : { x, y }; markSelection(); draw(); },
    screenPos(x, y) {
      const t = top.get(`${x},${y}`);
      if (!t) return null;
      camera.updateMatrixWorld(true);
      const p = toPage(new THREE.Vector3(t.x, t.y, t.z));
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + p.x * (rect.width / w), y: rect.top + p.y * (rect.height / h) };
    },
    recenter,
    refreshTheme: onScheme,
    destroy() { ro.disconnect(); mq.removeEventListener?.("change", onScheme); renderer.dispose(); canvas.remove(); tagger.destroy(); recenterBtn.remove(); },
  };
}
