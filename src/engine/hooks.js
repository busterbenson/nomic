// The rule-module ENGINE: what a game's rule modules may implement, and how their answers are combined.
// Plain JavaScript with no Worker or D1 imports, so the Worker (esbuild), the bundler script and the tests
// (plain node) share ONE implementation.
//
// A game's rules are code as well as text. Each rule that does something has a module, rules/<n>.ts in the
// game's repo, that exports a plain object { rule: <n>, <hook>(...) {...}, ... }. Hooks take plain data in and
// give plain data out: they never see the database, the environment or the request. The engine runs them and
// applies what they say (a refusal, or a list of effects) in the same D1 batch as the action itself.
// The engine's own gates are not rules and a module cannot override them: logged in, game playing, whose turn it is.
//
// ENGINE CHANGES ARE ADDITIVE ONLY: a new hook or a new optional ctx field reaches every game in a separate
// platform change. Nothing here may change what an existing module sees.
import { validCoord } from "../lib/geometry.js";

// mode:  firstRefusal  every module runs in rule order; the first refusal wins
//        concat        every module runs in rule order; the effect lists are joined
//        one           exactly ONE module implements it (zero or two is an error when the rules are assembled)
// wired: the engine calls it today. A hook that is not wired is accepted in a module (so its type is settled
//        and a later change fills it in), is never called, and its "exactly one" rule is not enforced yet.
export const HOOKS = Object.freeze({
  actionAllowed: { mode: "firstRefusal", wired: true },
  afterAction: { mode: "concat", wired: true },
  spawnTile: { mode: "one", wired: true },
  voteMark: { mode: "one", wired: false },
  electorate: { mode: "one", wired: false },
  tally: { mode: "one", wired: false },
  applyOrder: { mode: "one", wired: false },
  onEnacted: { mode: "concat", wired: false },
  dayEnd: { mode: "concat", wired: false },
});

export const ACTION_KINDS = Object.freeze(["move", "propose", "vote", "end_turn"]);
// The statuses a refusal may carry (what the routes answer with). 400 is the default.
export const REFUSAL_STATUSES = Object.freeze([400, 403, 409, 500]);
export const MAX_CHART_TILES = 500;

// A module that threw. The routes answer 500 and log which rule and hook it was.
export class RuleError extends Error {
  constructor(rule, hook, cause) {
    super(`rule ${rule} (${hook}) failed: ${cause?.message ?? cause}`);
    this.name = "RuleError";
    this.rule = rule;
    this.hook = hook;
    this.cause = cause;
  }
}
// A rule set that cannot be assembled (a bad module, or an "exactly one" hook with zero or two implementations).
export class RuleSetError extends Error {
  constructor(problems) {
    super(problems.join("; "));
    this.name = "RuleSetError";
    this.problems = problems;
  }
}

// ---- small helpers modules and the engine share ----------------------------------
export function deepFreeze(v) {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

const tileKey = (x, y, z) => `${x},${y},${z}`;
// A read-only view of the charted tiles: has(x, y, z), get(x, y, z), list().
export function makeTiles(rows) {
  const map = new Map();
  for (const t of rows) map.set(tileKey(t.x, t.y, t.z ?? 0), Object.freeze({ x: t.x, y: t.y, z: t.z ?? 0 }));
  return Object.freeze({
    has: (x, y, z = 0) => map.has(tileKey(x, y, z)),
    get: (x, y, z = 0) => map.get(tileKey(x, y, z)),
    list: () => [...map.values()],
    size: map.size,
  });
}

// A small seeded generator (mulberry32 over an xmur3 hash of the seed text): the same seed gives the same
// numbers. rng() is a float in [0, 1). The host chooses the seed; a join uses cryptoRng, not a seed.
export function seededRng(seed) {
  let h = 1779033703 ^ String(seed).length;
  for (const c of String(seed)) { h = Math.imul(h ^ c.charCodeAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = (h = Math.imul(h ^ (h >>> 16), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) ^ (h >>> 16);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function cryptoRng() {
  const buf = new Uint32Array(1);
  return () => (crypto.getRandomValues(buf)[0]) / 4294967296;
}

// ctx: everything a hook may read, as deep-frozen plain data (the tiles view and rng are functions).
//   day        the day number, or null while the game still runs on turns (days arrive with their own change)
//   now        ISO time of the request
//   settings   the game's settings (src/lib/settings.js getSettings)
//   players    [{ref, color, score, x, y, z, living}]  (ref is the engine's stable reference to a player)
//   tiles      has(x,y,z) / get(x,y,z) / list()
//   rulebook   { marks }  the mark of each rule by number; empty until proposals arrive
//   rng        () => float in [0,1)
//   turn       { round, turn, moved }  the turn model of the games that still run on turns; goes when days arrive
//   judge      optional, for rules that need a ruling (none yet)
export function makeContext(o) {
  const ctx = {
    day: o.day ?? null,
    now: o.now,
    settings: o.settings,
    players: (o.players ?? []).map((p) => ({ ref: p.ref, color: p.color, score: p.score ?? 0, x: p.x, y: p.y, z: p.z ?? 0, living: p.living ?? true })),
    rulebook: { marks: o.rulebook?.marks ?? {} },
    turn: { round: o.turn?.round ?? 0, turn: o.turn?.turn ?? 0, moved: !!o.turn?.moved },
  };
  deepFreeze(ctx);
  // Functions are added after the freeze of the data, then the whole object is sealed.
  const out = { ...ctx, tiles: o.tiles ?? makeTiles([]), rng: o.rng ?? cryptoRng() };
  if (o.judge) out.judge = o.judge;
  return Object.freeze(out);
}

// ---- effects ------------------------------------------------------------------
// A closed union. The engine validates every effect a module returns and applies it in the action's own batch.
//   chart  {type:"chart", tiles:[{x,y,z}]}            chart blank tiles (a no-op for charted ones)
//   points {type:"points", player, delta, reason}      (applied once points arrive)
//   log    {type:"log", template, args}                (applied once the day log arrives)
//   win    {type:"win", player, reason}                (applied once winning arrives)
const isInt = (n) => Number.isSafeInteger(n);
const isStr = (s, max = 400) => typeof s === "string" && s.length > 0 && s.length <= max;
export const EFFECT_TYPES = Object.freeze(["chart", "points", "log", "win"]);
export const APPLIED_EFFECTS = Object.freeze(["chart"]);

export function validateEffect(e) {
  if (!e || typeof e !== "object" || Array.isArray(e)) return "an effect must be an object";
  switch (e.type) {
    case "chart":
      if (!Array.isArray(e.tiles) || e.tiles.length > MAX_CHART_TILES) return `chart needs a tiles list of at most ${MAX_CHART_TILES}`;
      for (const t of e.tiles) if (!t || !validCoord(t.x, t.y, t.z ?? 0)) return "chart has a tile with bad coordinates";
      return null;
    case "points":
      return isStr(e.player, 100) && isInt(e.delta) && isStr(e.reason) ? null : "points needs player, whole delta and reason";
    case "log":
      return isStr(e.template, 100) && e.args && typeof e.args === "object" && !Array.isArray(e.args) ? null : "log needs template and args";
    case "win":
      return isStr(e.player, 100) && isStr(e.reason) ? null : "win needs player and reason";
    default:
      return `unknown effect type ${JSON.stringify(e.type)}`;
  }
}
export function validateEffects(list) {
  if (!Array.isArray(list)) return "a hook that returns effects must return a list";
  for (const e of list) { const p = validateEffect(e); if (p) return p; }
  return null;
}
// The effect constructors modules use (re-exported by api.js).
export const effects = Object.freeze({
  chart: (tiles) => ({ type: "chart", tiles: tiles.map((t) => ({ x: t.x, y: t.y, z: t.z ?? 0 })) }),
  points: (player, delta, reason) => ({ type: "points", player, delta, reason }),
  log: (template, args = {}) => ({ type: "log", template, args }),
  win: (player, reason) => ({ type: "win", player, reason }),
});
export const refuse = (error, status = 400) => ({ error, status });

// ---- modules -------------------------------------------------------------------
export function defineRule(mod) {
  const problems = moduleProblems(mod);
  if (problems.length) throw new RuleSetError(problems);
  return Object.freeze(mod);
}

function moduleProblems(mod) {
  if (!mod || typeof mod !== "object" || Array.isArray(mod)) return ["a rule module must export an object"];
  const out = [];
  const label = Number.isInteger(mod.rule) ? `rule ${mod.rule}` : "a module";
  if (!Number.isInteger(mod.rule) || mod.rule < 100 || mod.rule > 9999) out.push(`${label}: rule must be a whole number from 100 to 9999`);
  for (const k of Object.keys(mod)) {
    if (k === "rule") continue;
    if (!Object.hasOwn(HOOKS, k)) out.push(`${label}: unknown hook ${k}`);
    else if (typeof mod[k] !== "function") out.push(`${label}: ${k} must be a function`);
  }
  return out;
}

// Assembles the hooks of a game's modules. Throws RuleSetError for a bad module, a rule number used twice, or a
// wired "exactly one" hook with zero or two implementations. Returns the callable engine for the game.
export function assembleRules(modules, { label = "rules" } = {}) {
  const problems = [];
  const list = Array.isArray(modules) ? modules : [];
  for (const m of list) problems.push(...moduleProblems(m));
  const nums = list.filter((m) => m && Number.isInteger(m.rule)).map((m) => m.rule);
  for (const n of new Set(nums.filter((n, i) => nums.indexOf(n) !== i))) problems.push(`rule ${n} has two modules`);
  const sorted = [...list].filter((m) => m && Number.isInteger(m.rule)).sort((a, b) => a.rule - b.rule);
  const implementers = (hook) => sorted.filter((m) => typeof m[hook] === "function");
  for (const [hook, spec] of Object.entries(HOOKS)) {
    if (spec.mode === "one" && spec.wired) {
      const n = implementers(hook).length;
      if (n !== 1) problems.push(`${hook} needs exactly one rule to implement it, found ${n}${n ? ` (${implementers(hook).map((m) => m.rule).join(", ")})` : ""}`);
    }
  }
  if (problems.length) throw new RuleSetError(problems.map((p) => `${label}: ${p}`));

  const call = (m, hook, args) => {
    try { return m[hook](...args); } catch (e) { throw new RuleError(m.rule, hook, e); }
  };
  return Object.freeze({
    modules: Object.freeze(sorted.map((m) => m.rule)),
    implementers: (hook) => implementers(hook).map((m) => m.rule),
    // null, or {error, status}: the first refusal in rule order.
    actionAllowed(ctx, actor, action) {
      for (const m of implementers("actionAllowed")) {
        const r = call(m, "actionAllowed", [ctx, actor, action]);
        if (r === null || r === undefined) continue;
        if (typeof r?.error !== "string" || !r.error || (r.status !== undefined && !REFUSAL_STATUSES.includes(r.status))) {
          throw new RuleError(m.rule, "actionAllowed", new Error("must return null or {error, status?}"));
        }
        return { error: r.error, status: r.status ?? 400, rule: m.rule };
      }
      return null;
    },
    // every module's effects, joined in rule order, each list validated.
    afterAction(ctx, actor, action) {
      const out = [];
      for (const m of implementers("afterAction")) {
        const r = call(m, "afterAction", [ctx, actor, action]) ?? [];
        const bad = validateEffects(r);
        if (bad) throw new RuleError(m.rule, "afterAction", new Error(bad));
        out.push(...r);
      }
      return out;
    },
    // the one spawn rule: a tile from `candidates`, or null when there is room nowhere.
    spawnTile(ctx, candidates) {
      const m = implementers("spawnTile")[0];
      const r = call(m, "spawnTile", [ctx, candidates]);
      if (r === null || r === undefined) return null;
      const hit = candidates.find((t) => t.x === r.x && t.y === r.y && (t.z ?? 0) === (r.z ?? 0));
      if (!hit) throw new RuleError(m.rule, "spawnTile", new Error("must return one of the candidate tiles or null"));
      return { x: hit.x, y: hit.y, z: hit.z ?? 0 };
    },
  });
}
