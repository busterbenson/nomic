// Small server-rendered pages: the landing page, /<slug>/join/<code>, /<slug>/auth/verify, 404s.
import { esc } from "./util";

export const SITE_NAME = "Promptocracy";

export const page = (title: string, inner: string, status = 200) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/site.css"></head><body><main>${inner}</main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

// Unknown game, or a path that is not one: friendly, and it names no real game.
export const notFoundPage = () =>
  page(
    SITE_NAME,
    `<h1>${SITE_NAME}</h1><div class="now">There is no game at this address. Check the link you were sent.</div>
<p><a href="/">See the games</a></p>`,
    404,
  );

// Shown when a link is expired, used, or never existed: ask for a new one.
export const expiredPage = (game: { slug: string; name: string }) =>
  page(
    game.name,
    `<h1>${esc(game.name)}</h1><div class="now">This link expired or was already used. Request a new one below.</div>
<h2>Log in</h2>
<form class="stack" id="f">
  <label>Email you joined with<input type="email" name="email" required autocomplete="email"></label>
  <button class="primary" type="submit">Email me a log-in link</button>
  <div id="msg" role="status"></div>
</form>
<p class="sub">Not in the game yet? Open the join link you were sent and fill in the form again.</p>
<p><a href="/${esc(game.slug)}/">See the board</a></p>
<script>
document.getElementById("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("msg");
  msg.textContent = "Sending…";
  try {
    const res = await fetch(${JSON.stringify(`/${game.slug}/api/login`)}, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: new FormData(e.target).get("email") }) });
    const data = await res.json();
    msg.className = res.ok ? "notice" : "notice err";
    msg.textContent = data.message || data.error || "Something went wrong.";
  } catch { msg.className = "notice err"; msg.textContent = "Could not reach the server."; }
});
</script>`,
    400,
  );
