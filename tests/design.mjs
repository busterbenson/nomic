// The design port's pure parts, no server: the rulebook parser and its marks, the starter rules' numbering, the one
// palette file and the traced pieces, and the theme's tokens. Run: node tests/design.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join as pjoin } from "node:path";
import { ROOT } from "./lib.mjs";
import { parseRules, markOf, renderMarkdown, hl } from "../public/js/rulebook.js";
import { TRACED, ROLES, FOOT, HEIGHT } from "../public/js/pieces-data.js";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name}${detail ? "  -> " + detail : ""}`); }
};
const J = JSON.stringify;
const read = (p) => readFileSync(pjoin(ROOT, p), "utf8");
const PIECES = JSON.parse(read("src/lib/pieces.json"));

console.log("the rulebook parser");
const T = parseRules(read("templates/RULES.md"));
check("the starter rules parse with no problems: five blocks, 100 to 500, in file order", T.warnings.length === 0 && T.sections.map((s) => s.num).join() === "100,200,300,400,500", J(T.warnings));
check("each block is marked: 100 unanimous, the rest majority; no rule overrides its block", T.sections.map((s) => s.change).join() === "unanimous,majority,majority,majority,majority" && T.sections.every((s) => s.rules.every((r) => r.mark === null)) && T.sections.flatMap((s) => s.rules).every((r) => markOf(r) === r.sec.change));
check("the rules are numbered from 101 within their hundreds block, 23 in all, each under the right block (107 The night is the lock, rule 107.1)", T.sections.map((s) => s.rules.map((r) => r.num).join()).join(" | ") === "101,102,103,104,105,106,107,108,110 | 201,202,203,204 | 301,302 | 401,402,403 | 501,502,503,504,505" && T.sections.every((s) => s.rules.every((r) => Math.floor(Number(r.num) / 100) * 100 === Number(s.num))));
check("every rule has a title and text", T.sections.flatMap((s) => s.rules).every((r) => r.title && (r.paras.length || r.clauses.length)));
check("the intro is the paragraph above the first block, not a rule", T.intro.length === 1 && /rules in effect/.test(T.intro[0].s) && !/2xx/.test(T.intro[0].s));
check("a list inside a rule stays with that rule", parseRules("## 100. A [u]\n\n### 101 One\nEither:\n- this, or\n- that.\n\n### 102 Two\nText.\n").byNum["101"].paras.some((p) => p.t === "ul" && p.items.length === 2));

const sample = `# Rules\n\nIntro.\n\n## 100. Core [u]\n\n### 101 One\nText one.\n\n### 102 Two [m]\n**102.1** Clause a.\n\n**102.2** Clause b\ncontinues.\n\n## 200. Rest [majority]\n\n### 201 Three [unanimous]\nText.\n`;
const S = parseRules(sample);
check("[u] and [m] are short for [unanimous] and [majority], on a block and on a rule", S.sections[0].change === "unanimous" && S.sections[1].change === "majority" && S.byNum["102"].mark === "majority" && S.byNum["201"].mark === "unanimous", J(S.sections.map((s) => s.change)));
check("a rule's own mark overrides its block's: 102 is majority in a unanimous block, 201 unanimous in a majority block", markOf(S.byNum["102"]) === "majority" && markOf(S.byNum["201"]) === "unanimous" && markOf(S.byNum["101"]) === "unanimous");
check("clauses are numbered 102.1, 102.2 under their rule, and a wrapped clause is one paragraph", S.byNum["102"].clauses.map((c) => c.num).join() === "102.1,102.2" && S.byNum["102.2"].paras[0].s === "Clause b continues." && S.warnings.length === 0, J(S.warnings));
const bad = parseRules(`## 150. Odd\n### 151 X\n## 200. Two [m]\n### 301 Wrong block\n### 301 Wrong block\n**302.1** orphan\n`);
check("problems are named with their line: a block not a multiple of 100, a missing mark, a rule in the wrong block, a number used twice, a clause in the wrong rule", bad.warnings.some((w) => /Line 1: Block 150 is not a multiple of 100/.test(w)) && bad.warnings.some((w) => /Line 1: Block 150 does not say/.test(w)) && bad.warnings.some((w) => /Line 4: Rule 301 is in block 200/.test(w)) && bad.warnings.some((w) => /Number 301 is used twice/.test(w)) && bad.warnings.some((w) => /Clause 302.1 is in rule 301/.test(w)), J(bad.warnings));
check("a rule before any block is reported, not lost silently", parseRules("### 101 Loose\ntext\n").warnings.some((w) => /outside any block/.test(w)));
const prose = parseRules("## 100. Core [u]\nProse before any rule.\n\n### 101 One\n**101.1**\n**101.2** Second.\n");
check("prose between a block heading and its first rule is reported (it is not shown), and a clause with no text is still a clause", prose.warnings.length === 1 && /Line 2: Text under block 100 comes before its first rule/.test(prose.warnings[0]) && prose.byNum["101"].clauses.map((c) => c.num).join() === "101.1,101.2" && prose.byNum["101.2"].paras[0].s === "Second.", J(prose.warnings));
check("search highlights words in the text but never inside a tag or an HTML entity (a query 'amp' leaves &amp; alone)", hl("An <b>ample</b> &amp; Tom&#39;s", "amp") === "An <b><mark>amp</mark>le</b> &amp; Tom&#39;s" && hl("a &lt; b", "lt") === "a &lt; b" && hl("plain", "") === "plain");
const wrap = parseRules("## 100. Core [u]\n### 101 One\n- A proposal needs votes\n  from every player.\n- Or not.\nAfter.\n");
check("an indented line continues the list item above it, in order, not a paragraph before the list", J(wrap.byNum["101"].paras) === J([{ t: "ul", items: ["A proposal needs votes from every player.", "Or not."] }, { t: "p", s: "After." }]), J(wrap.byNum["101"].paras));
check("a file in the older format (no blocks) has no sections, so the page falls back to plain markdown", parseRules("# Rules\n\n## Core rules\n\n**101. Follow.** text\n").sections.length === 0 && /<h2>Core rules<\/h2>/.test(renderMarkdown("# Rules\n\n## Core rules\n\n**101. Follow.** text\n")));

console.log("the starter rules renumbered");
const rules = read("templates/RULES.md").replace(/\s+/g, " ");
const keep = [
  ["101", "Every player, and the moderator, must follow the rules in this file as they stand on `main`."],
  ["102", "Adding or removing a player takes a passed proposal."],
  ["104", "A proposal that changes a core rule (1xx) passes only if every player votes yes."],
  ["201", "A game has at most 8 players. [setting: max_players]"],
  ["202", "you move at most once a day."],
  ["301", "If more than half of all players vote to overturn it, the ruling is reversed"],
  ["302", "both changes go live together."],
  ["401", "A player whose proposal passes gets 10 points."],
  ["402", "The first player to reach 100 points wins."],
  ["403", "(Suber's rule 213.)"],
  ["503", "8x8 charted island centered on the origin. [setting: board.island]"],
  ["504", "5x5 square with its four corners cut off. [setting: board.chart_radius]"],
];
check("each old rule's sentences survive word for word under their new number", keep.every(([, t]) => rules.includes(t)), keep.filter(([, t]) => !rules.includes(t)).join(" | "));
check("the renumbering is a map, not a rewrite: old 101-105 stay, 209 to 201, 208 to 202, 205 to 203, 210 to 204, 201 to 301, 204 to 302, 202 to 401, 203 to 402, 206 to 403, 207 to 501-505",
  T.byNum["201"].paras[0].s.startsWith("A game has at most") && T.byNum["202.2"].paras[0].s.startsWith("On your turn") && T.byNum["204"].paras[0].s.startsWith("A player may connect an AI client") && T.byNum["301"].paras[0].s.startsWith("Any player may appeal") && T.byNum["302"].paras[0].s.startsWith("A proposal may change the website") && T.byNum["401"].paras[0].s.startsWith("A player whose proposal passes") && T.byNum["402"].paras[0].s.startsWith("The first player to reach 100") && T.byNum["403"].paras[0].s.startsWith("If the rules are changed so that further play"));

console.log("the day rules (step 1, PR 2)");
check("the day model replaces the turn model: 103 is proposals (no join order), 203 Time (the 24-hour skip) is gone, and 203 Days, 202.1-202.4 and 107.1 are in, worded as approved",
  T.byNum["103"].title === "Proposals" && !/order they joined/.test(rules) && !/skipped for that round/.test(rules) && T.byNum["203"].title === "Days" &&
  T.byNum["202"].clauses.map((c) => c.num).join() === "202.1,202.2,202.3,202.4,202.5" && T.byNum["203"].clauses.map((c) => c.num).join() === "203.1,203.2" && T.byNum["107"].clauses.map((c) => c.num).join() === "107.1" &&
  rules.includes("there is no order of play") && rules.includes("Ending is final: after it they can't move, propose or vote until the next day") && rules.includes("A day runs from midnight to midnight in the game's time zone. [setting: game.timezone]") &&
  rules.includes("A day always runs to midnight, even if every player has ended their turn.") && rules.includes("the game is locked: nobody can move, vote, propose or end their turn, on the site or through an AI client (rule 204)"));
console.log("the proposal rules (step 1, PR 3)");
check("103 Proposals is 103.1-103.4 and 105 Votes needed is 105.1-105.5, worded as approved; the moderator moved to 106",
  T.byNum["103"].clauses.map((c) => c.num).join() === "103.1,103.2,103.3,103.4" && T.byNum["105"].title === "Votes needed" && T.byNum["105"].clauses.map((c) => c.num).join() === "105.1,105.2,105.3,105.4,105.5" &&
  T.byNum["106"].title === "The moderator" && rules.includes("Drafting costs nothing: only a confirmed proposal is the player's one proposal for the day.") &&
  rules.includes("Each confirmed proposal gets the next number (P1, P2, ...) and goes on the next day's ballot.") && rules.includes("A withdrawn proposal doesn't use up the day's proposal.") &&
  rules.includes("The mark sets the votes needed to change, add or repeal any rule in the block.") && rules.includes("The votes a proposal needs are set when it is confirmed, from the marks in effect then.") &&
  rules.includes("Rules marked unanimous, by their block or by their own mark, are the core rules."));
check("108.3 (the moderator names conflicts when drafting) and 110.1 (what no proposal can change, refused at drafting) are in, with only the parts that exist yet",
  T.byNum["108"].clauses.map((c) => c.num).join() === "108.3" && T.byNum["110"].clauses.map((c) => c.num).join() === "110.1" &&
  rules.includes("When drafting, the moderator names any other rule the proposal would conflict with, so the proposer can change that rule too.") &&
  rules.includes("A proposal that would change them is refused when it is drafted.") && !/rule 104\.4|rule 107\.6/.test(T.byNum["110.1"].paras[0].s));
check("505 says what the spawn code does (the chart shape of rule 504.2), not a fixed '2.5 tiles'", !/2\.5 tiles/.test(rules) && rules.includes("every tile that a move onto it would chart (rule 504.2) is already charted"));

console.log("one palette file, one set of pieces");
const hexOk = (h) => /^#[0-9A-Fa-f]{6}$/.test(h);
check("the colors are one list: 16 players, each with a unique lowercase key, a name, and main, shade, tint and deep hex values", PIECES.colors.length === 16 && new Set(PIECES.colors.map((c) => c.key)).size === 16 && PIECES.colors.every((c) => c.key === c.name.toLowerCase() && /^[a-z]+$/.test(c.key) && ["main", "shade", "tint", "deep"].every((k) => hexOk(c[k]))));
check("the monster-only colors are not in it (Bog, Wraith, Hex pink), nor the moderator's lavender", !PIECES.colors.some((c) => /^(bog|wraith|hex pink|lavender)$/i.test(c.name)) && !PIECES.colors.some((c) => ["#6E9A3C", "#471C47", "#AD1A6C", "#6B50A4", "#B7A3EF"].includes(c.main.toUpperCase())));
check("the two neutrals beside Onyx and Chalk are there (Umber, Buff)", ["onyx", "chalk", "umber", "buff"].every((k) => PIECES.colors.some((c) => c.key === k)));
check("a color's shade is darker than its main (Chalk and Buff included), so a piece reads as solid", PIECES.colors.every((c) => { const L = (h) => [1, 3, 5].reduce((a, i, n) => a + parseInt(h.slice(i, i + 2), 16) * [.2126, .7152, .0722][n], 0); return L(c.shade) < L(c.main); }));
check("nine shapes: the eight traced pieces and the pawn, each with art, a footprint, a height and a source palette", PIECES.shapes.length === 9 && PIECES.shapes.some((s) => s.key === "pawn") && PIECES.shapes.every((s) => TRACED[s.key] && TRACED[s.key].body.includes("<path") && ROLES[s.key] && FOOT[s.key] && HEIGHT[s.key] && TRACED[s.key].w > 0 && TRACED[s.key].h > 0) && Object.keys(TRACED).length === 9);
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const near = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i])) <= 40;
check("the art is recolorable: every shape has fills that belong to its main and shade roles (these are what a player's color replaces)", PIECES.shapes.every((s) => { const fills = [...TRACED[s.key].body.matchAll(/fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]); return ["main", "shade"].every((role) => fills.filter((f) => near(f, ROLES[s.key][role])).length >= 1); }));

console.log("the theme");
const css = read("public/theme.css");
const dark = css.slice(css.indexOf("prefers-color-scheme: dark"));
check("lavender is the moderator and UI accent: deep #6B50A4 on light, pale #B7A3EF on dark", /--accent: #6B50A4/.test(css.slice(0, css.indexOf("@media"))) && /--accent: #B7A3EF/.test(dark));
check("the display face is Kyrios first, then Grenze Gotisch", /--font-display: "Kyrios", "AT Kyrios", "Grenze Gotisch"/.test(css));
check("every color token has a dark value (the page is never half dark)", ["--sea", "--surface", "--line", "--ink", "--ink-muted", "--accent", "--on-accent", "--land", "--outline"].every((t) => new RegExp(t + ":").test(dark)));
check("the board's size rule applies to the board svg only, not to the svg each piece is drawn in (a piece keeps its own width and height)", /\.board-wrap>svg\s*\{[^}]*width:100%/.test(read("public/site.css")) && !/\.board-wrap\s+svg\s*\{/.test(read("public/site.css")));
const sizing = read("public/site.css");
check("no size rule reaches an svg through a descendant selector (each piece is an svg nested in the board, the preview, a thumbnail or a scoreboard icon, and keeps its own width and height)", !/\.(pv|players li|opt \.face|board-wrap) svg\s*\{/.test(sizing) && /\.pv>svg\s*\{/.test(sizing) && /\.opt \.thumb>svg\s*\{/.test(sizing) && /\.players li>svg\s*\{/.test(sizing));
check("the pages no longer ship the WebGL board: no three.js in public/ or the Worker's routes", !readdirSync(pjoin(ROOT, "public")).includes("vendor") && !/three/i.test(read("src/index.ts")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
