// The rule-module ENGINE: what a game's rule modules may implement, and how their answers are combined.
// Plain JavaScript with no Worker or D1 imports, so the Worker (esbuild), the bundler script and the tests
// (plain node) share ONE implementation.
//
// A game's rules are code as well as text. Each rule that does something has a module, rules/<n>.ts in the
// game's repo, that exports a plain object { rule: <n>, <hook>(...) {...}, ... }. Hooks take plain data in and
// give plain data out: they never see the database, the environment or the request. The engine runs them and
// applies what they say (a refusal, or a list of effects) in the same D1 batch as the action itself.
// The engine's own gates are not rules and a module cannot override them: logged in, game playing, the day open and not
// locked (rule 107.1), the player's turn not ended (rule 202.4). They are in src/lib/day.ts (dayGate).
//
// ENGINE CHANGES ARE ADDITIVE ONLY: a new hook or a new optional ctx field reaches every game in a separate
// platform change. Nothing here may change what an existing module sees.
// (The one exception, rule 402: the `win` effect became `champion` when Eras replaced the game-over win. Only the starter
// pack and Rickshaw Game 1, then in setup, used it; the later only-one-alive win brings its own effect back.)
import { validCoord } from "../lib/geometry.js";

// HOW SEVERAL RULES SHARE A HOOK. A rule never edits another rule's code. Each rule module registers its own handler
// for each hook it cares about, and the engine calls every handler. Each hook has exactly one combine mode:
//   veto      a can-I hook: every handler runs in rule-number order and any of them may refuse, with a reason that names
//             its rule. The first refusal wins; no refusal means yes.
//   sequence  an effect hook: every handler runs in rule-number order and their effects are joined in that order.
//   decide    a single-value hook: ONE handler decides. The plan has the engine require exactly one (zero or two is an
//             error when the rules are assembled, so a proposal that removes or doubles it fails its tests). A
//             precedence rule between competing handlers (the lowest rule number wins for now) is NOT built: it waits for
//             Buster's approval, and until then two handlers fail the assembly rather than silently picking one.
// wired: the engine calls it today. A module that implements a hook that is not wired is refused (it would bundle
//        and never run); the name is reserved so a later change can wire it. Its "exactly one" rule waits too.
export const HOOKS = Object.freeze({
  actionAllowed: { mode: "veto", wired: true },
  afterAction: { mode: "sequence", wired: true },
  spawnTile: { mode: "decide", wired: true },
  voteMark: { mode: "decide", wired: false },
  electorate: { mode: "decide", wired: false },
  tally: { mode: "decide", wired: false },
  applyOrder: { mode: "decide", wired: true },
  onEnacted: { mode: "sequence", wired: true },
  dayEnd: { mode: "sequence", wired: true },
  // The Champion's change (rule 402.4). A veto hook with one difference: a game whose rules have NO module for it has no such
  // change at all (the site refuses the draft), so repealing the rule that carries it removes the capability, wherever that
  // rule is numbered. A module answers null (allowed) or refuses with a reason.
  championChange: { mode: "veto", wired: true },
});

export const ACTION_KINDS = Object.freeze(["move", "propose", "vote", "end_turn"]);
// The statuses a refusal may carry (what the routes answer with). 400 is the default.
export const REFUSAL_STATUSES = Object.freeze([400, 403, 409, 500]);
export const MAX_CHART_TILES = 500;

// A module that threw. The routes answer 500 and log which rule and hook it was.
export class RuleError extends Error {
  /** @rule 101 */
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
  /** @rule 101 */
  constructor(problems) {
    super(problems.join("; "));
    this.name = "RuleSetError";
    this.problems = problems;
  }
}

// ---- small helpers modules and the engine share ----------------------------------
/** @rule 101 */
export function deepFreeze(v) {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

/** @rule 501 */
const tileKey = (x, y, z) => `${x},${y},${z}`;
// A read-only view of the charted tiles: has(x, y, z), get(x, y, z), list().
/** @rule 501 */
export function makeTiles(rows) {
  const map = new Map();
  for (const t of rows) map.set(tileKey(t.x, t.y, t.z ?? 0), Object.freeze({ x: t.x, y: t.y, z: t.z ?? 0 }));
  return Object.freeze({
    /** @rule 501 */
    has: (x, y, z = 0) => map.has(tileKey(x, y, z)),
    /** @rule 501 */
    get: (x, y, z = 0) => map.get(tileKey(x, y, z)),
    /** @rule 501 */
    list: () => [...map.values()],
    size: map.size,
  });
}

// A small seeded generator (mulberry32 over an xmur3 hash of the seed text): the same seed gives the same
// numbers. rng() is a float in [0, 1). The host chooses the seed; a join uses cryptoRng, not a seed.
/** @rule 101 */
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
/** @rule 101 */
export function cryptoRng() {
  const buf = new Uint32Array(1);
  return () => (crypto.getRandomValues(buf)[0]) / 4294967296;
}

// ctx: everything a hook may read, as deep-frozen plain data (the tiles view and rng are functions).
//   day        the day number (rule 203.1), or null before the game's first day
//   now        ISO time of the request
//   settings   the game's settings (src/lib/settings.js getSettings)
//   players    [{ref, color, score, x, y, z, living}]  (ref is the engine's stable reference to a player)
//   tiles      has(x,y,z) / get(x,y,z) / list()
//   rulebook   { marks }  the mark of each rule by number; empty until proposals arrive
//   rng        () => float in [0,1)
//   turn       { round, turn, moved }  moved: the acting player has moved in today's turn (rule 202.1, one turn a day).
//              round and turn are the legacy turn-model numbers, kept because the engine is additive only
//   judge      optional, for rules that need a ruling (none yet)
/** @rule 101 */
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
//   champion {type:"champion", player, reason}         (dayEnd only: this player wins the Era, rule 402)
/** @rule 101 */
const isInt = (n) => Number.isSafeInteger(n);
/** @rule 101 */
const isStr = (s, max = 400) => typeof s === "string" && s.length > 0 && s.length <= max;
export const EFFECT_TYPES = Object.freeze(["chart", "points", "log", "champion"]);
export const APPLIED_EFFECTS = Object.freeze(["chart"]);
// What the night's hooks may return, and the engine applies at the unlock (src/lib/day.ts): points when a change takes
// effect (rule 401) and the Era won at the end of the night (rule 402).
export const NIGHT_EFFECTS = Object.freeze(["points", "champion"]);
// What each night hook's enactment applies (src/engine/host.ts): points from onEnacted, the Era's winner from dayEnd. Any other
// effect is refused, never dropped, so a rule can't pass its tests with an effect that would silently do nothing.
export const NIGHT_HOOK_EFFECTS = Object.freeze({ onEnacted: Object.freeze(["points"]), dayEnd: Object.freeze(["champion"]) });

/** @rule 101 */
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
    case "champion":
      return isStr(e.player, 100) && isStr(e.reason) ? null : "champion needs player and reason";
    default:
      return `unknown effect type ${JSON.stringify(e.type)}`;
  }
}
/** @rule 101 */
export function validateEffects(list) {
  if (!Array.isArray(list)) return "a hook that returns effects must return a list";
  for (const e of list) { const p = validateEffect(e); if (p) return p; }
  return null;
}
// The effect constructors modules use (re-exported by api.js).
export const effects = Object.freeze({
  /** @rule 504.2 */
  chart: (tiles) => ({ type: "chart", tiles: tiles.map((t) => ({ x: t.x, y: t.y, z: t.z ?? 0 })) }),
  /** @rule 401 */
  points: (player, delta, reason) => ({ type: "points", player, delta, reason }),
  /** @rule 101 */
  log: (template, args = {}) => ({ type: "log", template, args }),
  /** @rule 402 */
  champion: (player, reason) => ({ type: "champion", player, reason }),
});
/** @rule 101 */
export const refuse = (error, status = 400) => ({ error, status });

// ---- modules -------------------------------------------------------------------
/** @rule 101 */
export function defineRule(mod) {
  const problems = moduleProblems(mod);
  if (problems.length) throw new RuleSetError(problems);
  return Object.freeze(mod);
}

/** @rule 101 */
function moduleProblems(mod) {
  if (!mod || typeof mod !== "object" || Array.isArray(mod)) return ["a rule module must export an object"];
  const out = [];
  const label = Number.isInteger(mod.rule) ? `rule ${mod.rule}` : "a module";
  if (!Number.isInteger(mod.rule) || mod.rule < 100 || mod.rule > 9999) out.push(`${label}: rule must be a whole number from 100 to 9999`);
  for (const k of Object.keys(mod)) {
    if (k === "rule") continue;
    if (!Object.hasOwn(HOOKS, k)) out.push(`${label}: unknown hook ${k}`);
    else if (typeof mod[k] !== "function") out.push(`${label}: ${k} must be a function`);
    // A handler for a hook the engine doesn't call yet would bundle and silently never run, so a game could
    // believe its rule is in force when it isn't. Refuse it until the engine wires that hook.
    else if (!HOOKS[k].wired) out.push(`${label}: ${k} is not run by the engine yet, so this handler would never run`);
  }
  return out;
}

// Assembles the hooks of a game's modules. Throws RuleSetError for a bad module, a rule number used twice, or a
// wired "exactly one" hook with zero or two implementations. Returns the callable engine for the game.
/** @rule 101 */
export function assembleRules(modules, { label = "rules" } = {}) {
  const problems = [];
  const list = Array.isArray(modules) ? modules : [];
  for (const m of list) problems.push(...moduleProblems(m));
  const nums = list.filter((m) => m && Number.isInteger(m.rule)).map((m) => m.rule);
  for (const n of new Set(nums.filter((n, i) => nums.indexOf(n) !== i))) problems.push(`rule ${n} has two modules`);
  const sorted = [...list].filter((m) => m && Number.isInteger(m.rule)).sort((a, b) => a.rule - b.rule);
  /** @rule 101 */
  const implementers = (hook) => sorted.filter((m) => typeof m[hook] === "function");
  for (const [hook, spec] of Object.entries(HOOKS)) {
    if (spec.mode === "decide" && spec.wired) {
      const n = implementers(hook).length;
      if (n !== 1) problems.push(`${hook} needs exactly one rule to implement it, found ${n}${n ? ` (${implementers(hook).map((m) => m.rule).join(", ")})` : ""}`);
    }
  }
  if (problems.length) throw new RuleSetError(problems.map((p) => `${label}: ${p}`));

  /** @rule 101 */
  const call = (m, hook, args) => {
    try { return m[hook](...args); } catch (e) { throw new RuleError(m.rule, hook, e); }
  };
  /** @rule 401, 402 */
  const nightEffects = (hook, args) => {
    const out = [];
    for (const m of implementers(hook)) {
      const r = call(m, hook, args) ?? [];
      const takes = NIGHT_HOOK_EFFECTS[hook];
      const bad = validateEffects(r) ?? r.map((e) => (!NIGHT_EFFECTS.includes(e.type) ? `the ${e.type} effect can't be used at night`
        : takes.includes(e.type) ? null : `the ${e.type} effect can't be returned by ${hook} (it takes: ${takes.join(", ")})`)).find(Boolean);
      if (bad) throw new RuleError(m.rule, hook, new Error(bad));
      out.push(...r.map((e) => ({ ...e, rule: m.rule })));
    }
    return out;
  };
  return Object.freeze({
    modules: Object.freeze(sorted.map((m) => m.rule)),
    /** @rule 101 */
    implementers: (hook) => implementers(hook).map((m) => m.rule),
    // null, or {error, status}: the first refusal in rule order.
    /** @rule 202.2, 504.3 */
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
    // null, or {error, status, rule}: whether the Champion may draft their change (rule 402.4). With no module for the hook the
    // game has no Champion's change, and the answer is a refusal; otherwise the first refusal in rule order wins, as above.
    /** @rule 402.4 */
    championChange(ctx, champion) {
      const mods = implementers("championChange");
      if (!mods.length) return { error: "The game's rules have no Champion's change.", status: 409, rule: 0 };
      for (const m of mods) {
        const r = call(m, "championChange", [ctx, champion]);
        if (r === null || r === undefined) continue;
        if (typeof r?.error !== "string" || !r.error || (r.status !== undefined && !REFUSAL_STATUSES.includes(r.status))) {
          throw new RuleError(m.rule, "championChange", new Error("must return null or {error, status?}"));
        }
        return { error: r.error, status: r.status ?? 400, rule: m.rule };
      }
      return null;
    },
    // every module's effects, joined in rule order, each list validated.
    /** @rule 504 */
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
    // The order passed proposals are applied in (rule 107.2), from the one rule that decides it. `passed` is a list of
    // plain proposals ({number, target, ...}); the answer must be the same proposals, each once, in a new order.
    /** @rule 107.2 */
    applyOrder(ctx, passed) {
      const m = implementers("applyOrder")[0];
      const list = deepFreeze(passed.map((p) => ({ ...p })));
      const r = call(m, "applyOrder", [ctx, list]);
      /** @rule 107.2 */
      const nums = (x) => x.map((p) => p?.number).sort((a, b) => a - b).join(",");
      if (!Array.isArray(r) || r.length !== passed.length || nums(r) !== nums(passed) || new Set(r.map((p) => p?.number)).size !== r.length) {
        throw new RuleError(m.rule, "applyOrder", new Error("must return the same proposals, each once"));
      }
      return r.map((p) => passed.find((q) => q.number === p.number));
    },
    // Effects when a passed proposal takes effect (rule 401), every rule's, joined in rule order. Only points.
    /** @rule 401 */
    onEnacted(ctx, proposal) {
      return nightEffects("onEnacted", [ctx, deepFreeze({ ...proposal })]);
    },
    // Effects at the end of the night, after every onEnacted (rule 402): `results` is {before: {ref: n}, given: [{player, delta}], enacted: [...]}.
    // Only champion: the player who wins the Era.
    /** @rule 402 */
    dayEnd(ctx, results) {
      return nightEffects("dayEnd", [ctx, deepFreeze(JSON.parse(JSON.stringify(results)))]);
    },
    // the one spawn rule: a tile from `candidates`, or null when there is room nowhere.
    /** @rule 505 */
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
