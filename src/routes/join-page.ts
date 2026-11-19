// GET /<slug>/join/:code serves the join page with the game's name and open seats.
// The form posts to /<slug>/api/join; the emailed link finishes the join.
import { page } from "../lib/pages";
import { Ctx, PALETTE, esc, normCode, seatLimit, seatsTaken } from "../lib/util";

export const get = async ({ env, params, data }: Ctx) => {
  const code = normCode(params.code);
  const game = data.game!;
  const home = `/${esc(game.slug)}/`;
  if (!code || code !== game.join_code) {
    return page(game.name, `<h1>${esc(game.name)}</h1><div class="now">That code doesn't match this game. Check the link you were sent, or ask whoever invited you.</div>
      <p><a href="${home}">See the board</a></p>`, 404);
  }
  const taken = await seatsTaken(env, game.id);
  const takenSet = new Set(taken.map((t) => t.color));
  const open = seatLimit(game) - taken.length;
  const closed = game.status !== "setup" || open <= 0;
  const head = `<h1>${esc(game.name)}</h1><p class="sub">Join this game</p>`;
  if (closed) {
    return page(game.name, `${head}<div class="now">${game.status !== "setup" ? "This game has already started, so the seats are closed." : "This game is full."}</div>
      <p><a href="${home}">See the board</a></p>`, 409);
  }
  // A little pawn per colour: round head, tapered body, flat foot. Colour names are
  // written out as well, so colour is never the only signal.
  const pawn = (hex: string) =>
    `<svg viewBox="0 0 40 52" width="40" height="52" aria-hidden="true" focusable="false"><ellipse cx="20" cy="46" rx="15" ry="5" fill="${hex}"/><path d="M11 45 Q15 24 20 24 Q25 24 29 45 Z" fill="${hex}"/><circle cx="20" cy="14" r="9" fill="${hex}"/><path d="M11 45 Q15 24 20 24 Q25 24 29 45 Z M9 45 a15 5 0 0 0 22 0" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1.5"/></svg>`;
  const pieces = PALETTE.map(
    (c) =>
      `<label class="piece"><input type="radio" name="color" value="${c.key}" required ${takenSet.has(c.key) ? "disabled" : ""}><span>${pawn(c.hex)}<b>${c.name}</b>${takenSet.has(c.key) ? "<i>taken</i>" : ""}</span></label>`,
  ).join("");
  return page(
    `Join ${game.name}`,
    `${head}
<div class="now">${open} of ${seatLimit(game)} seats open. Pick a piece color, and we'll email you a link to finish joining.</div>
<h2>Take a seat</h2>
<form class="stack" id="f">
  <label>Your name<input type="text" name="name" maxlength="40" required autocomplete="nickname"></label>
  <label>Your email<input type="email" name="email" required autocomplete="email"></label>
  <fieldset class="pieces"><legend>Your piece</legend><div class="markers">${pieces}</div></fieldset>
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
      body: JSON.stringify({ code, name: f.get("name"), email: f.get("email"), color: f.get("color") }) });
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
