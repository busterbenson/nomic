// The catalog's three claim checks (docs/catalog.md section 2), run by the bundler on every game and by npm test on the starter pack.
// Kept apart from claims.js, which the Worker also imports: this one reads code with esbuild (src/engine/lint.js) and runs at build time only.
//   (a) each attribute a module exports is defined by a rule the game's text has (and one rule per key: buildRegistry refuses two)
//   (b) rule code reads an attribute only through attr(entry, "key"): a literal key the registry has, so code cannot read flavor or a typo,
//       and it does not reach into an entry's `attrs` or `flavor` itself
//   (c) each attribute a kind needs has a type, and agrees with the registry when a rule also defines it
import { VALUE_TYPES, definitionOf } from "../lib/catalog.js";
import { canonical } from "./lint.js";

/**
 * The problems (empty = fine). `registry` and `required` are what the modules export (buildRegistry in src/lib/catalog.js); `known` is the
 * rule and clause numbers of the game's RULES.md; `sources` maps each module's file name to its source.
 * @rule 703.1
 */
export function catalogClaimProblems({ registry = {}, required = {}, known, sources = {} }) {
  return [...definedProblems(registry, known), ...readProblems(registry, sources), ...requiredProblems(registry, required)];
}

/** (a) Each registry key is defined by a rule the text has. @rule 703.3 */
function definedProblems(registry, known) {
  return Object.values(registry).filter((d) => !known.has(String(d.rule))).map((d) => `attribute ${d.key} is defined by rule ${d.rule}, which RULES.md does not have (703.3)`);
}

/** (b) How rule code reads an attribute. @rule 703.2 */
function readProblems(registry, sources) {
  const problems = [];
  for (const [file, src] of Object.entries(sources)) {
    let calls;
    try { calls = attrCalls(src); } catch { problems.push(`${file} does not parse, so its attr() calls cannot be checked (703.2)`); continue; }
    for (const c of calls) {
      if (c.problem) problems.push(`${file}:${c.line} ${c.problem} (703.2)`);
      else if (c.key === null) problems.push(`${file}:${c.line} attr() needs a literal key, like attr(entry, "speed"), so the check can see which attribute it reads (703.2)`);
      else if (!Object.hasOwn(registry, c.key)) problems.push(`${file}:${c.line} attr(..., "${c.key}") reads an attribute no rule defines (703.1)`);
    }
  }
  return problems;
}

/** (c) Each attribute a kind needs has a type, and agrees with the registry. @rule 704.1 */
function requiredProblems(registry, required) {
  const problems = [];
  for (const [kind, list] of Object.entries(required)) {
    for (const a of list) {
      if (!VALUE_TYPES.includes(a.type)) problems.push(`rule 704 needs ${a.key} for a ${kind} but gives it no type (704.1)`);
      const d = definitionOf({ registry }, kind, a.key);
      if (d && d.type !== a.type) problems.push(`rule 704 needs ${a.key} for a ${kind} as a ${a.type}, but rule ${d.rule} defines it as a ${d.type} (704.1)`);
    }
  }
  return problems;
}

/**
 * What a rule module does with attr and with an entry's attributes, read from the code as the engine reads it (esbuild prints it back with
 * the comments gone): {line, key} for each attr(...) call (key null when it is not a string literal), and {line, problem} for each use of
 * `attr` that is not a plain call (`E.attr(...)`, `const g = attr`) and each read of an entry's `.attrs` or `.flavor`.
 * @rule 703.2
 */
export function attrCalls(src) {
  const code = canonical(src).replace(/^\s*(?:import|export)\b[^;"]*?\bfrom\s*"[^"]*";?[ \t]*$/gm, (m) => m.replace(/[^\n]/g, " "));
  const out = [];
  /** @rule 703.2 */
  const lineAt = (i) => code.slice(0, i).split("\n").length;
  // blank out the text of string literals (keeping their quotes and length), so a word inside a string is not read as code
  const bare = blankStrings(code);
  for (const m of bare.matchAll(/(?<![\w$])attr(?![\w$])/g)) {
    const before = bare.slice(0, m.index).trimEnd().slice(-1), after = bare.slice(m.index + 4).trimStart()[0];
    if (before === ".") { out.push({ line: lineAt(m.index), problem: "attr must be called by its own name, attr(entry, \"key\"), not through another object" }); continue; }
    if (after !== "(") { out.push({ line: lineAt(m.index), problem: "attr must be called as attr(entry, \"key\"), not passed around or renamed" }); continue; }
    let depth = 1, i = bare.indexOf("(", m.index) + 1;
    let argStart = i;
    const args = [];
    for (; i < bare.length && depth > 0; i++) {
      const ch = bare[i];
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") { depth--; if (depth === 0) args.push(code.slice(argStart, i)); }
      else if (ch === "," && depth === 1) { args.push(code.slice(argStart, i)); argStart = i + 1; }
    }
    const lit = /^\s*"([^"\\]*)"\s*$/.exec(args[1] ?? "");
    out.push({ line: lineAt(m.index), key: lit ? lit[1] : null });
  }
  for (const m of bare.matchAll(/\??\.\s*(attrs|flavor)(?![\w$])/g)) out.push({ line: lineAt(m.index), problem: `read an entry's ${m[1]} directly; use attr(entry, "key")` });
  for (const m of code.matchAll(/\[\s*"(attrs|flavor)"\s*\]/g)) out.push({ line: lineAt(m.index), problem: `read an entry's ${m[1]} directly; use attr(entry, "key")` });
  return out.sort((a, b) => a.line - b.line);
}

/** The code with the inside of every string and template literal replaced by spaces. @rule 703.2 */
function blankStrings(code) {
  let out = "", q = null;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (q) {
      if (ch === "\\") { out += "  "; i++; continue; }
      if (ch === q) { q = null; out += ch; continue; }
      out += ch === "\n" ? "\n" : " ";
    } else {
      if (ch === '"' || ch === "'" || ch === "`") q = ch;
      out += ch;
    }
  }
  return out;
}
