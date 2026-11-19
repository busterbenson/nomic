// GET /<slug>/join/:code serves the join page: your name and email, then a shape and a color for your piece.
// The form posts to /<slug>/api/join; the emailed link finishes the join. The shapes and colors come from the one
// data file (pieces.json); a color someone already has is unavailable.
import { page } from "../lib/pages";
import { Ctx, PALETTE, SHAPES, colorOf, esc, normCode, seatLimit, seatsTaken } from "../lib/util";

export const get = async ({ env, params, data }: Ctx) => {
  const code = normCode(params.code);
  const game = data.game!;
  const home = `/${esc(game.slug)}/`;
  const right = `<a class="quiet" href="${home}"><span class="long">Already have a seat? </span>Log in</a>`;
  if (!code || code !== game.join_code) {
    return page(game.name, `<h1>${esc(game.name)}</h1><div class="now">That code doesn't match this game.</div>
      <p><a href="${home}">See the board</a></p>`, 404, { right });
  }
  const taken = await seatsTaken(env, game.id);
  const takenBy = new Map(taken.map((t) => [t.color, t.display_name]));
  const limit = seatLimit(game);
  const closed = game.status !== "setup" || taken.length >= limit;
  const head = `<h1>${esc(game.name)}</h1>`;
  if (closed) {
    return page(game.name, `${head}<div class="now">${game.status !== "setup" ? "This game has already started, so the seats are closed." : "This game is full."}</div>
      <p><a href="${home}">See the board</a></p>`, 409, { right });
  }
  const dots = taken.map((t) => `<span class="dot" style="background:${esc(colorOf(t.color).hex)}"></span>`).join("");
  const firstFree = PALETTE.find((c) => !takenBy.has(c.key))?.key;
  const colors = PALETTE.map((c) => {
    const by = takenBy.get(c.key);
    return `<label class="opt"><input type="radio" name="color" value="${c.key}" required data-main="${c.main}" data-shade="${c.shade}" data-tint="${c.tint}" data-deep="${c.deep}" data-name="${esc(c.name)}" ${by !== undefined ? "disabled" : ""} ${c.key === firstFree ? "checked" : ""}><span class="face"><span class="swatch" style="background:${c.main}"><b style="background:${c.shade}"></b></span><span class="nm">${esc(c.name)}</span>${by !== undefined ? `<small>${esc(by)}</small>` : ""}</span></label>`;
  }).join("");
  const shapes = SHAPES.map(
    (s, i) => `<label class="opt"><input type="radio" name="shape" value="${s.key}" required ${i === 0 ? "checked" : ""} data-name="${esc(s.name)}"><span class="face"><span class="thumb"></span><span class="nm">${esc(s.name)}</span></span></label>`,
  ).join("");
  return page(
    `Join ${game.name}`,
    `${head}
<span class="seatchip"><span class="dots">${dots}</span>${taken.length} of ${limit} seats taken</span>
<form class="stack" id="f">
  <label class="field"><span>Your name</span><input type="text" name="name" maxlength="40" required autocomplete="nickname"></label>
  <label class="field"><span>Your email</span><input type="email" name="email" required autocomplete="email"></label>
  <div class="picker">
    <div class="pv"><svg id="pv" viewBox="-40 -64 80 84" role="img" aria-label="Your piece"></svg><div><div class="pname" id="pvname">Your name</div><div class="pmeta" id="pvmeta"></div></div></div>
    <fieldset><legend>Your shape</legend><div class="opts shapes">${shapes}</div></fieldset>
    <fieldset><legend>Your color</legend><div class="opts colors">${colors}</div></fieldset>
  </div>
  <button class="btn" type="submit">Take a seat</button>
  <div id="msg" role="status"></div>
</form>
<script type="module">
import { ensureDefs, pieceSVG, tileSVG } from "/js/pieces.js";
ensureDefs();
const code = ${JSON.stringify(code).replace(/</g, "\\u003c")};
const f = document.getElementById("f");
const colorOf = () => { const i = f.querySelector('input[name=color]:checked'); return i ? { key: i.value, name: i.dataset.name, main: i.dataset.main, shade: i.dataset.shade, tint: i.dataset.tint, deep: i.dataset.deep } : null; };
const shapeOf = () => f.querySelector('input[name=shape]:checked');
function draw() {
  const c = colorOf(), s = shapeOf();
  const fallback = { main: "#888888", shade: "#5c5c5c", tint: "#c2c2c2", deep: "#444444" };
  for (const t of f.querySelectorAll('input[name=shape]')) t.parentNode.querySelector(".thumb").innerHTML = '<svg viewBox="-24 -46 48 52" aria-hidden="true">' + pieceSVG({ shape: t.value, color: c || fallback, scale: 1, clip: false }) + '</svg>';
  document.getElementById("pv").innerHTML = '<g>' + tileSVG() + '</g><g>' + pieceSVG({ shape: s.value, color: c || fallback, scale: 1.5 }) + '</g>';
  const n = f.elements.name.value.trim(), pn = document.getElementById("pvname");
  pn.textContent = n || "Your name"; pn.style.opacity = n ? 1 : .55;
  document.getElementById("pvmeta").textContent = (c ? c.name : "") + " \\u00b7 " + s.dataset.name;
}
f.addEventListener("change", draw); f.elements.name.addEventListener("input", draw); draw();
f.addEventListener("submit", async (e) => {
  e.preventDefault();
  const d = new FormData(f), msg = document.getElementById("msg");
  msg.textContent = "Sending\\u2026";
  try {
    const res = await fetch(${JSON.stringify(`/${game.slug}/api/join`)}, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name: d.get("name"), email: d.get("email"), color: d.get("color"), shape: d.get("shape") }) });
    const data = await res.json();
    msg.className = res.ok ? "notice" : "notice err";
    msg.textContent = data.message || data.error || "Something went wrong.";
    if (res.ok) {
      f.querySelector("button[type=submit]").disabled = true;
      if (data.dev_link) { const p = document.createElement("p"); p.className = "dev"; p.append("Dev mode link: "); const a = document.createElement("a"); a.href = data.dev_link; a.textContent = data.dev_link; p.append(a); msg.append(p); }
    }
  } catch { msg.className = "notice err"; msg.textContent = "Could not reach the server."; }
});
</script>`,
    200,
    { right },
  );
};
