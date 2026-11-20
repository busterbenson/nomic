// The lint a game's code must pass before the bundler runs or ships it. Rule code runs inside the platform's own
// isolate (a Worker cannot eval, so it ships in the bundle), and the game's tests run on the build machine, so this
// lint plus the moderator's path allowlist is what stands between a prompt-injected proposal and the platform's secrets.
//
// It reads the code the way the engine will: esbuild parses the TypeScript and prints it back in one canonical form
// (comments gone, `import /* x */ (...)` and `fetch` normalised), and the checks run on that. So a trick in a
// comment, an escape or odd spacing cannot hide anything.
//   KIND "module" (rules/<n>.ts)
//     * the only import is "promptocracy/engine"; no dynamic import(), no import.meta
//     * these names may not appear anywhere: fetch, globalThis, self, window, eval, Function, constructor, __proto__,
//       prototype, Reflect, Proxy, process, env, caches, require, crypto, XMLHttpRequest, WebSocket, WebAssembly,
//       setTimeout, setInterval (strings count: a banned word in a message fails; rephrase it)
//   KIND "test" (rules/*.test.ts), which run on the build machine
//     * imports only node:test, node:assert, node:assert/strict, promptocracy/engine, promptocracy/engine/testing and
//       the game's own rules/<name>.ts files; import.meta is allowed (loadGame(import.meta.url) reads the game); the
//       same banned names apply. A test therefore has no file system, no network, no child process.
//
// This is a source scan, not a sandbox, and a name built at run time (obj["con" + "structor"]) is invisible to it.
// What it leaves open does not reach the platform's secrets: a rule can only reach the outside world through a global
// (fetch, env, caches ...) or a module import, every route to the global object (globalThis, self, window, Function,
// eval, a dynamic import) is banned or refused by workerd itself, and hooks get deep-frozen plain data and never an env,
// a database or a request. The real fix is a sandbox (Cloudflare's Worker Loader with no outbound network); the hook API
// is data in, data out, so moving to it is mechanical.
import { transformSync } from "esbuild";

export const BANNED = Object.freeze([
  "fetch", "globalThis", "self", "window", "eval", "Function", "constructor", "__proto__", "prototype", "Reflect", "Proxy",
  "process", "env", "caches", "require", "crypto", "XMLHttpRequest", "WebSocket", "WebAssembly", "setTimeout", "setInterval",
]);
export const ALLOWED_IMPORT = "promptocracy/engine";
export const TEST_IMPORTS = Object.freeze(["node:test", "node:assert", "node:assert/strict", "promptocracy/engine", "promptocracy/engine/testing"]);
const OWN_FILE = /^\.\/[A-Za-z0-9_-]+(?:\.test)?\.ts$/;

/** The code as the engine reads it: types stripped, comments gone, imports kept as written. @rule 302 */
export function canonical(src) {
  return transformSync(String(src), { loader: "ts", format: "esm", target: "esnext", tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } } }).code;
}

/** Problems (an empty list = the file passes). `name` only labels them; `kind` is "module" or "test". @rule 302 */
export function lintModule(src, name = "module", kind = "module") {
  const problems = [];
  let code;
  try { code = canonical(src); } catch (e) { return [`${name}: does not parse (${String(e.errors?.[0]?.text ?? e.message).slice(0, 120)})`]; }
  /** The 1-based line of a position in the printed code. @rule 302 */
  const lineOf = (i) => code.slice(0, i).split("\n").length;
  /** Whether an import specifier is allowed for this kind of file. @rule 302 */
  const allowed = (spec) => (kind === "test" ? TEST_IMPORTS.includes(spec) || OWN_FILE.test(spec) : spec === ALLOWED_IMPORT);
  const specs = [
    ...code.matchAll(/\b(?:import|export)\b[^;"]*?\bfrom\s*"([^"]*)"/g),
    ...code.matchAll(/^\s*import\s*"([^"]*)"/gm),
  ];
  for (const m of specs) {
    if (!allowed(m[1])) problems.push(`${name}: imports "${m[1]}"; ${kind === "test" ? "a test may import only node:test, node:assert, promptocracy/engine, promptocracy/engine/testing and the game's own rules/<name>.ts" : `a rule module may import only "${ALLOWED_IMPORT}"`}`);
  }
  for (const m of code.matchAll(/\bimport\s*\(/g)) problems.push(`${name}: line ${lineOf(m.index)} uses a dynamic import()`);
  if (kind !== "test") for (const m of code.matchAll(/\bimport\s*\.\s*meta\b/g)) problems.push(`${name}: line ${lineOf(m.index)} uses import.meta`);
  for (const word of BANNED) {
    const m = new RegExp(`(?<![\\w$])${word}(?![\\w$])`).exec(code);
    if (m) problems.push(`${name}: line ${lineOf(m.index)} of the code uses "${word}"; that name is not allowed here`);
  }
  return problems;
}
