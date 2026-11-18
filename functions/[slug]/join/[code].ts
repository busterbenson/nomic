// GET /<slug>/join/:code serves the join page with the game's name and open seats.
// The form posts to /<slug>/api/join; the emailed link finishes the join.
import { page } from "../../_lib/pages";
import { Ctx, MARKERS, esc, normCode, seatsTaken } from "../../_lib/util";

export const onRequestGet = async ({ env, params, data }: Ctx) => {
  const code = normCode(Array.isArray(params.code) ? params.code[0] : params.code);
  const game = data.game!;
  const home = `/${esc(game.slug)}/`;
  if (!code || code !== game.join_code) {
    return page(game.name, `<h1>${esc(game.name)}</h1><div class="now">That code doesn't match this game. Check the link you were sent, or ask whoever invited you.</div>
      <p><a href="${home}">See the board</a></p>`, 404);
  }
  const taken = await seatsTaken(env, game.id);
  const takenSet = new Set(taken.map((t) => t.marker));
  const open = game.max_players - taken.length;
  const closed = game.status !== "setup" || open <= 0;
  const head = `<h1>${esc(game.name)}</h1><p class="sub">Join this game</p>`;
  if (closed) {
    return page(game.name, `${head}<div class="now">${game.status !== "setup" ? "This game has already started, so the seats are closed." : "This game is full."}</div>
      <p><a href="${home}">See the board</a></p>`, 409);
  }
  const markers = MARKERS.map(
    (m) =>
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
<p><a href="${home}">See the board</a></p>
<script>
const code = ${JSON.stringify(code).replace(/</g, "\\u003c")};
document.getElementById("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target), msg = document.getElementById("msg");
  msg.textContent = "Sending…";
  try {
    const res = await fetch(${JSON.stringify(`/${game.slug}/api/join`)}, { method: "POST", headers: { "content-type": "application/json" },
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
