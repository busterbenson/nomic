// The chat window (rules 106.3, 106.7): ONE component for the agents that talk to a player, Gremlin now and Starling in step 2b.
// A sticky column on the right of the tab on a desktop (>= 900 px), a corner pill that opens a bottom sheet on a phone; the minimize
// button (-) docks the column as the same corner pill, and the page reflows. Open or minimized is remembered per player. It holds a header
// (portrait, name, state), the log with a day divider where the day changes, the slip (the agent's ticket), and the composer with an "N left"
// counter in the last ten messages. Personality lives in the agent's words and portrait only, never in the UI (AGENTS.md rule 4): the UI
// shows labels, data, state, and a reason beside a closed composer.
//   const CHAT = createChat({ api, root, me, slug, agent: AGENTS.gremlin, rpill, wpill, onTicket })
//     api(path, body?)    the page's fetch helper -> { ok, status, data }
//     root                the wrapper that holds the tab and the chat (#bwrap); the component writes data-chat and data-sheet on it
//     me()                the last /api/me; the window exists only for a signed-in player
//     rpill(num)          a rule pill for a rule number (plain text when the rulebook has none)
//     wpill(n)            a ticket pill
//     onTicket(page)      called with the ticket page a turn returned (the Workshop redraws its card and list)
//   CHAT.sync(tab, reread)  CHAT.attach(n, {open})  CHAT.open()  CHAT.load()
// Nothing here decides what is allowed: the server's answers (the cap, the lock, a refusal) are shown as they come.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// The characters. Gremlin's portrait is the mockup's; Starling's comes with her.
export const AGENTS = {
  gremlin: { key: "gremlin", name: "Gremlin", path: "gremlin", tab: "workshop", cls: "gr", placeholder: "Message Gremlin", symbol: "chat-gremlin" },
};
const SYMBOLS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
<symbol id="chat-gremlin" viewBox="0 0 40 40">
<path d="M8 14 L1 8 L11 11 Z M32 14 L39 8 L29 11 Z" fill="#7C8A6E" stroke="#18202B" stroke-width="1"/>
<ellipse cx="20" cy="19" rx="11" ry="10" fill="#8E9B78" stroke="#18202B" stroke-width="1.2"/>
<circle cx="15.5" cy="17" r="2.4" fill="#F2D35B"/><circle cx="24.5" cy="17" r="2.4" fill="#F2D35B"/>
<circle cx="16" cy="17.2" r="1" fill="#18202B"/><circle cx="24" cy="17.2" r="1" fill="#18202B"/>
<path d="M14.5 23 Q20 27 25.5 23" stroke="#18202B" stroke-width="1.3" fill="none"/>
<path d="M17 24.3 L17.6 26 M22.4 24.3 L23 26" stroke="#fff" stroke-width="1"/>
<path d="M8 30 L30 30 Q32 38 20 38 Q8 38 8 30Z" fill="#6E7B62" stroke="#18202B" stroke-width="1"/>
<path d="M29 26 L35 33 M33 25.5 a2.6 2.6 0 1 0 3.2 3.2" stroke="#9AA5B1" stroke-width="2" fill="none" stroke-linecap="round"/>
</symbol>
<symbol id="chat-send" viewBox="0 0 20 20"><path d="M3 10 L17 3 L12 17 L10 11 Z" fill="currentColor"/></symbol>
</defs></svg>`;

const LEFT_SHOWN = 10;   // "N left" appears in the last ten messages of the day

export function createChat({ api, root, me, slug, agent = AGENTS.gremlin, rpill, wpill, onTicket }) {
  const S = { msgs: [], next: null, state: null, ticket: null, slip: null, busy: false, draft: "", err: "", sheet: false, open: true, loaded: false, loading: false, tab: "", note: "" };
  const col = root.querySelector("#chatcol"), fab = root.querySelector("#chatfab");
  if (!document.getElementById("chat-symbols")) { const d = document.createElement("div"); d.id = "chat-symbols"; d.innerHTML = SYMBOLS; document.body.appendChild(d); }
  const desktop = () => !!(window.matchMedia && matchMedia("(min-width: 900px)").matches);
  const reduced = () => !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const player = () => (me() && me().player) || null;
  const key = () => `promptocracy:chat:${slug}:${player() && player().color ? player().color.key : "x"}:${agent.key}`;   // /api/me names no id: a color is one player in a game
  const remembered = () => { try { return localStorage.getItem(key()) !== "min"; } catch { return true; } };
  const remember = (open) => { try { localStorage.setItem(key(), open ? "open" : "min"); } catch {} };

  // ---- text: escaped, with rule numbers as pills ----------------------------------------------------------------------
  /** A reply's text: escaped, a rule number ("rule 801" or "801.2") a pill. @rule 106.3 */
  function textHTML(s) {
    return esc(s).replace(/\b(rules?\s+)?(\d{3}(?:\.\d{1,3})?)\b/g, (m, w, n) => (w || n.includes(".") ? `${w || ""}${rpill(n)}` : m));
  }
  const portrait = (small) => `<span class="por ${agent.cls}${small ? " sm" : ""}"><svg aria-hidden="true"><use href="#${agent.symbol}"/></svg></span>`;
  const sizeText = (v) => (v && typeof v === "object" && "w" in v ? `${v.w}×${v.h}` : String(v));

  // ---- the day dividers -------------------------------------------------------------------------------------------------
  /** "Today" for the game's current date, else a short date. @rule 106.7 */
  function dayLabel(date) {
    if (S.state && date === S.state.date) return "Today";
    try { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)); } catch { return date; }
  }

  // ---- the slip: his ticket, as it stands ---------------------------------------------------------------------------------
  /** The agent's ticket: a title, what it makes, the estimate and the price with its one-line reason. Labels and data only. @rule 801.2, 801.4 */
  function slipHTML() {
    const t = S.slip;
    if (!t) return "";
    const last = [...S.msgs].reverse().find((m) => m.role === "agent");
    const refused = last && last.refusal && last.ticket === t.n;
    const makes = (t.makes || []).map((m) => (m.kind === "rule"
      ? `<span class="mk">${m.num ? rpill(m.num) : esc(m.draft || "New rule")}</span>`
      : `<span class="mk">${esc(m.name)}${m.catalogKind ? `<small>${esc(m.catalogKind)}${m.attrs && m.attrs.size ? ` ${esc(sizeText(m.attrs.size))}` : ""}</small>` : ""}</span>`)).join("");
    const stamp = refused ? `<span class="cstamp err">REFUSED</span>` : t.state === "Draft" ? `<span class="cstamp">DRAFT</span>` : `<span class="cstamp">${esc(String(t.state).toUpperCase())}</span>`;
    return `<section class="slip${refused ? " refused" : ""}" aria-label="${esc(t.n)}">${stamp}
<div class="hd">${wpill(t.n)}<b>${esc(t.title || "Untitled")}</b></div>
${refused ? `<div class="tx">${esc(last.refusal)}</div>` : ""}
<dl><dt>Makes</dt><dd>${makes ? `<span class="makes">${makes}</span>` : "Nothing"}</dd><dt>Estimate</dt><dd>${esc(`${t.estimate} ${t.estimate === 1 ? "night" : "nights"}`)}</dd>
<dt>Price</dt><dd>${esc(`${t.price} ${t.price === 1 ? "point" : "points"}`)}${t.price_reason ? `<span class="cwhy"> · ${esc(t.price_reason)}</span>` : ""}</dd></dl></section>`;
  }

  // ---- the log ------------------------------------------------------------------------------------------------------------
  /** One stored line. @rule 106.3 */
  function lineHTML(m, prev) {
    if (m.role === "event") return `<div class="ev">${esc(m.body)}</div>`;
    if (m.role === "player") return `<div class="msg cme"><div class="bub">${esc(m.body)}</div></div>`;
    const cont = prev && (prev.role === "agent" || prev.role === "excuse") && prev.date === m.date;
    return `<div class="msg cher${cont ? " cont" : ""}">${cont ? "" : portrait(true)}<div class="bub">${textHTML(m.body)}</div></div>`;
  }
  function logHTML() {
    const out = [];
    let prev = null, day = null;
    for (const m of S.msgs) {
      if (m.date && m.date !== day) { day = m.date; out.push(`<div class="cday">${esc(dayLabel(m.date))}</div>`); prev = null; }
      out.push(lineHTML(m, prev));
      prev = m;
    }
    if (S.busy) out.push(`<div class="msg cher">${portrait(true)}<div class="bub"><span class="typing" aria-label="${esc(agent.name)} is typing"><i></i><i></i><i></i></span></div></div>`);
    out.push(slipHTML());
    return out.join("");
  }

  // ---- the composer -------------------------------------------------------------------------------------------------------------
  function inputHTML() {
    const st = S.state;
    const closed = st && st.closed;
    const left = st && st.left <= LEFT_SHOWN && !closed ? `<span class="left">${esc(st.left)} left</span>` : "";
    const chip = S.ticket ? `<span class="chip">${wpill(S.ticket)}<button type="button" class="x" data-c="detach" aria-label="Detach ${esc(S.ticket)}">×</button></span>` : "";
    if (closed) return `<div class="ch-in"><p class="closed" role="status">${esc(closed.text)}</p></div>`;
    return `<div class="ch-in">${chip}<div class="row"><textarea id="chatText" rows="1" maxlength="2000" placeholder="${esc(agent.placeholder)}" aria-label="${esc(agent.placeholder)}"${S.busy ? " disabled" : ""}>${esc(S.draft)}</textarea>
<button type="button" class="send" data-c="send" aria-label="Send"${S.busy || !S.draft.trim() ? " disabled" : ""}><svg width="18" height="18" aria-hidden="true"><use href="#chat-send"/></svg></button></div>${S.err ? `<p class="err" role="alert">${esc(S.err)}</p>` : ""}${left}</div>`;
  }

  /** The whole window. The log keeps its place; the draft keeps its text and its caret. @rule 106.3 */
  function draw(toEnd) {
    if (!col) return;
    const p = player();
    col.hidden = !p;
    if (!p) return;
    const log0 = col.querySelector(".ch-log");
    const atEnd = toEnd === true || !log0 || log0.scrollHeight - log0.scrollTop - log0.clientHeight < 80;
    const ta0 = col.querySelector("#chatText");
    const focus = ta0 && document.activeElement === ta0 ? [ta0.selectionStart, ta0.selectionEnd] : null;
    const ready = S.state ? S.state.ready : true;
    col.innerHTML = `<section class="chat" aria-label="${esc(agent.name)}">
<header class="ch-h">${portrait(false)}<div class="cnm"><b>${esc(agent.name)}</b>${!ready ? "<small>can't be reached</small>" : S.busy ? '<small class="live">typing</small>' : ""}</div>
<button type="button" class="ch-x" data-c="min" aria-label="Minimize" title="Minimize">–</button><button type="button" class="ch-x ch-close" data-c="close" aria-label="Close" title="Close">×</button></header>
<div class="ch-log" id="chatLog" tabindex="0" aria-live="polite">${S.loaded ? logHTML() : ""}</div>${inputHTML()}</section>`;
    const log = col.querySelector(".ch-log");
    if (log) {
      const keep = log0 ? log0.scrollTop : 0;
      if (atEnd || !log0) { log.scrollTop = log.scrollHeight; requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; }); } else log.scrollTop = keep;
      log.addEventListener("scroll", onScroll, { passive: true });
    }
    const ta = col.querySelector("#chatText");
    if (ta) { autosize(ta); if (focus) { ta.focus(); try { ta.setSelectionRange(focus[0], focus[1]); } catch {} } }
    drawFab();
  }
  function autosize(ta) { ta.style.height = "auto"; ta.style.height = Math.min(120, ta.scrollHeight) + "px"; }
  function drawFab() {
    if (!fab) return;
    fab.innerHTML = `${portrait(false)}<span>${esc(agent.name)}</span>`;
    fab.setAttribute("aria-label", `Open ${agent.name}`);
  }

  // ---- where it lives: the tab, minimized, the sheet -----------------------------------------------------------------------------
  /** The wrapper's state: off (not this tab, or not a player), open (the column), min (the pill); the phone's sheet is separate. @rule 106.3 */
  function place() {
    const on = !!player() && S.tab === agent.tab;
    root.dataset.chat = !on ? "off" : S.open ? "open" : "min";
    root.dataset.sheet = on && S.sheet ? "open" : "closed";
    if (fab) fab.hidden = !on;
    if (col) col.hidden = !on;
    if (on) drawFab();
    document.body.classList.toggle("chat-sheet", !!(on && S.sheet && !desktop()));
  }
  /** Called when the tab or the player changes. @rule 106.3 */
  async function sync(tab, reread) {
    const entering = tab !== S.tab;
    S.tab = tab;
    S.open = remembered();
    if (S.tab !== agent.tab) S.sheet = false;
    place();
    if (player() && S.tab === agent.tab) {
      if (!S.loaded && !S.loading) await load();
      else if (entering || reread) await readState();   // the day, the lock or the cap may have changed since this was drawn
      else draw(true);
    }
  }
  /** The window's state again (the cap, the lock, the day) without touching the log; the lines the server has since the last one are added. @rule 106.7, 107.1 */
  async function readState() {
    const r = await api(`/api/chat/${agent.path}`);
    if (r.ok) {
      S.state = r.data.state;
      const have = new Set(S.msgs.map((m) => m.id));
      for (const m of r.data.messages) if (!have.has(m.id)) S.msgs.push(m);
    }
    draw(true);
  }
  function open() {
    if (desktop()) { S.open = true; remember(true); } else S.sheet = true;
    place(); draw(true);   // it was drawn while hidden, so it has no place to keep: start at the end
    const ta = col && col.querySelector("#chatText"); if (ta) ta.focus();
  }
  function minimize() { S.open = false; S.sheet = false; remember(false); place(); }

  // ---- loading and sending --------------------------------------------------------------------------------------------------------
  /** Your history with him, and the window's state. @rule 106.7 */
  async function load() {
    if (!player()) return;
    S.loading = true;
    const r = await api(`/api/chat/${agent.path}`);
    S.loading = false;
    if (r.ok) { S.msgs = r.data.messages; S.next = r.data.next; S.state = r.data.state; S.loaded = true; S.err = ""; } else S.err = (r.data && r.data.error) || "Something went wrong.";
    // the ticket the last turns were about stays on the slip; the box is attached to it only while it is still a draft
    const lastTicket = S.ticket || ([...S.msgs].reverse().find((m) => m.ticket) || {}).ticket;
    if (lastTicket) await loadSlip(lastTicket, !S.ticket);
    draw();
  }
  /** The ticket on the slip: yours or nothing. `auto`: it was inferred from the history, so it is attached only if it can still be written. @rule 801.2 */
  async function loadSlip(n, auto) {
    const r = await api(`/api/tickets/${encodeURIComponent(n)}`);
    S.slip = r.ok && r.data && r.data.ticket && r.data.ticket.mine ? r.data.ticket : null;
    if (!S.slip) S.ticket = null; else if (auto) S.ticket = S.slip.state === "Draft" ? S.slip.n : null;
  }
  /** Scrolling to the top brings in the day before. @rule 106.7 */
  async function onScroll(e) {
    const log = e.target;
    if (log.scrollTop > 40 || !S.next || S.loading) return;
    S.loading = true;
    const before = log.scrollHeight;
    const r = await api(`/api/chat/${agent.path}?before=${S.next}`);
    S.loading = false;
    if (!r.ok) return;
    S.msgs = r.data.messages.concat(S.msgs); S.next = r.data.next;
    draw();
    const l2 = col.querySelector(".ch-log"); if (l2) l2.scrollTop = l2.scrollHeight - before;
  }
  /** One turn: the message goes in, his answer and the ticket page come back. @rule 106.3, 106.7 */
  async function send() {
    const text = S.draft.trim();
    if (!text || S.busy) return;
    S.busy = true; S.err = "";
    const optimistic = { id: -1, role: "player", body: text, date: S.state ? S.state.date : "", ticket: S.ticket };
    S.msgs.push(optimistic); S.draft = "";
    draw();
    const r = await api(`/api/chat/${agent.path}`, S.ticket ? { ticket: S.ticket, body: text } : { body: text });
    S.busy = false;
    S.msgs = S.msgs.filter((m) => m !== optimistic);
    if (!r.ok) {
      S.draft = text;
      S.err = (r.data && r.data.error) || "Something went wrong.";
      if (r.status === 423) await load();
      draw();
      return;
    }
    // a line the server did not store (he is out, over budget) is shown for this visit only
    for (const m of r.data.messages) S.msgs.push(m);
    if (r.data.state) S.state = r.data.state;
    if (r.data.ticket) { S.slip = r.data.ticket; onTicket && (await onTicket(r.data.ticket)); }
    draw();
  }

  // ---- the page's clicks and keys ----------------------------------------------------------------------------------------------------
  root.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-c], #chatfab");
    if (!el || !root.contains(el)) return;
    if (el === fab) { open(); return; }
    const a = el.dataset.c;
    if (a === "min") minimize();
    else if (a === "close") { S.sheet = false; place(); }
    else if (a === "send") await send();
    else if (a === "detach") { S.ticket = null; S.slip = null; draw(); }
  });
  root.addEventListener("input", (e) => {
    if (e.target.id !== "chatText") return;
    S.draft = e.target.value; autosize(e.target);
    const b = col.querySelector('[data-c="send"]'); if (b) b.disabled = S.busy || !S.draft.trim();
  });
  root.addEventListener("keydown", (e) => {
    if (e.target.id === "chatText" && e.key === "Enter" && !e.shiftKey && desktop()) { e.preventDefault(); send(); }
    if (e.key === "Escape" && S.sheet) { S.sheet = false; place(); }
  });
  if (window.matchMedia) matchMedia("(min-width: 900px)").addEventListener?.("change", () => { S.sheet = false; place(); });

  /** A ticket is what the next messages are about (and the window opens on it). @rule 801.2 */
  async function attach(n, o = {}) {
    S.ticket = n || null;
    if (n) await loadSlip(n); else S.slip = null;
    if (o.open) open(); else draw();
  }
  /** Can he be reached? True until the server says there is no key. @rule 106.3 */
  const ready = () => !S.state || S.state.ready !== false;
  return { sync, attach, open, load, minimize, ready, state: () => S, draw, reduced };
}
