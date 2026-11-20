// The lint a rule module must pass before it is bundled into the Worker. Rule code runs inside the platform's
// own isolate (a Worker cannot eval, so it ships in the bundle), so this lint plus the moderator's path allowlist
// is what stands between a prompt-injected proposal and the platform's secrets.
//
//   * the only import allowed is "promptocracy/engine" (every other module specifier fails, type-only imports too)
//   * no dynamic import(), no import.meta
//   * these names may not appear anywhere in the file: fetch, globalThis, self, window, eval, Function, constructor,
//     __proto__, prototype, Reflect, Proxy, process, env, caches, require, crypto, XMLHttpRequest, WebSocket,
//     WebAssembly, setTimeout, setInterval
//
// The scan reads the RAW text. Comments and strings are NOT skipped: skipping them needs a tokenizer that knows
// regex literals from division, and every shortcut (a regex literal containing a quote) lets code hide inside a
// "string". So a banned word fails even in a comment or a message; rephrase it.
//
// This is a source scan, not a sandbox. The things it leaves open do not reach the platform's secrets: a rule can
// only reach the outside world through a global (fetch, env, caches ...), and every route to the global object
// (globalThis, self, window, Function, eval, a dynamic import) is banned or refused by workerd itself. Hooks get
// deep-frozen plain data and never an env, a database or a request. The real fix is a sandbox (Cloudflare's
// Worker Loader with no outbound network); the hook API is data in, data out, so moving to it is mechanical.
export const BANNED = Object.freeze([
  "fetch", "globalThis", "self", "window", "eval", "Function", "constructor", "__proto__", "prototype", "Reflect", "Proxy",
  "process", "env", "caches", "require", "crypto", "XMLHttpRequest", "WebSocket", "WebAssembly", "setTimeout", "setInterval",
]);
export const ALLOWED_IMPORT = "promptocracy/engine";

// Returns a list of problems (empty = the module passes). `name` only labels them.
export function lintModule(src, name = "module") {
  const problems = [];
  const text = String(src);
  const lineOf = (i) => text.slice(0, i).split("\n").length;
  for (const m of text.matchAll(/\b(?:import|export)\b[^;'"`]*?\bfrom\s*(["'`])([^"'`]*)\1/g)) {
    if (m[2] !== ALLOWED_IMPORT) problems.push(`${name}: line ${lineOf(m.index)} imports "${m[2]}"; a rule module may import only "${ALLOWED_IMPORT}"`);
  }
  for (const m of text.matchAll(/\bimport\s*(["'`])([^"'`]*)\1/g)) problems.push(`${name}: line ${lineOf(m.index)} has a bare import of "${m[2]}"`);
  for (const m of text.matchAll(/\bimport\s*[(.]/g)) problems.push(`${name}: line ${lineOf(m.index)} uses a dynamic import() or import.meta`);
  for (const m of text.matchAll(/\bexport\s*\*/g)) problems.push(`${name}: line ${lineOf(m.index)} re-exports with export *`);
  for (const word of BANNED) {
    const m = new RegExp(`(?<![\\w$])${word}(?![\\w$])`).exec(text);
    if (m) problems.push(`${name}: line ${lineOf(m.index)} uses "${word}"; that name is not allowed in a rule module`);
  }
  return problems;
}
