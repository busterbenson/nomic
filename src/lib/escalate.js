// Escalation to Chalant (rule 106.4), in plain JavaScript so the Worker and the plain-node tests share ONE implementation: the insert that
// takes the daily cap and the one-open-per-ticket rule in the same statement, and the notification's text, which is built from the category
// and the ticket's number and nothing a player wrote. src/lib/thread.ts and src/routes/api-chat.ts make escalations; the moderator's
// routes (src/routes/api-moderator.ts) hand them to the Mac mini's job.
import { ESCALATIONS_PER_DAY } from "./gremlin.js";

// One row, only if the player is under the day's cap, in the one statement. INSERT OR IGNORE: the unique index escalations_one_open drops a
// second open escalation on the same ticket (or the same chat) without an error. Binds: game, agent, player, ticket_id, chat_message_id,
// category, reason, local_date, at, then game, player, local_date, cap.
/** @rule 106.4 */
export const ESCALATE_SQL = `INSERT OR IGNORE INTO escalations (game_id, agent, player_id, ticket_id, chat_message_id, category, reason, local_date, created_at)
  SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM escalations WHERE game_id = ? AND player_id = ? AND local_date = ?) < ?`;

/**
 * Pass something to Chalant. Returns "stored", or why it was dropped: "cap" (the player has already escalated 5 times today) or "open" (an
 * escalation of theirs on this ticket, or in this chat, is still waiting). A dropped escalation is logged by the caller. @rule 106.4
 */
export async function escalate(db, { gameId, agent, playerId, ticketId = null, chatMessageId = null, category, reason, date, at, cap = ESCALATIONS_PER_DAY }) {
  const res = await db.prepare(ESCALATE_SQL).bind(gameId, agent, playerId, ticketId, chatMessageId, category, reason, date, at, gameId, playerId, date, cap).run();
  if (res?.meta?.changes > 0) return "stored";
  const n = await db.prepare("SELECT COUNT(*) AS n FROM escalations WHERE game_id = ? AND player_id = ? AND local_date = ?").bind(gameId, playerId, date).first();
  return (n?.n ?? 0) >= cap ? "cap" : "open";
}

/**
 * The one line a notification carries for a batch of new escalations: a category, a ticket number (or "chat") and a link. Never `reason`, never a
 * post, never a name: those are player-influenced, and the always-on session that delivers the notification has full access (docs/step2-plan.md,
 * "Player text never reaches the always-on session"). @rule 106.4
 */
export function notificationText(game, rows) {
  const line = (r) => `${r.ticket ? `W${r.ticket}` : "a chat"}: ${r.agent === "starling" ? "Starling" : "Gremlin"} escalated (${r.category})`;
  const link = `/${game.slug}/`;
  // the game's slug, not its name: a name is typed by a person, a slug is a fixed token; the link is relative, the job puts the site's address in front
  return `${game.slug}: ${rows.length === 1 ? line(rows[0]) : `${rows.length} escalations: ${rows.map(line).join("; ")}`}. ${link}`;
}
