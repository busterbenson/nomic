// Today's ballot, the voting half (rule 104): the Yes / No boxes in the ballot rows and in a rule's card, kept in sync from one
// answer of GET /api/ballot. Votes go through POST /api/votes; every refusal (End turn, the midnight lock, not in the electorate)
// is the server's own sentence, shown as it comes. Nothing here knows how anyone else voted (rule 104.4): the API doesn't say.
//   const B = createBallot({ api, pill, refreshed, player })
//     player()          true when the viewer is a signed-in player of this game; anyone else sees the ballot read-only (turnout, no buttons)
//     api(path, body?)  the page's fetch helper -> { ok, status, data }
//     pill(by)          the page's player pill for someone who has voted (piece + name)
//     refreshed()       reload the page's state after a vote (the day strip's "N of M" comes from /api/day); may be async
//   B.load()            fetch GET /api/ballot (call it wherever the page reloads its state)
//   B.box(n)            the vote box HTML for item "P3", or "" when the ballot has no such item
//   B.voted() / B.total() / B.hasYou()   "N of M voted" for you (hasYou: you are signed in and have a ballot)
//   B.firstOpen()       the n of the first item you have not voted on (else the first item)
//   B.click(el)         a [data-vote] button was clicked
// @rule 104.3
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LABEL = { yes: "Yes", no: "No" };

export function createBallot({ api, pill, refreshed, player = () => true }) {
  let BAL = null, MSG = null, BUSY = false, TIMER = 0;   // the last /api/ballot; the last answer to a vote {n, text, err}; a vote in flight

  /** @rule 104.3 */
  async function load() {
    const r = await api("/api/ballot");
    BAL = r.ok && r.data && Array.isArray(r.data.items) ? r.data : null;
  }
  const items = () => (BAL ? BAL.items.filter((i) => i.status === "on_ballot") : []);
  const find = (n) => items().find((i) => i.n === n) || null;
  /** @rule 104.3 */
  const voted = () => (BAL && BAL.you ? Number(BAL.you.voted) || 0 : 0);
  /** @rule 104.3 */
  const total = () => items().length;
  /** @rule 104.3 */
  const firstOpen = () => { const l = items(); const f = l.find((i) => !i.your_vote) || l[0]; return f ? f.n : null; };

  /** @rule 104.3, 104.4 */
  function box(n) {
    const it = find(n);
    if (!it) return "";
    const can = it.can_vote && it.can_vote.allowed;
    const mine = it.your_vote;
    const btn = (v) => `<button type="button" class="vbtn${mine === v ? " on" : ""}" data-vote="${v}" data-pn="${esc(n)}" aria-pressed="${mine === v}"${can ? "" : " disabled"}>${mine === v ? '<span aria-hidden="true">✓ </span>' : ""}${LABEL[v]}</button>`;
    const t = it.turnout || { voted: 0, of: 0, players: [] };
    const who = (t.players || []).map((p) => pill(p)).join("");
    const m = MSG && MSG.n === n ? `<p class="vmsg${MSG.err ? " err" : ""}" role="status">${esc(MSG.text)}</p>` : '<p class="vmsg" role="status"></p>';
    if (!player()) return `<div class="vbox" data-vbox="${esc(n)}"><p class="vturn mono">${t.voted} of ${t.of} voted${who ? `: ${who}` : ""}</p></div>`;
    return `<div class="vbox" data-vbox="${esc(n)}"><div class="vbtns" role="group" aria-label="Vote on ${esc(n)}">${btn("yes")}${btn("no")}</div>
<p class="vturn mono">${t.voted} of ${t.of} voted${who ? `: ${who}` : ""}</p>${can ? "" : `<p class="vwhy">${esc((it.can_vote && it.can_vote.reason) || "")}</p>`}${m}</div>`;
  }

  // Put the last answer into the boxes already on the page (no redraw, no network).
  const paint = () => { if (MSG && typeof document !== "undefined") for (const m of document.querySelectorAll(`[data-vbox="${MSG.n}"] .vmsg`)) { m.textContent = MSG.text; m.className = "vmsg" + (MSG.err ? " err" : ""); } };
  /** @rule 104.3 */
  async function click(el) {
    const n = el.dataset.pn, vote = el.dataset.vote;
    if (BUSY || !find(n)) return;
    BUSY = true; clearTimeout(TIMER);
    let r;
    try { r = await api("/api/votes", { proposal: n, vote }); } catch (e) { r = { ok: false, data: { error: "Couldn't reach the game. Check your connection and try again." } }; } finally { BUSY = false; }
    MSG = { n, text: (r.data && (r.ok ? r.data.message : r.data.error)) || (r.ok ? `${n}: you voted ${LABEL[vote]}.` : "Something went wrong."), err: !r.ok };
    paint();   // the message shows at once, whether or not the reload that follows works
    try { await refreshed(); } catch (e) { /* the vote itself is in; the next reload shows it */ }
    paint();   // ...and again once the boxes were drawn afresh
    // The toast fades (the vote stays). The message nodes are emptied in place: no redraw, so a card or a form being typed in is left alone.
    TIMER = setTimeout(() => { MSG = null; if (typeof document !== "undefined") for (const m of document.querySelectorAll(".vmsg")) { m.textContent = ""; m.className = "vmsg"; } }, 9000);
  }
  const hasYou = () => !!(BAL && BAL.you);
  return { load, box, voted, total, firstOpen, click, hasYou };
}
