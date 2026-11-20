// Types for "promptocracy/engine". Rule modules are erasable TypeScript: these types are for the editor and for
// review; nothing here exists at run time except what api.js exports.
export type Tile = { x: number; y: number; z: number };
export type Settings = Record<string, any>;
export type Player = { ref: string; color: string; score: number; x: number; y: number; z: number; living: boolean };
export type Tiles = { has(x: number, y: number, z?: number): boolean; get(x: number, y: number, z?: number): Tile | undefined; list(): Tile[]; size: number };
export type Mark = "majority" | "unanimous";
export type Ctx = {
  /** The day number, or null while the game runs on turns. */
  day: number | null;
  now: string;
  settings: Settings;
  players: readonly Player[];
  tiles: Tiles;
  /** Marks by rule number. Empty until proposals arrive. */
  rulebook: { marks: Readonly<Record<number, Mark>> };
  /** Float in [0, 1). */
  rng: () => number;
  /** The turn model of the games that still run on turns. Goes when days arrive. */
  turn: { round: number; turn: number; moved: boolean };
  judge?: (question: string) => unknown;
};
export type Actor = { ref: string };
export type Action =
  | { kind: "move"; to?: Tile }
  | { kind: "propose" }
  | { kind: "vote" }
  | { kind: "end_turn" };
/** A refusal. status is 400 (default), 403, 409 or 500. */
export type Refusal = { error: string; status?: 400 | 403 | 409 | 500 };
export type Effect =
  | { type: "chart"; tiles: Tile[] }
  | { type: "points"; player: string; delta: number; reason: string }
  | { type: "log"; template: string; args: Record<string, unknown> }
  | { type: "win"; player: string; reason: string };

export type Hooks = {
  /** Called before a turn action, after the engine's own gates. Rule order; the first refusal wins. An action
   *  with no `to` is a question ("may this player move at all?"): answer null unless the player can never move. */
  actionAllowed?(ctx: Ctx, actor: Actor, action: Action): Refusal | null;
  /** In the same batch as the action. Effects of all modules are joined in rule order. */
  afterAction?(ctx: Ctx, actor: Actor, action: Action): Effect[];
  /** At join. Exactly one module. A tile from `candidates` (the charted ground tiles), or null for no room. */
  spawnTile?(ctx: Ctx, candidates: readonly Tile[]): Tile | null;
  // Defined now so their types are settled; the engine calls them in later changes.
  voteMark?(ctx: Ctx, proposal: unknown): Mark;
  electorate?(ctx: Ctx): string[];
  tally?(ctx: Ctx, proposal: unknown, votes: unknown, electorate: string[]): unknown;
  applyOrder?(ctx: Ctx, passed: unknown[]): unknown[];
  onEnacted?(ctx: Ctx, proposal: unknown): Effect[];
  dayEnd?(ctx: Ctx, results: unknown): Effect[];
};
export type RuleModule = { rule: number } & Hooks;

export function defineRule<T extends RuleModule>(mod: T): Readonly<T>;
export function refuse(error: string, status?: 400 | 403 | 409 | 500): Refusal;
export const effects: {
  chart(tiles: Array<{ x: number; y: number; z?: number }>): Effect;
  points(player: string, delta: number, reason: string): Effect;
  log(template: string, args?: Record<string, unknown>): Effect;
  win(player: string, reason: string): Effect;
};
export const HOOKS: Readonly<Record<string, { mode: "veto" | "sequence" | "decide"; wired: boolean }>>;
export const ACTION_KINDS: readonly string[];
export function chartOffsets(radius: number): number[][];
export function chartedAround(x: number, y: number, radius: number): number[][];
export function withinSteps(x: number, y: number, tx: number, ty: number, distance: number, diagonal?: boolean): boolean;
export function tileLabel(x: number, y: number, z?: number): string;
export function validCoord(x: number, y: number, z?: number): boolean;
export const DIAGONAL_MOVES: boolean;
export const SHARED_TILES: boolean;
export const ENGINE_VERSION: number;
