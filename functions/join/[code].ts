// GET /join/:code serves the join page with the game's name and open seats.
// The form posts to /api/join; the emailed link finishes the join.
import { Ctx, MARKERS, esc, gameByCode, normCode, seatsTaken } from "../_lib/util";

const page = (title: string, inner: string, status = 200) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><link rel="stylesheet" href="/site.css"></head><body><main>${inner}</main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

export const onRequestGet = async ({ env, params }: Ctx) => {
  const code = normCode(Array.isArray(params.code) ? params.code[0] : params.code);
  const game = await gameByCode(env, code);
  if (!game) {
    return page("Nomic", `<h1>Nomic</h1><div class="now">That code doesn't match a game. Check the link you were sent, or ask whoever invited you.</div>
      <p><a href="/">See the board</a></p>`, 404);
  }
  const taken = await seatsTaken(env, game.id);
  const takenSet = new Set(taken.map((t) => t.marker));
  const open = game.max_players - taken.length;
  const closed = game.status !== "setup" || open <= 0;
  const head = `<h1>Nomic</h1><p class="sub">${esc(game.name)}</p>`;
  if (closed) {
    return page("Nomic", `${head}<div class="now">${game.status !== "setup" ? "This game has already started, so the seats are closed." : "This game is full."}</div>
      <p><a href="/">See the board</a></p>`, 409);
  }
  const markers = MARKERS.map(
    (m, i) =>
      `<label><input type="radio" name="marker" value="${m.marker}" required ${takenSet.has(m.marker) ? "disabled" : ""}><span>${m.marker}</span></label>`,
  ).join("");
  return page(
    `Join ${game.name}`,
    `${head}
<div class="now">${open} of ${game.max_players} seats open. Pick a marker, and we'll email you a link to finish joining.</div>
<h2>Take a seat</h2>
<form class="stack" id="f">
  <label>Your name<input type="text" name="name" maxlength="40" required autocomplete="nickname"></label>
  <label>Your email<input type="email" name="email" required autocomplete="email"></label>
  <div><label>Your marker</label><div class="markers">${markers}</div></div>
  <button class="primary" type="submit">Email me the link</button>
  <div id="msg" role="status"></div>
</form>
<p class="sub">Your email is used to log you in and to send game notifications. It is never shown on the board.</p>
<p><a href="/">See the board</a></p>
<script>
const code = ${JSON.stringify(code).replace(/</g, "\\u003c")};
document.getElementById("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target), msg = document.getElementById("msg");
  msg.textContent = "Sending…";
  try {
    const res = await fetch("/api/join", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name: f.get("name"), email: f.get("email"), marker: f.get("marker") }) });
    const data = await res.json();
    msg.className = res.ok ? "notice" : "notice err";
    msg.textContent = data.message || data.error || "Something went wrong.";
    if (res.ok) {
      e.target.querySelector("button").disabled = true;
      if (data.dev_link) { const p = document.createElement("p"); p.className = "dev";
        p.append("Dev mode link: "); const a = document.createElement("a"); a.href = data.dev_link; a.textContent = data.dev_link; p.append(a); msg.append(p); }
    }
  } catch { msg.className = "notice err"; msg.textContent = "Could not reach the server."; }
});
</script>`,
  );
};
