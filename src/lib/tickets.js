// The Workshop's tickets, the pure parts (plain JavaScript, so the Worker and the plain-node tests share ONE
// implementation): what a ticket's fields may hold (rules 801.2, 801.3), who may post in its discussion (rule 804.1), and
// the SQL the count runs when a commission passes or fails (rules 801.4, 803.1). src/routes/api-tickets.ts is the routes.
import { dayOpenSql } from "./day-gate.js";

export const STATES = ["Draft", "Proposed", "Approved", "Building", "Done", "Refused", "Failed", "Shelved"];
export const LIMITS = { title: 80, brief: 2000, makeName: 60, makes: 12, tasks: 20, task: 200, running_cost: 200, estimate: 99, post: 2000 };
// The block a commission is voted at the mark of (rule 105.4), and the one rule a game needs for a workshop at all.
export const WORKSHOP_BLOCK = "800";
export const WORKSHOP_RULE = "801";
// The price of a commission until Gremlin sets it (a later step), and why.
export const NO_GREMLIN = "No Gremlin yet.";

/** "W3", "w3" or 3 -> 3; anything else -> null. @rule 801.2 */
export function ticketNumber(v) {
  const m = /^\s*[wW]?(\d{1,6})\s*$/.exec(String(v ?? ""));
  return m ? Number(m[1]) : null;
}

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const RULE_NUM = /^\d{3}(?:\.\d{1,3})?$/;

/**
 * What a ticket's `makes` holds: the catalog entries and rule numbers it will add or change. Each item is
 * {kind: "entry", name} or {kind: "rule", num}; anything else is refused with the reason. Returns {makes} or {error}.
 * @rule 801.2
 */
export function readMakes(v) {
  if (!Array.isArray(v)) return { error: "What it makes must be a list." };
  if (v.length > LIMITS.makes) return { error: `A commission can name at most ${LIMITS.makes} things to make.` };
  const makes = [];
  for (const m of v) {
    if (m && m.kind === "entry") {
      const name = clean(m.name);
      if (!name) return { error: "A catalog entry needs a name." };
      if (name.length > LIMITS.makeName) return { error: `A catalog entry's name is at most ${LIMITS.makeName} characters.` };
      if (!makes.some((x) => x.kind === "entry" && x.name.toLowerCase() === name.toLowerCase())) makes.push({ kind: "entry", name });
    } else if (m && m.kind === "rule") {
      const num = clean(m.num);
      if (!RULE_NUM.test(num)) return { error: `"${num}" is not a rule number, like 801 or 801.2.` };
      if (!makes.some((x) => x.kind === "rule" && x.num === num)) makes.push({ kind: "rule", num });
    } else return { error: "Each thing it makes is a catalog entry (with a name) or a rule (with a number)." };
  }
  return { makes };
}

/**
 * The fields a player may set on a draft ticket, from a request body. Only the fields present are read (an edit may change
 * one). Returns {fields} (title, brief, makes, estimate, running_cost, tasks) or {error}.
 * @rule 801.2
 */
export function readFields(body) {
  const f = {};
  if (!body || typeof body !== "object") return { error: "Send the ticket's fields as JSON." };
  if ("title" in body) {
    f.title = clean(body.title);
    if (f.title.length > LIMITS.title) return { error: `A title is at most ${LIMITS.title} characters.` };
  }
  if ("brief" in body) {
    f.brief = String(body.brief ?? "").replace(/\r\n?/g, "\n").trim();
    if (f.brief.length > LIMITS.brief) return { error: `A brief is at most ${LIMITS.brief} characters.` };
  }
  if ("makes" in body) {
    const r = readMakes(body.makes);
    if ("error" in r) return r;
    f.makes = r.makes;
  }
  if ("estimate" in body) {
    const n = Number(body.estimate);
    if (!Number.isInteger(n) || n < 1 || n > LIMITS.estimate) return { error: `The estimate is a whole number of nights, 1 to ${LIMITS.estimate}.` };
    f.estimate = n;
  }
  if ("running_cost" in body) {
    f.running_cost = clean(body.running_cost);
    if (f.running_cost.length > LIMITS.running_cost) return { error: `The running cost is at most ${LIMITS.running_cost} characters.` };
  }
  if ("tasks" in body) {
    if (!Array.isArray(body.tasks)) return { error: "The tasks must be a list." };
    const tasks = body.tasks.map((t) => clean(typeof t === "string" ? t : t?.text)).filter(Boolean);
    if (tasks.length > LIMITS.tasks) return { error: `A ticket has at most ${LIMITS.tasks} tasks.` };
    if (tasks.some((t) => t.length > LIMITS.task)) return { error: `A task is at most ${LIMITS.task} characters.` };
    f.tasks = tasks;
  }
  return { fields: f };
}

/**
 * Whether a draft can be confirmed, and why not: a title and a brief are needed, and (rule 801.3) it must name something
 * to make. Returns null, or {error, refuse}: `refuse` is true when the rule refuses the commission (rule 801.3), not just
 * an unfinished form.
 * @rule 801.3
 */
export function confirmProblem(t) {
  if (!clean(t.title)) return { error: "Give it a title." };
  if (!clean(t.brief)) return { error: "Say what it is in the brief." };
  const makes = typeof t.makes === "string" ? JSON.parse(t.makes || "[]") : t.makes || [];
  if (!makes.length) return { error: "Refused: it names nothing to make.", refuse: true };
  return null;
}

/** Who may post in a ticket's discussion: any player of the game (rule 804.1). Dead players and Ghosts will read only. @rule 804.1 */
export const canPost = (player) => (player ? { allowed: true } : { allowed: false, reason: "Log in to post." });

/** A post's text: trimmed, 1 to 2000 characters. Returns {body} or {error}. @rule 804.1 */
export function readPost(body) {
  const text = String(body?.body ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return { error: "Write something to post." };
  if (text.length > LIMITS.post) return { error: `A post is at most ${LIMITS.post} characters.` };
  return { body: text };
}

// ---- the SQL ---------------------------------------------------------------------------------------------------------
// Open a draft: the game's next W-number, in the statement that opens it; refused if the day is not open for this player, or
// if the player already has a blank draft (two clicks make one). Binds: id, player_id, created_at, updated_at, game_id,
// player_id, then dayOpenBinds.
/** @rule 801.2 */
export const OPEN_DRAFT_SQL = `INSERT INTO tickets (id, game_id, number, player_id, price_reason, state, created_at, updated_at)
  SELECT ?, g.id, (SELECT COALESCE(MAX(number), 0) + 1 FROM tickets WHERE game_id = g.id), ?, '${NO_GREMLIN}', 'Draft', ?, ? FROM games g
  WHERE g.id = ? AND NOT EXISTS (SELECT 1 FROM tickets b WHERE b.game_id = g.id AND b.player_id = ? AND b.state = 'Draft' AND b.title = '' AND b.brief = '' AND b.makes = '[]')
    AND ${dayOpenSql}`;
// The commission's draft proposal, for the confirm to make the day's proposal (rule 801.1). Binds: id, player_id, title, brief,
// head, base_sha, created_at, game_id, then dayOpenBinds.
/** @rule 801.1 */
export const COMMISSION_DRAFT_SQL = `INSERT INTO proposals (id, game_id, player_id, day_proposed, kind, scope, target, words, title, draft_head, drafted_by, base_sha, status, created_at)
  SELECT ?, g.id, ?, g.day, 'commission', 'block', '${WORKSHOP_BLOCK}', ?, ?, ?, 'code', ?, 'draft', ? FROM games g WHERE g.id = ? AND ${dayOpenSql}`;

/**
 * What the count writes for ONE commission, as statements (rules 801.4, 803.1). `q` is the counted proposal {id, number},
 * `result` {passed, sentence}. Every statement is guarded by the stored state, so a second run changes and pays nothing:
 *   passed   the ticket goes Approved with the next place in the queue (rule 803.1) and the points it costs come out of the
 *            requester, once (rule 801.4: paid points are spent, and no longer count toward winning, rule 402), the log says so
 *   failed   the ticket goes Refused with the count's sentence
 * @rule 801.4, 803.1
 */
export function countTicketStatements(db, game, q, result, day, now) {
  const mine = "t.proposal_id = ?";
  if (!result.passed) {
    return [
      db.prepare(`UPDATE tickets SET state = 'Refused', decided_at = ?, updated_at = ? WHERE proposal_id = ? AND state IN ('Draft', 'Proposed') AND EXISTS (SELECT 1 FROM proposals WHERE id = ? AND status = 'failed')`).bind(now, now, q.id, q.id),
      db.prepare(`INSERT OR IGNORE INTO ticket_log (ticket_id, day, kind, text, at) SELECT t.id, ?, 'refused', ?, ? FROM tickets t WHERE ${mine} AND t.state = 'Refused' AND t.decided_at = ?`).bind(day, `Refused: P${q.number} did not pass. ${result.sentence}`, now, q.id, now),
    ];
  }
  return [
    db.prepare(
      `UPDATE tickets SET state = 'Approved', approved_at = ?, decided_at = ?, updated_at = ?,
         paid = MIN(price, COALESCE((SELECT score FROM players WHERE game_id = tickets.game_id AND id = tickets.player_id), 0)),
         queue_pos = (SELECT COALESCE(MAX(x.queue_pos), 0) + 1 FROM tickets x WHERE x.game_id = tickets.game_id)
       WHERE proposal_id = ? AND state IN ('Draft', 'Proposed') AND EXISTS (SELECT 1 FROM proposals WHERE id = ? AND status = 'approved')`,
    ).bind(now, now, now, q.id, q.id),
    // The price comes out of the requester's points, once: paid_at is the flag.
    db.prepare(
      `UPDATE players SET score = score - (SELECT t.paid FROM tickets t WHERE ${mine} AND t.state = 'Approved' AND t.paid_at IS NULL)
       WHERE game_id = ? AND id = (SELECT t.player_id FROM tickets t WHERE ${mine} AND t.state = 'Approved' AND t.paid_at IS NULL)`,
    ).bind(q.id, game.id, q.id),
    db.prepare(`UPDATE tickets SET paid_at = ? WHERE proposal_id = ? AND state = 'Approved' AND paid_at IS NULL`).bind(now, q.id),
    db.prepare(
      `INSERT OR IGNORE INTO ticket_log (ticket_id, day, kind, text, at)
       SELECT t.id, ?, 'approved', 'Approved: P' || CAST(? AS INTEGER) || ' passed. ' || CASE WHEN t.paid > 0 THEN 'Paid ' || t.paid || CASE WHEN t.paid = 1 THEN ' point' ELSE ' points' END || '. ' ELSE '' END || 'Place ' || t.queue_pos || ' in the queue.', ?
       FROM tickets t WHERE ${mine} AND t.state = 'Approved' AND t.paid_at = ?`,
    ).bind(day, q.number, now, q.id, now),
    db.prepare(
      `INSERT INTO events (game_id, kind, text, created_at, day, phase, player_id)
       SELECT t.game_id, 'commission_approved', 'W' || t.number || ' was approved.' || CASE WHEN t.paid > 0 THEN ' ' || p.display_name || ' paid ' || t.paid || CASE WHEN t.paid = 1 THEN ' point.' ELSE ' points.' END ELSE '' END, ?, ?, 'night', t.player_id
       FROM tickets t JOIN players p ON p.game_id = t.game_id AND p.id = t.player_id
       WHERE ${mine} AND t.state = 'Approved' AND t.paid_at = ? AND EXISTS (SELECT 1 FROM ticket_log l WHERE l.ticket_id = t.id AND l.kind = 'approved' AND l.at = ?)`,
    ).bind(now, day, q.id, now, now),
  ];
}
