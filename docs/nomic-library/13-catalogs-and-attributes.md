# 13. Catalogs and attributes: how data-driven games define things

Researched 2026-11-20, for the catalog spec (`docs/catalog.md`). Unlike pages 1-12 this page is mostly about video games, because Nomics rarely had an object system; the Nomic sources are on [page 8](08-game-state-and-economies.md) and [page 11](11-code-is-law.md). Some wiki pages refused the fetch (the Dwarf Fortress wiki rate-limited, the Magic wikis blocked); those points are taken from search summaries and say so.

## Summary
- Every game that lets outsiders add things keeps two layers apart: **data** (a thing's name and values) and **code that gives a value meaning**. A value no code reads does nothing.
- They build things by **composition** (a bag of parts or flags), not by deep class trees. Inheritance exists everywhere but is a convenience for big catalogs, and it is where the bugs live.
- They split on unknown data: older games log it and load anyway, newer ones validate strictly at load time and refuse it. Minecraft moved from lenient to strict in Java 1.20.5 (2024), and kept a separate bag for data the game doesn't know.

## Sources
- **Entity-component-system** ([Wikipedia](https://en.wikipedia.org/wiki/Entity_component_system)): an entity "usually, it only consists of a unique ID"; a component "holds the data needed to model that aspect"; "A system is a process that acts on all entities with the desired components." "ECS prioritizes composition over inheritance."
- **Caves of Qud** ([Modding:Objects](https://wiki.cavesofqud.com/wiki/Modding:Objects)): objects are XML blueprints made of parts ("Components are generally referred to as 'parts'") plus tags; a blueprint can `Inherits` from another; undoing inherited data needs extra syntax: a tag is removed "by redefining it with `Value="*delete"`", and "The effects of most objects tags can be reverted using a `remove*` tag."
- **RimWorld** ([ThingComp](https://rimworldwiki.com/wiki/Modding_Tutorials/ThingComp), [XML file structure](https://rimworldwiki.com/wiki/Modding_Tutorials/XML_file_structure)): a Def is data; behaviour is added as a list of comps, which "Does not come with the compatibility issues and pitfalls of creating a custom Def class." Defs inherit with `ParentName` from `Abstract="True"` templates. The pitfall: a comp in both an abstract parent and a child is counted twice, so the advice is to "inherit from a newly defined Parent without the Comp". A broken parent can crash the game (search summary).
- **Cataclysm: Dark Days Ahead** ([JSON_FLAGS](https://github.com/CleverRaven/Cataclysm-DDA/blob/master/doc/JSON/JSON_FLAGS.md), [JSON_INFO](https://docs.cataclysmdda.org/JSON/JSON_INFO.html)): things carry string flags. "Some flags (items, effects, vehicle parts, construction pre_flags) have to be defined in `flags.json`"; forum reports (via search) show a flag used but never defined is reported as an invalid flag. Flags combine with code and with each other: the doc's comestibles section warns that one flag "doesn't make items poisonous on its own". Templates are `copy-from` plus `abstract` objects; "the new value will override the old."
- **Dwarf Fortress raws** (via search; the wiki rate-limited): creatures are lists of tokens like `[FLIER]`; creature variations add or remove tokens in bulk (`CV_ADD_TAG`, `CV_REMOVE_TAG`); the game writes problems to `errorlog.txt` and keeps loading. An unrecognised token is a log line, not a crash, so typos go unnoticed until someone reads the log.
- **Minecraft data components** ([Data component format](https://minecraft.wiki/w/Data_component_format), [Java 1.20.5 notes](https://www.minecraft.net/article/minecraft-java-edition-1-20-5)): "Every item type (item ID) has a set of default data components." "Any components that are not specified are implicitly set to the component's default value for that item type." A component is removed with a `!` prefix. In 1.20.5, free-form NBT was "replaced with structured 'components'", parsed and validated when loaded; "any non-game data in the item tag" of upgraded items is moved into one `minecraft:custom_data` component instead of being thrown away (quoted via search).
- **Minecraft tags** (via search: [NeoForge docs](https://docs.neoforged.net/docs/1.21.5/resources/server/tags), [schema](https://www.schemastore.org/minecraft-tag.json)): a tag is a named group (`minecraft:planks`), and game logic checks the tag, not each item. An entry can be marked `"required": false` and is skipped if its target doesn't exist; a required entry that is missing stops the whole tag loading.
- **Magic: The Gathering** (Comprehensive Rules 207.2 and the glossary, via search; [rules](https://magic.wizards.com/en/rules)): keywords like Flying are defined once in the rules (702) and printed as one word on each card. Reminder text is "italicized text within parentheses that summarizes a rule that applies to that card"; the glossary says it "is not actually rules text and has no effect on play." Flavor text is italic, not in parentheses, and "has no effect on play."
- **Nomics**: BlogNomic's gamestate is "Any information which the Ruleset regulates the alteration of" (page 8), so a value no rule regulates isn't gamestate. Agora: "An asset defined by rule or regulation is public" (Rule 2166, page 8). Patch Notes logs every idea "to decide what the rules language should learn next" and treats its validated language as "the main safety boundary" (page 11). The draft rulebook in the play mockup (v32; its `RULES_MD`, in Chalant's artifact `2026-11-18-promptocracy-play.html`) already had it: "A property does nothing unless a rule refers to it" (702) and "A catalog entry appears on the board only when a rule puts it there" (705).

## Patterns that worked
- Data and meaning in different places: an entry lists values; a rule (keyword, comp, system) says what a value does. Magic, ECS, RimWorld and the v32 draft all do this.
- Logic that asks about a property, not a name: Minecraft tags, ECS systems, Magic's "creatures with flying". A new thing that has the property just works.
- One registry of known keys (Cataclysm's `flags.json`, Minecraft's component types), so a typo or a made-up key is caught.
- Defaults declared with the key, so a missing value has a known meaning (Minecraft).
- A separate bag for data the game doesn't understand (Minecraft's `custom_data`), so it's kept but can't be mistaken for game data.
- Card text that points at the rule instead of restating it (Magic's keywords).

## Problems to avoid
- Deep inheritance. Qud, RimWorld, Cataclysm and Minecraft all needed extra syntax to undo inherited data, and RimWorld's double-counted comps and crashing parents are inheritance bugs. These are catalogs of thousands of things; ours will have tens.
- Unknown keys that silently load (Dwarf Fortress): typos look like features.
- Unknown keys that stop everything loading (a required Minecraft tag entry): one bad entry breaks the rest.
- Reminder text that drifts from the rule. Magic reprints it by hand; a card that renders the rule's own words can't drift.

## What it means for Promptocracy
- An attribute means something only if a rule defines it. That's the v32 draft's 702 and BlogNomic's gamestate, and it keeps "the rules are the game" true for the catalog. (Used in `docs/catalog.md`.)
- Rules should test attributes, not entry names ("anything that flies"), so a new creature built from existing attributes needs no code.
- Lenient where players write, strict where code reads: keep a player's unknown attribute as flavor in its own bag (Minecraft), never refuse the whole entry for it, and never let a rule read it.
- Skip inheritance at our size. "Like the Wyrm but flies" can be a copy made once at drafting, so every entry stays flat and readable.
- Gremlin's list of flavor attributes players keep asking for is Patch Notes' idea log: it shows which attribute should get a rule next. (Library note.)
