// The Workshop tab (rules 801-804): the list of tickets, "Commission something", the ticket page (a card) with its tasks, log
// and discussion, and the Summary's Workshop block. The catalog's groups follow the list on the same tab.
//   const W = createWorkshop({ api, me, day, pill, rpill, when, canCommission, refresh, cards })
//     api(path, body?)   the page's fetch helper -> { ok, status, data }
//     me()               the last /api/me
//     pill(by, mine)     the page's player pill
//     rpill(num)         a rule pill for a rule number (text when the rulebook has none)
//     when(iso)          a short date for a log line or a post
//     canCommission()    {allowed, reason}: the proposals' own answer (rule 103.2)
//     refresh()          reload the page's state after a confirm
//     cards              the card host (cards.js)
//     chat()             the chat window (chat.js) or null: "Commission something" opens it on the new draft (rule 801.2)
//   W.load()  W.count()  W.tabHTML()  W.summaryHTML()  W.card(spec)  W.open(n, push)  W.click(el)  W.input(el)  W.apply(page)
// Nothing here decides what is allowed: the server's answers (the lock, one a day, a refusal) are shown as they come.
import { commissionHTML, nights, points, wPill } from "/js/commission.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lines = (s) => String(s || "").split("\n").map((x) => x.trim()).filter(Boolean);

export function createWorkshop({ api, me, pill, rpill, when, canCommission, refresh, cards, chat }) {
  const S = { list: [], total: 0, counts: {}, view: "main", all: { rows: [], next: null, state: "", err: "" }, detail: {}, form: null, busy: false, err: "", note: "", openErr: "", draftPost: {} };

  /** @rule 801.2 */
  async function load() {
    const r = await api("/api/tickets");
    S.list = r.ok && r.data ? r.data.tickets || [] : [];
    S.total = r.ok && r.data ? r.data.total || 0 : 0;
    S.counts = r.ok && r.data ? r.data.counts || {} : {};
  }
  // The all-tickets list: 50 at a time, newest change first, optionally one state; "More" asks for the next page. @rule 801.2
  async function loadAll(reset) {
    const A = S.all;
    const q = new URLSearchParams({ all: "1" });
    if (A.state) q.set("state", A.state);
    if (!reset && A.next) q.set("cursor", A.next);
    const r = await api(`/api/tickets?${q}`);
    if (!r.ok) { A.err = (r.data && r.data.error) || "Something went wrong."; return; }
    A.err = "";
    A.rows = reset ? r.data.tickets : A.rows.concat(r.data.tickets);
    A.next = r.data.next || null;
  }
  /** @rule 801.2 */
  async function loadOne(n) {
    const r = await api(`/api/tickets/${encodeURIComponent(n)}`);
    if (r.ok && r.data && r.data.ticket) S.detail[n] = r.data.ticket; else delete S.detail[n];
  }
  const player = () => !!(me() && me().player);

  /** @rule 801.2 */
  async function open(n, push) {
    S.err = ""; S.note = "";
    S.detail[n] = S.detail[n] || null;   // a card with its name and nothing else until the page arrives
    cards.open({ kind: "ticket", key: n }, { push: !!push });
    await loadOne(n);
    S.form = null;
    cards.redraw();
  }

  // ---- the list --------------------------------------------------------------------------------------------------
  /** @rule 801.2, 801.4 */
  function rowHTML(t, dense) {
    return `<li class="trow" id="wk-${esc(t.n)}"><span class="tmain"><button type="button" class="tlink" data-ticket="${esc(t.n)}" aria-haspopup="dialog"><span class="wpill">${esc(t.n)}</span><span class="tt">${esc(t.title || "Untitled")}</span></button></span>
<span class="tmeta">${pill(t.by, t.mine)}<span class="pill tstate" data-state="${esc(t.state)}">${esc(t.state)}</span><span class="tnum mono">${esc(nights(t.estimate))}</span><span class="tnum mono">${esc(points(t.price))}</span>${dense ? `<span class="tnum mono">${esc(when(t.changed_at))}</span>` : ""}</span></li>`;
  }
  /** @rule 801.1, 801.2 */
  function commissionButton() {
    if (!player()) return "";
    const c = canCommission();
    return `<span class="wkact"><button type="button" class="btn small" data-w="open"${c.allowed ? "" : " disabled"}>Commission something</button>${c.allowed ? (S.openErr ? `<span class="mnote" role="alert">${esc(S.openErr)}</span>` : "") : `<span class="mnote">${esc(c.reason || "")}</span>`}</span>`;
  }
  const count = () => S.total;
  /** The all-tickets list: a row each, a chip per state, "More". @rule 801.2 */
  function allHTML() {
    const A = S.all, states = ["Draft", "Proposed", "Ready", "Approved", "Building", "Done", "Refused", "Failed", "Shelved"].filter((s) => S.counts[s]);
    const chip = (s, label) => `<button type="button" class="pill tstate" data-w="filter" data-state="${esc(s)}" aria-pressed="${A.state === s}">${esc(label)}</button>`;
    return `<div class="wk"><div class="wkmain"><section class="sw wkl wkall" aria-label="All tickets"><div class="swh"><h2>All tickets</h2><span class="m">${esc(`${S.total} ${S.total === 1 ? "ticket" : "tickets"}`)}</span><button type="button" class="linkbtn" data-w="main">← Workshop</button></div>
<div class="tfilter">${chip("", `All ${S.total}`)}${states.map((s) => chip(s, `${s} ${S.counts[s]}`)).join("")}</div>
${A.rows.length ? `<ul class="tlist">${A.rows.map((t) => rowHTML(t, true)).join("")}</ul>` : `<p class="mnote">No tickets.</p>`}${A.err ? `<p class="notice err" role="alert">${esc(A.err)}</p>` : ""}${A.next ? `<div class="row"><button type="button" class="btn ghost small" data-w="more">More</button></div>` : ""}</section></div></div>`;
  }
  /** The Workshop tab: the tickets first, then the catalog's groups. @rule 801.2 */
  function tabHTML() {
    if (S.view === "all") return allHTML();
    return `<div class="wk"><div class="wkmain"><section class="sw wkl" aria-label="Workshop"><div class="swh"><h2>Workshop</h2><span class="m">${count() ? esc(`${count()} ${count() === 1 ? "ticket" : "tickets"}`) : ""}</span>${commissionButton()}</div>
${S.list.length ? `<ul class="tlist">${S.list.map((t) => rowHTML(t)).join("")}</ul>` : `<p class="mnote">No tickets yet.</p>`}${S.total ? `<button type="button" class="linkbtn" data-w="all">All tickets (${esc(S.total)})</button>` : ""}</section>
<div class="cbox wkcat"><h2 class="crow-h">Catalog</h2><p class="mnote" data-slot="catalog-entries">No entries yet.</p></div></div></div>`;
  }
  /** The Summary's block: the newest tickets and the way into the tab. @rule 801.2 */
  function summaryHTML() {
    const top = S.list.slice(0, 3);
    return `<section class="sw cat" aria-label="Workshop"><div class="swh"><h2>Workshop</h2><button type="button" class="linkbtn" data-tab="workshop">Open the Workshop →</button></div>${top.length ? `<ul class="tlist">${top.map((t) => rowHTML(t)).join("")}</ul>` : `<p class="mnote">No tickets yet.</p>`}</section>`;
  }

  // ---- the ticket page (a card) ----------------------------------------------------------------------------------
  /** @rule 801.2 */
  function formFrom(t) {
    const f = { n: t.n, title: t.title, brief: t.brief, entries: t.makes.filter((m) => m.kind === "entry").map((m) => m.name).join("\n"),
      rules: t.makes.filter((m) => m.kind === "rule" && m.num).map((m) => m.num).join(", "), estimate: t.estimate, running_cost: t.running_cost, tasks: t.tasks.map((x) => x.text).join("\n") };
    f.was = { entries: f.entries, rules: f.rules, held: t.makes.length };   // what the lists said when the form opened
    return f;
  }
  /** @rule 801.2 */
  const makesOf = (f) => [...lines(f.entries).map((name) => ({ kind: "entry", name })), ...String(f.rules || "").split(/[\s,]+/).filter(Boolean).map((num) => ({ kind: "rule", num }))];
  function bodyOf(f) {
    const b = { title: f.title, brief: f.brief, estimate: Number(f.estimate), running_cost: f.running_cost, tasks: lines(f.tasks) };
    // The lists are sent only if the player changed them: what Gremlin drafted (kinds, sizes, a rule's draft) is kept when they didn't touch it.
    if (!f.was || f.entries !== f.was.entries || f.rules !== f.was.rules) b.makes = makesOf(f);
    return b;
  }
  /** @rule 801.3 */
  const makesNothing = (f) => (f.was && f.entries === f.was.entries && f.rules === f.was.rules ? !f.was.held : !makesOf(f).length);
  /** @rule 801.2 */
  function formHTML(t) {
    const f = S.form;
    const off = S.busy ? " disabled" : "";
    const nothing = makesNothing(f);
    const can = t.can.confirm.allowed;
    return `<div class="pf wkform"><label for="wfTitle">Title</label><input id="wfTitle" maxlength="80" value="${esc(f.title)}"${off}>
<label for="wfBrief">Brief</label><textarea id="wfBrief" rows="4" maxlength="2000"${off}>${esc(f.brief)}</textarea>
<label for="wfEntries">Catalog entries</label><textarea id="wfEntries" rows="2"${off}>${esc(f.entries)}</textarea>
<label for="wfRules">Rules</label><input id="wfRules" value="${esc(f.rules)}"${off}>
<label for="wfEstimate">Nights</label><input id="wfEstimate" type="number" min="1" max="99" step="1" value="${esc(f.estimate)}"${off}>
<label for="wfCost">Running cost</label><input id="wfCost" maxlength="200" value="${esc(f.running_cost)}"${off}>
<label for="wfTasks">Tasks</label><textarea id="wfTasks" rows="3"${off}>${esc(f.tasks)}</textarea>
<label>Price</label><p class="wkprice">${esc(points(t.price))}${t.price_reason ? `<span class="mnote"> · ${esc(t.price_reason)}</span>` : ""}</p>
${S.err ? `<p class="notice err" role="alert">${esc(S.err)}</p>` : ""}${S.note ? `<p class="vmsg" role="status">${esc(S.note)}</p>` : ""}
<div class="row"><button class="btn small" type="button" data-w="confirm"${off}${can && !nothing ? "" : " disabled"}>Put it on tomorrow's ballot</button><button class="btn ghost small" type="button" data-w="save"${off}${t.can.edit.allowed ? "" : " disabled"}>Save</button>${chat && chat() && player() ? `<button class="btn ghost small" type="button" data-w="gremlin">Talk to Gremlin</button>` : ""}${can ? `<span class="mnote" id="wfWhy"${nothing ? "" : " hidden"}>It makes nothing yet.</span>` : `<span class="mnote">${esc(t.can.confirm.reason || "")}</span>`}</div></div>`;
  }
  /** @rule 801.2 */
  function makesHTML(t) {
    return t.makes.length ? `<span class="makes">${t.makes.map((m) => (m.kind === "rule" ? `<span class="mk dim">${m.num ? rpill(m.num) : esc(m.draft || "New rule")}</span>` : `<span class="mk dim">${esc(m.name)}</span>`)).join("")}</span>` : '<span class="mnote">Nothing</span>';
  }
  /** @rule 801.2, 801.4, 803.1 */
  function factsHTML(t) {
    const row = (k, v) => `<div class="tr"><dt>${k}</dt><dd>${v}</dd></div>`;
    return `<dl class="tdl">${row("Brief", `<span class="tbrief">${esc(t.brief) || '<span class="mnote">Empty</span>'}</span>`)}${row("Makes", makesHTML(t))}${row("Estimate", esc(nights(t.estimate)))}
${row("Price", `${esc(points(t.price))}${t.price_reason ? `<span class="mnote"> · ${esc(t.price_reason)}</span>` : ""}`)}${t.running_cost ? row("Running cost", esc(t.running_cost)) : ""}${t.proposal ? row("Proposal", `<span class="ppill">${esc(t.proposal)}</span>`) : ""}${t.queue ? row("Queue", `Place ${esc(t.queue)}`) : ""}</dl>`;
  }
  /** @rule 801.2 */
  const tasksHTML = (t) => (t.tasks.length ? `<section class="tsec"><h3>Tasks</h3><ul class="ttasks">${t.tasks.map((x) => `<li${x.done ? ' class="done"' : ""}><span class="ck" aria-hidden="true">${x.done ? "✓" : ""}</span>${esc(x.text)}${x.done && x.done_day ? `<span class="mnote"> · day ${esc(x.done_day)}</span>` : ""}</li>`).join("")}</ul></section>` : "");
  /** @rule 801.2 */
  const logHTML = (t) => (t.log.length ? `<section class="tsec"><h3>Log</h3><ul class="tlog">${t.log.map((l) => `<li><b class="mono">${l.day ? `Day ${esc(l.day)}` : esc(when(l.at))}</b> ${esc(l.text)}</li>`).join("")}</ul></section>` : "");
  /** @rule 804.1 */
  function threadHTML(t) {
    const author = (x) => (x.by ? pill(x.by, false) : `<span class="plpill npc">${x.author === "gremlin" ? "Gremlin" : "Chalant"}</span>`);
    const posts = t.posts.length ? `<ul class="tposts">${t.posts.map((x) => `<li>${author(x)}<span class="mnote mono">${esc(when(x.at))}</span><p>${esc(x.body)}</p></li>`).join("")}</ul>` : "";
    // the lock (rule 107.1) keeps the form but turns it off, with the lock's sentence; a visitor has no form
    const can = t.can.post, off = S.busy || !can.allowed;
    const form = can.allowed || can.locked ? `<div class="pf wkpost"><label for="wkPost">Post</label><textarea id="wkPost" rows="3" maxlength="2000"${off ? " disabled" : ""}>${esc(S.draftPost[t.n] || "")}</textarea>${can.locked ? `<p class="mnote">${esc(can.reason)}</p>` : ""}${S.err && !t.can.edit.allowed ? `<p class="notice err" role="alert">${esc(S.err)}</p>` : ""}<div class="row"><button class="btn small" type="button" data-w="post"${off ? " disabled" : ""}>Post</button></div></div>` : "";
    return `<section class="tsec"><h3>Discussion</h3>${posts}${form}</section>`;
  }
  /** A refused or failed ticket of yours can be reopened as a draft (rule 801.5); the lock turns the button off with its sentence. @rule 801.5 */
  function reopenHTML(t) {
    if (!t.mine || !(t.state === "Refused" || t.state === "Failed")) return "";
    const c = t.can.reopen, off = S.busy || !c.allowed;
    return `<div class="row wkreopen"><button class="btn small" type="button" data-w="reopen"${off ? " disabled" : ""}>Reopen as a draft</button>${c.allowed ? "" : `<span class="mnote">${esc(c.reason || "")}</span>`}${S.err && !t.can.edit.allowed ? `<p class="notice err" role="alert">${esc(S.err)}</p>` : ""}</div>`;
  }
  /** The ticket card. @rule 801.2, 804.1 */
  function card(spec) {
    const n = spec.key;
    if (!(n in S.detail)) return null;
    const t = S.detail[n];
    if (!t) return { cls: "crit tk", label: n, backLabel: n, html: `<div class="mtop"><div class="cart"><span class="wpill big">${esc(n)}</span></div></div>` };
    const editing = t.can.edit.allowed || (t.mine && t.state === "Draft");
    if (editing && (!S.form || S.form.n !== n)) S.form = formFrom(t);
    return { cls: "crit tk", label: `${t.n} ${t.title || "Untitled"}`, backLabel: t.n,
      html: `<div class="mtop"><div class="cart"><span class="wpill big">${esc(t.n)}</span></div><h2>${esc(t.title || "Untitled")}</h2><span class="mmeta">${pill(t.by, t.mine)}</span><span class="mpill">${esc(t.state)}</span></div>
${editing ? formHTML(t) : factsHTML(t)}${reopenHTML(t)}${editing ? "" : tasksHTML(t)}${logHTML(t)}${threadHTML(t)}` };
  }

  // ---- the clicks and keystrokes ---------------------------------------------------------------------------------
  /** @rule 801.2 */
  async function save(n) {
    const r = await api(`/api/tickets/${encodeURIComponent(n)}/edit`, bodyOf(S.form));
    if (r.ok) { S.detail[n] = r.data.ticket; return true; }
    S.err = (r.data && r.data.error) || "Something went wrong.";
    return false;
  }
  /** @rule 801.1, 801.2, 804.1 */
  async function click(el) {
    const a = el.dataset.w;
    const cur = cards.current();
    const n = cur && cur.kind === "ticket" ? cur.key : null;
    if (a === "open") {
      S.openErr = "";
      const r = await api("/api/tickets", {});
      if (!r.ok) { S.openErr = (r.data && r.data.error) || "Something went wrong."; await refresh(); return; }
      await load();
      await open(r.data.ticket, false);
      const c = chat && chat();
      if (c) await c.attach(r.data.ticket, { open: true });   // the chat opens on the new draft (rule 801.2)
      return;
    }
    if (a === "all" || a === "main" || a === "filter" || a === "more") {
      if (S.busy) return;
      S.busy = true;
      try {
        if (a === "main") S.view = "main";
        else { S.view = "all"; if (a !== "more") { S.all.state = a === "filter" ? el.dataset.state || "" : S.all.state; S.all.next = null; } await loadAll(a !== "more"); }
      } finally { S.busy = false; }
      await refresh();
      return;
    }
    if (a === "gremlin") { const c = chat && chat(); if (c && n) await c.attach(n, { open: true }); return; }
    if (!n || S.busy) return;
    S.busy = true; S.err = ""; S.note = ""; cards.redraw();
    try {
      if (a === "save") { if (await save(n)) { S.form = null; S.note = "Saved."; } }
      else if (a === "confirm") {
        if (await save(n)) {
          const r = await api(`/api/tickets/${encodeURIComponent(n)}/confirm`, {});
          if (r.ok) { S.detail[n] = r.data.ticket; S.form = null; S.note = r.data.message || ""; }
          else { S.err = (r.data && r.data.error) || "Something went wrong."; await loadOne(n); S.form = null; }
          await refresh();
        }
      } else if (a === "reopen") {
        const r = await api(`/api/tickets/${encodeURIComponent(n)}/reopen`, {});
        if (r.ok) { S.detail[n] = r.data.ticket; S.form = null; await refresh(); } else { S.err = (r.data && r.data.error) || "Something went wrong."; await loadOne(n); }
      } else if (a === "post") {
        const ta = document.getElementById("wkPost");
        const body = ta ? ta.value : "";
        S.draftPost[n] = body;
        const r = await api(`/api/tickets/${encodeURIComponent(n)}/post`, { body });
        if (r.ok) { S.detail[n] = r.data.ticket; S.draftPost[n] = ""; } else S.err = (r.data && r.data.error) || "Something went wrong.";
      }
    } finally { S.busy = false; cards.redraw(); }
  }
  const FIELD = { wfTitle: "title", wfBrief: "brief", wfEntries: "entries", wfRules: "rules", wfEstimate: "estimate", wfCost: "running_cost", wfTasks: "tasks" };
  /** @rule 801.2, 804.1 */
  function input(el) {
    if (Object.hasOwn(FIELD, el.id) && S.form) {
      S.form[FIELD[el.id]] = el.value;
      // the Put-it-on-the-ballot button follows what the form makes (rule 801.3), without redrawing under the caret
      const b = document.querySelector('#mroot [data-w="confirm"]');
      const why = document.getElementById("wfWhy"); if (why) why.hidden = !makesNothing(S.form);
      if (b) b.disabled = S.busy || makesNothing(S.form) || !(S.detail[S.form.n] && S.detail[S.form.n].can.confirm.allowed);
    } else if (el.id === "wkPost") {
      const cur = cards.current();
      if (cur && cur.kind === "ticket") S.draftPost[cur.key] = el.value;
    }
  }

  /** A ticket page the chat window got back from a turn (Gremlin wrote the draft): the card shows it and the form is made again from it. @rule 801.2 */
  function apply(t) {
    S.detail[t.n] = t;
    if (S.form && S.form.n === t.n) S.form = null;
    if (cards.isOpen && cards.isOpen()) cards.redraw();
  }

  return { load, count, tabHTML, summaryHTML, card, open, click, input, apply, list: () => S.list };
}
