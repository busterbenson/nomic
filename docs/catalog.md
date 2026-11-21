# The catalog: kinds, attributes, and Gremlin's drafting context

Spec for Buster's markup (2026-11-20). Nothing here is built. It answers his questions of 2026-11-20 (16:20-16:34): classify every entry by kind, add structures with a size, make features like a forum catalog entries too, require some attributes per kind, know which attributes have rules, draw each entry's art while the ticket is drafted, and design all of it to be "simple, modular, flexible, and lenient", bare bones first.

Evidence: [Nomic library page 13](nomic-library/13-catalogs-and-attributes.md) (how Caves of Qud, RimWorld, Cataclysm, Dwarf Fortress, Minecraft, Magic and ECS do this), with [page 8](nomic-library/08-game-state-and-economies.md) and [page 11](nomic-library/11-code-is-law.md). The ticket and Gremlin are in [workshop.md](workshop.md).

**Every mechanic named here (hearts, moving, biting, flying, acquiring, placing a structure) is an example, not proposed.** None is a decided game mechanic. This spec names slots for them; rules that give them meaning come through play.

**Step names.** AGENTS.md calls the 600 block "step 2" and 700 "step 3". workshop.md numbers its own PRs 1-4. Here, "Workshop step 2" means Gremlin, and "the 600 block" means hearts and creatures.

## 1. The model

An **entry** is one thing in the catalog. It has:

| Field | What it holds |
|---|---|
| Id | kind letter + number, next free in its kind: I1, C4, T2, S1, F1 (the v32 draft's 701.3) |
| Name | "Very large hat" |
| Kind | one of the kinds (below) |
| Art | one drawing (a key in art storage) |
| Attributes | `{key: value}`, each key defined by a rule |
| Flavor | `{key: value}`, keys no rule defines; shown, never read by code |
| Made by | the ticket (W42) and the day it went live |

**Kinds** (Buster's list, plus structure):

| Kind | Letter | Example |
|---|---|---|
| item | I | a lantern |
| creature | C | Blob, Crow |
| tile | T | a bog tile |
| structure | S | a garden wall, 2×1 tiles |
| feature | F | a forum: not on the board, it lives in the site's software |

**Value types.** Six, each with one way to show it:

| Type | Example value | Shown as |
|---|---|---|
| number | 3 | 3 |
| yes/no | yes | Yes |
| choice | "hostile" from [hostile, neutral] | Hostile |
| text | "smells of tar" | the text |
| size | 2×1 | "2×1 tiles" + the footprint drawing (as in the ticket mockup) |
| rule | 709 | a rule pill |

The sixth, **rule**, is new: Buster's "an item should require a rule that describes how it is acquired" makes the value a rule number. The v32 creature card's "Where from (602 or 601.4)" row is the same shape. A rule value that names a rule not in the rulebook shows as missing.

Size is a rectangle, W×H, at most 4×4 to start (lean; a setting). L-shapes wait until a structure needs one.

**No inheritance.** Every big data-driven game has templates (Qud `Inherits`, RimWorld `ParentName`, Cataclysm `copy-from`), and every one then needed extra syntax to undo inherited data; RimWorld's double-counted comps are an inheritance bug (page 13). Those catalogs hold thousands of things; ours will hold tens. "A Dragon is like the Wyrm but flies" becomes a **copy made once, at drafting**: Gremlin copies the Wyrm's attributes onto the draft and changes one. The Dragon then stands alone; changing the Wyrm later doesn't change it. Every entry reads flat. Revisit if a game passes ~200 entries.

## 2. The attribute registry

An attribute exists when a rule defines it. The rule's module exports the definition, the same way rule modules already claim engine code with `@rule`:

```ts
// rules/602.ts (example, not proposed: what the 600 block could export)
export const attributes = [
  { key: "speed", type: "number", kinds: ["creature"], default: 1,
    meaning: "How many tiles it moves at night." },
  { key: "temper", type: "choice", choices: ["hostile", "neutral"], kinds: ["creature"], default: "hostile",
    meaning: "Hostile creatures bite; neutral ones never do." },
];
```

Fields: `key` (lowercase, a-z and `_`), `type`, `kinds` it applies to, optional `choices` (for choice), optional `default`, optional `missing` (the state words when it's absent, section 3), and `meaning` (one line). The defining rule's number comes from the file.

- **Where it lives:** in the game's repo, with the rule. Repealing the rule removes the attribute (109.1's "code follows the rule" already says so).
- **How the platform reads it:** at deploy, the bundler collects every module's `attributes` into one registry (key → definition + rule number) beside the bundled rule text. A Worker can't load code at runtime, so the registry is fixed per `day-N` tag, the same as the rules.
- **On the card:** each attribute row shows its value and its rule pill (`Speed 2 [602]`). Tapping the pill opens the rule, as everywhere. No reminder text: Magic prints reminder text beside a keyword and has to keep it in step by hand; our pill opens the rule's own words, which can't drift.
- **Flavor** shows below, under its own label, values only, no pills.
- **Claims checker** (`scripts/check-rule-claims.mjs`) gains three checks: (a) every registry key is defined by exactly one rule that exists; (b) code reads an attribute only through `attr(entry, "speed")` with a literal key, and that key is in the registry, so code can't read flavor or a typo; (c) every key in a kind's required list (section 3) is either defined or listed as "no rule yet". Cataclysm's `flags.json` is the model: one list of known keys, so a made-up key is caught at build, not in play.

**Rules act on attributes, never on entry names.** "Anything that flies ignores walls" (example), not "the Crow ignores walls". Minecraft's game logic checks tags, not item ids, for the same reason (page 13). Then a new creature made from existing attributes needs no code: art and values, price 0.

## 3. Required attributes, missing, unknown, flavor

Each kind has a **required list**, set by a rule (704). Buster's starting list:

| Kind | Required | Type |
|---|---|---|
| creature | hearts, moves | number, choice |
| item | acquired | rule |
| structure | size | size |
| tile | passable | yes/no |
| feature | shows in | choice: a tab, a button, the board |

Four cases, all **lenient on write, strict on use**:

| Case | Example | What happens |
|---|---|---|
| Defined | `speed: 2`, rule 602 defines it | shown with its pill; rules read it |
| Required, no rule yet | `hearts: 3`, and no rule defines hearts | value kept and shown with a "No rule yet" state; no code reads it |
| Missing | an item with no `acquired` | the entry still goes live; the card shows the defining rule's `missing` state, e.g. "Can't be acquired" |
| Unknown | `smell: "tar"` | kept as flavor: shown, never read |

Nothing is refused for a missing or unknown attribute. Dwarf Fortress logs unknown tokens and loads anyway (typos pass as features); Minecraft once refused a whole tag for one missing entry. We keep the entry, put unknown keys in their own bag (Minecraft's `custom_data` move), and let only registry keys reach code.

"Can't be acquired" is state, not helper text: it says what is true of this entry, the way "Not on the board yet" does. It comes from the attribute's `missing` field, so the rule that defines the attribute also defines what its absence means. With no defining rule, a missing required attribute shows as an empty row ("Hearts —").

A rule that gets a value of the wrong type (a hand edit, an old entry) treats it as missing. The night's tests check every live entry against the registry, so a mismatch fails the build that caused it.

## 4. How the catalog grows

| Change | Build? | Price lean | Path |
|---|---|---|---|
| New entry from existing attributes (+ flavor) | no | 0 | commission; goes live the night it passes |
| Change an entry's values or art | no | 0 | commission (see Q8) |
| New attribute | yes: rule text + module + tests | by nights | commission that makes the rule (801) |
| A kind's required list | yes: 704's text and list | by nights | ordinary proposal on 704 |
| New kind | yes: 702's list, a letter, a card layout | by nights | commission |

- **Rename an attribute:** the rule that defines it changes, and the same change rewrites every entry that uses the old key (one commit, 107.4). Both keys never coexist.
- **Retire an attribute:** repeal (or reword) the rule. Existing values move to flavor, so nothing a player made is lost; code stops reading them.
- **Two rules define the same key:** refused when drafted, with the reason naming the rule that already defines it, like any conflict (108). The claims checker also fails the build, as a backstop.
- **Flavor as demand:** Gremlin keeps a count of flavor keys across the catalog. A flavor key on several entries ("flies" on 4) is the next attribute worth a rule. The Workshop can show it as data ("flies: 4 entries"). Patch Notes logs ideas for the same reason (page 11).

## 5. Bare bones v1

Ships with Workshop step 2 (Gremlin), since Gremlin is what fills it in.

**Data**
- Kinds: all 5 (cheap: a list and a letter each).
- Value types: all 6.
- Registry: **empty**. No rule in v1 defines what any attribute does. Every required attribute shows "No rule yet".
- Required lists: Buster's table in section 3, as data in 704's module.
- Entries live in the game's repo as `catalog.json` (one file; tens of entries), written by the night's commit with the rest of the ticket's changes. The moderator's allowed paths (AGENTS.md) add `catalog.json`.
- A draft entry lives on its ticket. `makes` items grow from `{kind: "entry", name}` to:

```json
{ "kind": "entry", "name": "Garden wall", "catalogKind": "structure",
  "attrs": { "size": "2x1" }, "flavor": { "material": "stone" },
  "needsBuild": [], "art": { "key": "drafts/W42/garden-wall-2.png", "prompt": "a low stone garden wall, 2 tiles long" } }
```

  (`kind` stays the makes-item's type, as #38 stores it; `catalogKind` is the entry's kind, to avoid two meanings of one field.) This changes #38's `readMakes` in the catalog v1 PR: it keeps the new fields, checks them against the registry (section 6, guards), treats two entries as duplicates only when name **and** kind match, and accepts a rule item with no `num` yet (a `draft` sentence instead), since Chalant numbers the rule at build time.
- Art in object storage (Cloudflare R2 lean), drafts under `drafts/W<n>/`, copied to `entries/<id>.png` when the entry goes live. Lean: a bucket lifecycle rule deletes drawings that were replaced, and the drafts of Shelved tickets, after 30 days. Refused and Failed tickets keep theirs, since they can be reopened (801.5 on #38).

**UI**
- The ticket's Makes cards, as in Chalant's static mockup (`artifacts/promptocracy-workshop/ticket-art-mock/`, not in this repo): art with Redraw, name, kind chip, size + footprint for structures, then attribute rows. Dimmed until live (workshop.md).
- The catalog card: art, id + name, kind chip, attribute rows (value + pill, or "No rule yet"), missing-state line where one applies, flavor rows, made by (W pill + day).
- The Workshop's catalog groups: one per kind, in the order item, creature, tile, structure, feature.

**Left for players to propose** (each a commission that makes a rule)
- What hearts, moving, passable, acquiring and "shows in" do.
- Any new attribute (speed, bite, flies, temper, weight, ...).
- Placing anything on the board, including structures and their footprint (701.4 below, the v32 draft's 705: nothing appears until a rule puts it there).
- A feature that actually works (a forum needs the platform pieces first: storage, actions, views; workshop.md).
- Non-rectangle sizes, more kinds, inheritance if the catalog gets big.

**Fits what's planned.** When the 600 block ships (Blob, Ghost, Crow, per spec-checklist S2-CRE), its rules export their attributes (speed, bite, temper, flies) and C1-C3 become ordinary entries. Nothing in v1 has to change for that.

## 6. Gremlin's drafting context (for the Workshop step 2 brief)

**In his prompt** (the cacheable part first):

1. His persona and voice samples (below), and the limit excuses file.
2. The kinds, each with its letter and required list.
3. The registry: every key with its type, kinds, choices, default and rule number, plus its one-line meaning. Then the "No rule yet" keys.
4. The 20 (lean) entries most similar to the request (by kind and name/brief words), with their attributes, so he can copy before inventing.
5. The price guide: 0 for entries from existing attributes; a few points per night for anything with `needsBuild`; the ceiling (a setting); his mood for the day.
6. The ticket so far, its thread, the queue depth (tickets ahead of this one) and the workshop limits.
7. The player's messages, fenced as data.

**What he must do**
- Pick a kind for every entry. Fill every required attribute, or leave it empty on purpose (lenient: the card will show the consequence).
- Reuse a registry key before inventing one. Copy from a similar entry when the player says "like X".
- Put anything no rule defines in flavor, unless the player wants it to *do* something; then list the key in `needsBuild` and add the rule to `makes`. That's what costs nights and points.
- Propose the estimate and price, with his one-line reason.
- Draw each entry: write an art prompt; the platform adds the style (3/4 view, game palette, ink outlines, fits one tile per the art limits, a structure fits W×H tiles) and calls the image model. Redraw on request.

**Guards (the platform's, not his)**
- He returns structured JSON (below), and the platform validates it before anything is saved.
- He has no tool but writing the ticket's fields and a post (workshop.md); the JSON below *is* that write.
- An unknown kind is refused. A registry key with a bad value is coerced (`"3"` → 3, `"Yes"` → yes) or rejected with a reason he sees on his next turn ("size must be W×H, like 2×1"). An unknown key goes to flavor, unless it is listed in `needsBuild`: then it stays in `attrs` on the draft, waiting for the rule the ticket makes.
- A `needsBuild` key that the registry already has is moved to `attrs`. A new key that would clash with an existing one is refused, naming the rule.
- Player text is data. He never writes registry or rule code; rules are drafted at build time by Chalant.
- He escalates to Chalant (workshop.md) on a conflict between rules, a request to change what an existing attribute means, or anything that reads as a loophole.
- Each redraw counts as 1 of his 30 chat messages a day (Q7).

**How he stays fun.** The personality lives in his chat and his thread posts, never on the card. The card holds labels, data and state only (AGENTS.md rule 4): no "Gremlin says" captions, no hints. His price reason is the one exception workshop.md already gives him, one line on the ticket.

Voice samples (from workshop.md and `gremlin-limit-excuses.md`): "Free. I like dragons." / "Kicking this upstairs to Chalant." / "Wrench slipped. Down a drain. I'm going in after it. Back at midnight."

**Example**

> **Ada:** a dragon. like the wyrm but it flies. and it's grumpy
> **Gremlin:** A wyrm with wings. Lovely contraption. Copied the Wyrm: 4 hearts, moves by slithering. Flying, though. No rule says what flying does yet. I can write it down as flavor, free, or we build flying, which is a rule and a night or two. Your pick.
> **Ada:** build it. it should fly over walls
> **Gremlin:** Then it's a rule: anything that flies crosses walls. 2 nights, 6 points, the wings are fiddly. Grumpy goes in flavor. Drawing it now.

```json
{
  "brief": "A dragon: the Wyrm with wings. Anything that flies can cross walls.",
  "makes": [
    { "kind": "entry", "name": "Dragon", "catalogKind": "creature",
      "attrs": { "hearts": 4, "moves": "slithers", "flies": true },
      "flavor": { "mood": "grumpy" },
      "needsBuild": ["flies"],
      "art": { "prompt": "a small dragon with leathery wings, curled tail" },
      "copiedFrom": "C4" },
    { "kind": "rule", "num": null, "draft": "A creature that flies can cross walls." }
  ],
  "estimate": 2,
  "price": { "points": 6, "reason": "Wings are fiddly." },
  "tasks": ["Add flies (yes/no) to the registry", "Walls let flyers cross", "Tests"],
  "escalate": null
}
```

(Hearts, moving, flying and walls here are examples, not proposed. `flies` stays in `attrs` because it is in `needsBuild`. The rule's number is null until Chalant numbers it at build time.)

## 7. Rule text (DRAFT, Rickshaw block 700, rules voice)

Block 700 is free in Rickshaw's RULES.md. The v32 draft's 700 rules (Looks, Your piece, Art limits, Items, Recipes) move to 706 and up when their code ships, and its 705 Showing up becomes 701.4; renumbering is free before the game starts. **This changes the approved reorganization** (`docs/rules-reorg.md`, block 700 "unchanged numbers"), which kept the v32 numbers because the mockup cites 704 and 706; the mockup isn't built yet, so the cost is a few citations. The italic notes are not rule text: each names the PR the clause ships with, and is dropped when it enters RULES.md. "Catalog v1 PR" is the PR named in section 9.

**701 The catalog**
**701.1** Everything in the game that isn't a rule or a player is an entry in the catalog: its name, its kind (702), its drawing and its attributes (703). *(catalog v1 PR)*
**701.2** A new entry, or a change to one, comes in by commission (801). *(catalog v1 PR)*
**701.3** A new entry gets the next number of its kind: I1, C4, T2, S1, F1. *(catalog v1 PR)*
**701.4** An entry appears on the board only when a rule puts it there. *(catalog v1 PR; true because no rule places anything yet)*

**702 Kinds**
**702.1** Every entry is one kind: an item (I), a creature (C), a tile (T), a structure (S), or a feature (F). A feature is part of the site, not the board (701.4). *(catalog v1 PR)*

**703 Attributes**
**703.1** An attribute is a value an entry has. A rule defines each attribute: what it means and what values it can have. *(catalog v1 PR: the registry)*
**703.2** Rules use attributes, not the names of entries. *(catalog v1 PR: the claims check)*
**703.3** Only one rule can define an attribute. *(catalog v1 PR: the claims check)*

**704 What each kind needs**
**704.1** Each kind needs some attributes. A creature needs hearts and a way to move. An item needs the rule that gives it to you. A structure needs a size in tiles. A tile needs to say if you can cross it. A feature needs where it shows. *(catalog v1 PR; the list is Q6, and naming a slot here decides nothing about what hearts or moving do)*
**704.2** An attribute a kind needs can have no rule yet. Its value shows on the entry's card and does nothing until a rule defines it (703.1). *(catalog v1 PR)*
**704.3** An entry can go live without an attribute its kind needs. The rule that defines that attribute says what that means for the entry. *(catalog v1 PR: the `missing` field)*

**705 Flavor**
**705.1** An entry can have attributes no rule defines and its kind doesn't need (704.1). They are flavor: they show on its card and do nothing. *(catalog v1 PR)*
**705.2** When a rule defines an attribute that was flavor, it starts to count (703.1). *(catalog v1 PR: the night moves the values from flavor to attributes when a rule defines the key)*

**801 changes, in the same PR**
- 801.1: "(a creature, a tile, an item, or a feature like a forum)" becomes "(a new catalog entry of any kind, 702, or a rule that makes one do something)".
- 801.2 gains a last sentence: "Gremlin draws each new entry while you draft it." *(Gremlin's PR, Workshop step 2)*
- 801.1 and 801.2 on origin/main and #38 are unchanged until these land.
- 803.2 (workshop.md): "A ticket's rules and catalog entries (701) go live together."

## 8. Questions for Buster (lean first)

1. **The sixth value type, "rule".** Lean yes: "acquired" names the rule that gives you the item, as your item example asked. Evidence: v32's "Where from (602)" row is already a rule reference.
2. **No inheritance; copy at drafting instead.** Lean yes. Evidence: every templating system in page 13 grew undo syntax, and RimWorld's bugs come from it; our catalog is small.
3. **Missing required attribute: go live anyway, card shows the consequence.** Lean yes (your "lenient"). The other choice, refusing at drafting, blocks a player who wants a hat that can't be acquired yet, which is a fine thing to make.
4. **Flavor: allowed, shown, at most 6 per entry.** Lean yes. Evidence: Minecraft kept unknown data in its own bag rather than losing it; Magic's flavor text is a beloved part of the card that does nothing.
5. **Entries in the game repo (`catalog.json`), widening the moderator's allowed paths.** Lean yes: entries go live with the rules in the same commit and the same `day-N` tag, so the catalog can't drift from the code.
6. **The v1 required list** (creature: hearts, moves; item: acquired; structure: size; tile: passable; feature: shows in). Lean: take it as written, all "No rule yet". "Moves" as a choice (walks, slithers, stays) or a number? Lean choice, since how far is a rule's business; flying stays its own attribute. The other option: 704.1 says only "each kind needs some attributes" and the list lives in data until the 600 block ships.
7. **Redraws.** Lean: each redraw is 1 of Gremlin's daily messages, and the ticket keeps the last 3 drawings so the player can go back.
8. **Changing an existing entry** (values or art) is a commission at price 0, not an ordinary proposal. Lean yes, so every catalog change goes through the Workshop and gets a ticket.

## 9. Build plan

| When | What |
|---|---|
| Workshop step 1 (#38, in review) | tickets, `makes` as names; no change needed |
| **Workshop step 2 (Gremlin)** | **catalog v1 PR rides here**: kinds, value types, the empty registry and the required lists; `makes` entries with attrs/flavor/art; art storage (R2) + image model calls; Makes cards and the catalog card; the claims-checker additions; `readMakes` widened (section 5); 701-705 text in Rickshaw, in the same PR as their code |
| Workshop step 2b (Starling) | none |
| Platform pieces (storage, actions, views) | what a feature needs to *do* anything; until then a feature entry is a card |
| Workshop step 3 (the night) | Chalant writes `catalog.json` and copies art from drafts when a ticket goes live; first commissions that define attributes |
| The 600 block | Blob, Ghost, Crow as entries; their rules export speed, bite, temper, flies |

Catalog v1 is one PR inside Workshop step 2, before Gremlin's chat, so his output has a validated shape to land in.
