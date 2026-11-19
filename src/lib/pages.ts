// Small server-rendered pages: the landing page, /<slug>/join/<code>, /<slug>/auth/verify, 404s.
import { esc } from "./util";

export const SITE_NAME = "Promptocracy";

// The fonts (Google Fonts, the only external request) and the shared head of every page: the stylesheets, and the one place
// the board page (public/board.html) shares with the server-rendered pages.
export const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:ital,wght@0,400;0,600;0,700;1,400&family=Martian+Mono:wdth,wght@87.5..112.5,400..700&family=Grenze+Gotisch:wght@100..900&display=swap">`;
// The mark: a tile seen from above and to the side, in the moderator's lavender.
export const LOGO = `<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><polygon points="13,2 25,9 13,16 1,9" style="fill:var(--accent)"/><polygon points="1,9 13,16 13,24 1,17" style="fill:var(--ink)"/><polygon points="13,16 25,9 25,17 13,24" style="fill:var(--ink-muted)"/></svg>`;

// `wide` pages (the landing page) lay themselves out; the rest sit in one narrow column.
export const page = (title: string, inner: string, status = 200, opts: { wide?: boolean; right?: string } = {}) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>${FONTS}<link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/site.css"></head><body>
<header class="site-head"><a class="wordmark" href="/">${LOGO}${SITE_NAME}</a>${opts.right ?? ""}</header>
<main class="site-main">${opts.wide ? inner : `<div class="narrow">${inner}</div>`}</main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

// Unknown game, or a path that is not one: friendly, and it names no real game.
export const notFoundPage = () =>
  page(
    SITE_NAME,
    `<h1>${SITE_NAME}</h1><div class="now">There is no game at this address.</div>
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
