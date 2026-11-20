// Invite links (rule 102.3). Each player has their own link: the game's join link plus ?from=<their invite code>, so the
// join page can say who invited you. The code is derived, not stored: a hash of the game's join code and the player's id,
// so nobody can name a player as their inviter without having that player's link, and no migration is needed.
import { isLocked, loadToday } from "./day";
import { Env, Ctx, seatLimit, seatsTaken, sha256Hex, siteUrl } from "./util";

/** @rule 102.3 */
export const inviteCodeOf = async (game: { join_code: string }, playerId: string) => (await sha256Hex(`${game.join_code}:${playerId}`)).slice(0, 12);

/** The player whose invite code this is, or null. @rule 102.3 */
export async function inviterOf(env: Env, game: { id: string; join_code: string }, code: unknown): Promise<{ display_name: string; color: string } | null> {
  if (typeof code !== "string" || !/^[0-9a-f]{12}$/.test(code)) return null;
  const rows = (await env.DB.prepare("SELECT id, display_name, color FROM players WHERE game_id = ?").bind(game.id).all()).results as any[];
  for (const p of rows) if ((await inviteCodeOf(game, p.id)) === code) return p;
  return null;
}

/** Whether this game can take another player: it is not over and has fewer players than its limit. @rule 102.3 */
export async function roomFor(env: Env, game: { id: string; status: string; settings: string }): Promise<boolean> {
  return game.status !== "over" && (await seatsTaken(env, game.id)).length < seatLimit(game);
}

/** A player's own invite link. @rule 102.3 */
export async function inviteUrl(ctx: Ctx, playerId: string): Promise<string> {
  const game = ctx.data.game!;
  return `${siteUrl(ctx.env, ctx.request)}/${game.slug}/join/${game.join_code}?from=${await inviteCodeOf(game, playerId)}`;
}

/** The day being processed when joining is locked, else null. A game in setup is never locked; a game in play is, like every
 *  write, from midnight until the night is processed (rule 107.1): the roster and the board do not change under the moderator.
 *  @rule 102.3, 107.1 */
export async function joinLock(env: Env, game: any, nowMs: number): Promise<number | null> {
  if (game.status !== "playing") return null;
  const { game: g, day } = await loadToday(env, game, nowMs);
  return day && isLocked(g, day, nowMs) ? day.n : null;
}
/** The same gate in SQL (the game row aliased g), for the guard of the insert that adds a player; one bind: now, as ISO. @rule 102.3, 107.1 */
export const joinOpenSql = `(g.status = 'setup' OR (g.phase = 'open' AND EXISTS (SELECT 1 FROM days d WHERE d.game_id = g.id AND d.n = g.day AND d.status = 'open' AND d.ends_at > ?)))`;
