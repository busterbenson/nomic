// The game's catalog (rules 701-705), read from the game's bundled rules at the deployed day tag, the same way /api/rules reads the text:
//   GET /<slug>/api/catalog         {kinds, required, registry, entries}: every entry as a view (src/lib/catalog.js entryView), the
//                                   attributes rules define (registry) and what each kind needs (required). PUBLIC, like the rulebook.
//   GET /<slug>/api/catalog/<id>    {entry}: one entry's view (I1, C4, ...)
// A game with no bundle runs on the starter pack, whose catalog is empty.
import { bundleFor } from "../engine/host";
import { knownNumbers } from "../engine/claims.js";
import { ENTRY_ID, KINDS, entryView } from "../lib/catalog.js";
import { Ctx, json } from "../lib/util";

type Catalog = { registry: Record<string, any>; required: Record<string, any[]>; entries: any[]; rules: Set<string> };
const made = new WeakMap<object, Catalog>();

/** The catalog a game runs on: its registry, required lists and entries, and the rule numbers its text has. @rule 701.1 */
export function catalogFor(game: { slug: string }): Catalog {
  const { bundle } = bundleFor(game);
  let c = made.get(bundle);
  if (!c) {
    const b = bundle as any;
    c = { registry: b.registry ?? {}, required: b.required ?? {}, entries: b.catalog ?? [], rules: knownNumbers(bundle.rulesMd) };
    made.set(bundle, c);
  }
  return c;
}

/** What entryView needs from a game's catalog. @rule 701.1 */
export const viewContext = (c: Catalog) => ({ registry: c.registry, required: c.required, rules: c.rules });

// GET /api/catalog
/** @rule 701.1 */
export const get = async ({ data }: Ctx) => {
  const c = catalogFor(data.game!);
  const ctx = viewContext(c);
  return json({ kinds: KINDS, required: c.required, registry: c.registry, entries: c.entries.map((e) => entryView(e, ctx)) });
};

// GET /api/catalog/<id>
/** @rule 701.1 */
export const one = async ({ data, params }: Ctx) => {
  const c = catalogFor(data.game!);
  const id = String(params.id ?? "").toUpperCase();
  const e = ENTRY_ID.test(id) ? c.entries.find((x) => x.id === id) : null;
  return e ? json({ entry: entryView(e, viewContext(c)) }) : json({ error: "There is no such entry." }, 404);
};
