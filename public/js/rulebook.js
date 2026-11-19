// The rulebook: a game's RULES.md parsed into hundreds blocks, rules and clauses, and drawn as the page's primary UI.
//   parseRules(md)                      -> { intro, sections, byNum, warnings }
//   mountRulebook(root, md, options)    draws it into `root`; options: { settings, revisions }
// The file's convention (templates/RULES.md): "## 100. Title [unanimous]" is a block ([u] and [majority] / [m] work too),
// "### 101 Title" a rule (it may carry its own mark, which overrides its block's), "**101.1** text" a clause. File order is
// reading order. Every rule is shown with its revision; `revisions` maps a rule number to its passed changes, newest
// first: [{ rev, n: "P15" }]. A rule with none is rev 1, the text it was written with.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MARKS = { u: "unanimous", m: "majority", unanimous: "unanimous", majority: "majority" };
const blockOf = (n) => String(Math.floor(parseInt(n, 10) / 100) * 100);

export function parseRules(md) {
  md = String(md || "").replace(new RegExp("<" + "!--[\\s\\S]*?--" + ">", "g"), "");   // the template opens with an HTML comment
  const out = { intro: [], sections: [], byNum: {}, warnings: [] };
  let sec = null, rule = null, cl = null, para = [], list = null;
  const lines = md.split("\n");
  const target = () => cl || rule;
  let startAt = 0;   // the line the paragraph being collected began on
  const pushPara = (p) => {
    const t = target();
    if (t) t.paras.push(p);
    else if (!sec) out.intro.push(p);
    else warn(startAt, "Text under block " + sec.num + " comes before its first rule, so it is not shown.");
  };
  const flush = () => { if (para.length) { pushPara({ t: "p", s: para.join(" ") }); para = []; } if (list) { pushPara({ t: "ul", items: list }); list = null; } };
  const warn = (i, t) => out.warnings.push("Line " + (i + 1) + ": " + t);
  const claim = (num, i) => { if (out.byNum[num]) warn(i, "Number " + num + " is used twice."); };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    let m;
    if (/^# /.test(line)) { flush(); continue; }
    if ((m = line.match(/^##\s+(\d+)\.\s+(.+?)\s*(?:\[(unanimous|majority|u|m)\])?$/))) {
      flush();
      const num = m[1], mark = m[3] ? MARKS[m[3]] : null;
      if (parseInt(num, 10) % 100) warn(i, "Block " + num + " is not a multiple of 100.");
      if (!mark) warn(i, "Block " + num + " does not say [unanimous] or [majority].");
      if (sec && parseInt(num, 10) <= parseInt(sec.num, 10)) warn(i, "Block " + num + " comes after block " + sec.num + ".");
      claim(num, i);
      sec = { kind: "block", num, title: m[2], change: mark, rules: [] };
      out.sections.push(sec); out.byNum[num] = sec; rule = null; cl = null;
      continue;
    }
    if ((m = line.match(/^###\s+(\d{3})\s+(.+?)\s*(?:\[(unanimous|majority|u|m)\])?$/))) {
      flush();
      if (!sec) { warn(i, "Rule " + m[1] + " is outside any block."); continue; }
      if (blockOf(m[1]) !== sec.num) warn(i, "Rule " + m[1] + " is in block " + sec.num + ".");
      claim(m[1], i);
      rule = { kind: "rule", num: m[1], title: m[2], sec, clauses: [], paras: [], mark: m[3] ? MARKS[m[3]] : null };
      sec.rules.push(rule); out.byNum[rule.num] = rule; cl = null;
      continue;
    }
    if ((m = line.match(/^\*\*(\d{3}\.\d+)\*\*\s*(.*)$/))) {
      flush();
      if (!rule) { warn(i, "Clause " + m[1] + " is outside any rule."); continue; }
      if (m[1].split(".")[0] !== rule.num) warn(i, "Clause " + m[1] + " is in rule " + rule.num + ".");
      claim(m[1], i);
      cl = { kind: "clause", num: m[1], rule, paras: [] };
      rule.clauses.push(cl); out.byNum[cl.num] = cl; para = m[2] ? [m[2]] : []; startAt = i;
      continue;
    }
    if ((m = line.match(/^- (.*)$/))) { if (para.length) { pushPara({ t: "p", s: para.join(" ") }); para = []; } if (!list) startAt = i; (list = list || []).push(m[1]); continue; }
    if (!line) { flush(); continue; }
    if (list && !para.length && /^\s+\S/.test(lines[i])) { list[list.length - 1] += " " + line; continue; }   // an indented line continues the list item above
    if (list) { pushPara({ t: "ul", items: list }); list = null; }   // a plain line after list items ends the list
    if (!para.length) startAt = i;
    para.push(line);
  }
  flush();
  return out;
}

export const markOf = (rule) => rule.mark || rule.sec.change || "majority";
const paraText = (p) => (p.t === "p" ? p.s : p.items.join(" "));
const plainOf = (r) => [r.num, r.title, ...r.paras.map(paraText), ...r.clauses.map((c) => c.num + " " + c.paras.map(paraText).join(" "))].join(" ").replace(/\*\*|`/g, "").replace(/\[setting: ([\w.]+)\]/g, "$1 ");
const settingText = (v) => (v && typeof v === "object" ? Object.values(v).join("×") : typeof v === "boolean" ? (v ? "on" : "off") : String(v));
const previewOf = (r) => { const p = r.paras[0] || (r.clauses[0] && r.clauses[0].paras[0]); return p ? paraText(p).replace(/\*\*|`/g, "").replace(/\s*\[setting: [\w.]+\]/g, "").trim() : ""; };
export const hl = (html, q) => {
  if (!q) return html;
  const re = new RegExp("(" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
  return html.split(/(<[^>]+>|&[a-z]+;|&#\d+;)/).map((seg) => (seg.startsWith("<") || seg.startsWith("&") ? seg : seg.replace(re, "<mark>$1</mark>"))).join("");
};
const id = (num) => "r-" + num.replace(/\./g, "-");

// The older format (no blocks): headings, paragraphs, lists, bold, code. A game whose RULES.md has not been renumbered yet still reads.
export function renderMarkdown(md) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
  md = md.replace(new RegExp("<" + "!--[\\s\\S]*?--" + ">", "g"), "");
  const out = []; let para = [], list = [];
  const fp = () => { if (para.length) { out.push("<p>" + inline(para.join(" ")) + "</p>"); para = []; } };
  const fl = () => { if (list.length) { out.push("<ul>" + list.map((i) => "<li>" + inline(i) + "</li>").join("") + "</ul>"); list = []; } };
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd(); let m;
    if ((m = line.match(/^(#{1,3}) (.*)$/))) { fp(); fl(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); }
    else if ((m = line.match(/^\s*[-*] (.*)$/))) { fp(); list.push(m[1]); }
    else if (!line.trim()) { fp(); fl(); }
    else if (list.length && /^\s+/.test(raw)) list[list.length - 1] += " " + line.trim();
    else { fl(); para.push(line.trim()); }
  }
  fp(); fl();
  return out.join("\n");
}

export function mountRulebook(root, md, { settings = {}, revisions = {} } = {}) {
  const RB = parseRules(md);
  if (!RB.sections.length) { root.innerHTML = `<div class="rb-plain"><div class="rbhead"><h2>Rulebook</h2></div>${renderMarkdown(String(md || ""))}</div>`; return { rulebook: RB }; }
  const state = { q: "", open: new Set(RB.sections.flatMap((s) => s.rules.map((r) => r.num))), closedSec: new Set(), history: new Set() };
  const allNums = RB.sections.flatMap((s) => s.rules.map((r) => r.num));
  const inline = (s, q) => {
    let h = esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
    h = h.replace(/\[setting: ([\w.]+)\]/g, (m, k) => `<span class="setting">${k} <b>${esc(settingText(settings[k] === undefined ? "?" : settings[k]))}</b></span>`);
    h = h.replace(/\b(rules?|block) (\d{3}(?:\.\d+)?)\b/gi, (m, w, n) => (RB.byNum[n] ? `${w} <a class="xref" href="#${id(n)}" data-goto="${n}">${n}</a>` : m));
    return hl(h, q);
  };
  const paras = (ps, q) => ps.map((p) => (p.t === "p" ? `<p>${inline(p.s, q)}</p>` : `<ul>${p.items.map((i) => `<li>${inline(i, q)}</li>`).join("")}</ul>`)).join("");
  const revOf = (num) => { const h = revisions[num]; return h && h.length ? h[0] : { rev: 1 }; };
  const markPill = (m) => `<span class="pill ${m === "unanimous" ? "core" : ""}">${m}</span>`;

  function railHTML() {
    return RB.sections.map((s) => `<li><a class="sec" href="#${id(s.num)}" data-goto="${s.num}"><span class="n">${s.num}</span>${esc(s.title)}${s.change === "unanimous" ? ' <span class="pill core tiny">unanimous</span>' : ""}</a><ol>${s.rules.map((r) => `<li><a href="#${id(r.num)}" data-goto="${r.num}"><span class="n">${r.num}</span>${esc(r.title)}</a></li>`).join("")}</ol></li>`).join("");
  }
  function bodyHTML() {
    const q = state.q.trim(), ql = q.toLowerCase();
    let matches = 0, h = "";
    for (const s of RB.sections) {
      let rh = "", secMatch = 0;
      for (const r of s.rules) {
        if (q && !plainOf(r).toLowerCase().includes(ql) && !(r.title + " " + s.title).toLowerCase().includes(ql)) continue;
        secMatch++; matches++;
        const open = q ? true : state.open.has(r.num), rv = revOf(r.num), own = r.mark && r.mark !== s.change;
        const chips = `<span class="rev">rev ${rv.rev}${rv.n ? " · " + esc(rv.n) : ""}</span>`
          + (own ? `<span class="pill ${r.mark === "unanimous" ? "core" : ""}" title="This rule's own mark overrides its block's.">${r.mark} to change</span>` : "");
        const body = paras(r.paras, q) + r.clauses.map((c) => `<div class="clause" id="${id(c.num)}"><span class="cn">${hl(c.num, q)}</span><div>${paras(c.paras, q)}</div><button class="linkbtn" type="button" data-link="${c.num}" aria-label="Copy link to ${c.num}">Link</button></div>`).join("");
        const hist = state.history.has(r.num)
          ? `<ul class="hist">${(revisions[r.num] && revisions[r.num].length ? revisions[r.num] : []).map((e) => `<li><span class="hh"><b>rev ${e.rev}</b>${e.n ? `<span class="pn">${esc(e.n)}</span>` : ""}</span></li>`).join("")}<li><span class="hh"><b>rev 1</b><span class="m">the text this rule was written with</span></span></li></ul>` : "";
        rh += `<div class="rule" id="${id(r.num)}" data-open="${open ? 1 : 0}" data-num="${r.num}">
<div class="rh"><h3><button type="button" aria-expanded="${open}" aria-controls="rb-${r.num}" data-toggle="${r.num}"><span class="caret" aria-hidden="true">▸</span><span class="rn">${hl(r.num, q)}</span><span class="rt">${hl(esc(r.title), q)}</span><span class="chips">${chips}</span><span class="prev">${esc(previewOf(r))}</span></button></h3><button class="linkbtn" type="button" data-link="${r.num}" aria-label="Copy link to rule ${r.num}">Link</button></div>
<div class="rbody" id="rb-${r.num}" ${open ? "" : "hidden"}>${body}${hist}<div class="ract"><button class="btn ghost small" type="button" data-hist="${r.num}" aria-expanded="${state.history.has(r.num)}">${state.history.has(r.num) ? "Hide history" : "History"}</button></div></div></div>`;
      }
      if (q && !secMatch) continue;
      const sopen = q ? true : !state.closedSec.has(s.num);
      h += `<section class="rsec" id="${id(s.num)}" data-sec="${s.num}"><h2><button type="button" aria-expanded="${sopen}" data-sectoggle="${s.num}"><span class="caret" aria-hidden="true">▸</span><span class="sn">${s.num}</span><span>${esc(s.title)}</span></button>${markPill(s.change || "majority")}</h2><div ${sopen ? "" : "hidden"}>${rh}</div></section>`;
    }
    return { html: h || '<p class="muted none">No rule matches.</p>', matches, q };
  }

  root.innerHTML = `<div class="rb">
<nav class="rail" aria-label="Contents"><h3>Contents</h3><ol id="rb-rail">${railHTML()}</ol></nav>
<div class="rbmain">
<div class="rbhead"><h2>Rulebook</h2></div>
<div class="toolbar"><div class="search"><svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6.5" style="fill:none;stroke:var(--ink-muted);stroke-width:2.2"/><path d="M15 15l6 6" style="stroke:var(--ink-muted);stroke-width:2.2"/></svg><input class="input" id="rb-q" type="search" placeholder="Search rules, or a number" aria-label="Search the rules"></div>
<button class="btn ghost small jump" id="rb-jump" type="button" aria-expanded="false">Jump to</button><button class="btn ghost small" id="rb-all" type="button">Collapse all</button>
<div class="sresult" id="rb-result" hidden></div><div class="crumb" id="rb-crumb"></div></div>
<div class="jumplist" id="rb-jumplist" hidden><ol>${railHTML()}</ol></div>
${RB.warnings.length ? `<div class="sheet" role="alert"><b>This file has ${RB.warnings.length} problem${RB.warnings.length === 1 ? "" : "s"}:</b><ul>${RB.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
<div id="rb-body"></div></div></div>`;
  const $ = (sel) => root.querySelector(sel);
  const bodyEl = $("#rb-body");
  const draw = () => {
    const r = bodyEl && bodyEl.isConnected ? bodyHTML() : null;
    if (!r) return;
    bodyEl.innerHTML = r.html;
    const res = $("#rb-result");
    res.hidden = !r.q;
    if (r.q) { const n = RB.byNum[r.q]; res.innerHTML = `${r.matches} rule${r.matches === 1 ? "" : "s"} match “${esc(r.q)}”` + (n && n.kind !== "block" ? ` · <b>Enter</b> to jump to ${esc(r.q)}` : ""); }
    $("#rb-all").textContent = allNums.every((n) => state.open.has(n)) ? "Collapse all" : "Expand all";
  };
  draw();

  function goto(num) {
    const base = num.split(".")[0], r = RB.byNum[base];
    state.q = ""; $("#rb-q").value = "";
    if (r && r.kind === "rule") { state.open.add(base); state.closedSec.delete(r.sec.num); } else if (r) state.closedSec.delete(base);
    draw();
    const el = document.getElementById(id(num));
    if (el) { el.scrollIntoView({ block: "start" }); history.replaceState(null, "", "#" + id(num)); }
  }
  root.addEventListener("click", (e) => {
    const t = e.target.closest("[data-toggle],[data-sectoggle],[data-hist],[data-link],[data-goto],#rb-all,#rb-jump");
    if (!t) return;
    if (t.dataset.toggle) { const n = t.dataset.toggle; state.open.has(n) ? state.open.delete(n) : state.open.add(n); draw(); }
    else if (t.dataset.sectoggle) { const n = t.dataset.sectoggle; state.closedSec.has(n) ? state.closedSec.delete(n) : state.closedSec.add(n); draw(); }
    else if (t.dataset.hist) { const n = t.dataset.hist; state.history.has(n) ? state.history.delete(n) : state.history.add(n); draw(); }
    else if (t.dataset.link) {
      const url = location.origin + location.pathname + "#" + id(t.dataset.link);
      try { navigator.clipboard.writeText(url); t.textContent = "Copied"; setTimeout(() => { t.textContent = "Link"; }, 1200); } catch { history.replaceState(null, "", "#" + id(t.dataset.link)); }
    } else if (t.dataset.goto) { e.preventDefault(); $("#rb-jumplist").hidden = true; $("#rb-jump").setAttribute("aria-expanded", "false"); goto(t.dataset.goto); }
    else if (t.id === "rb-all") { const all = allNums.every((n) => state.open.has(n)); state.open = new Set(all ? [] : allNums); draw(); }
    else if (t.id === "rb-jump") { const l = $("#rb-jumplist"); l.hidden = !l.hidden; t.setAttribute("aria-expanded", String(!l.hidden)); }
  });
  $("#rb-q").addEventListener("input", (e) => { state.q = e.target.value; draw(); });
  $("#rb-q").addEventListener("keydown", (e) => { if (e.key === "Enter" && RB.byNum[state.q.trim()]) { e.preventDefault(); goto(state.q.trim()); } });
  if (location.hash.startsWith("#r-")) { const n = location.hash.slice(3).replace(/-/g, "."); if (RB.byNum[n]) goto(n); }
  window.addEventListener("hashchange", () => { if (location.hash.startsWith("#r-")) { const n = location.hash.slice(3).replace(/-/g, "."); if (RB.byNum[n]) goto(n); } });

  // where the reader is: the rail follows, and on a phone the line under the search says which block
  const crumb = $("#rb-crumb"), rail = $("#rb-rail");
  let tick = false;
  const spy = () => {
    tick = false;
    const secs = [...root.querySelectorAll(".rsec")]; let cur = null;
    for (const s of secs) if (s.getBoundingClientRect().top < 150) cur = s;
    const num = cur ? cur.dataset.sec : RB.sections[0].num, sec = RB.byNum[num];
    crumb.textContent = sec ? sec.num + " " + sec.title : "";
    rail.querySelectorAll("a.cur").forEach((a) => a.classList.remove("cur"));
    const a = rail.querySelector(`a.sec[data-goto="${num}"]`); if (a) a.classList.add("cur");
  };
  window.addEventListener("scroll", () => { if (!tick) { tick = true; requestAnimationFrame(spy); } }, { passive: true });
  spy();
  return { rulebook: RB, goto };
}
