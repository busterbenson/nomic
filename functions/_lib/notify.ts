// notify() writes one in-game notification per player and queues the emails.
// Today only player_joined uses it. turn_started, proposal_open, vote_result and
// ruling are meant to call it the same way once the referee exists.
import { emailMode, sendEmail } from "./email";
import { Ctx, Env, nowIso, siteUrl } from "./util";

export type NotifyOpts = {
  kind: string;
  body: string;
  link?: string; // site-relative, e.g. "/"
  email?: boolean; // also send an email
  exceptUserId?: string; // do not EMAIL this user (they still get the in-game row)
  baseUrl?: string; // absolute site URL for links in emails
};

export async function notify(env: Env, ctx: Pick<Ctx, "waitUntil">, gameId: string, opts: NotifyOpts): Promise<void> {
  const players = (
    await env.DB.prepare("SELECT u.id AS user_id, u.email FROM players p JOIN users u ON u.id = p.user_id WHERE p.game_id = ?")
      .bind(gameId)
      .all()
  ).results as { user_id: string; email: string }[];
  const created = nowIso();
  const rows = players.map((p) => ({ ...p, id: crypto.randomUUID() }));
  if (!rows.length) return;
  await env.DB.batch(
    rows.map((r) =>
      env.DB.prepare(
        "INSERT INTO notifications (id, user_id, game_id, kind, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(r.id, r.user_id, gameId, opts.kind, opts.body, opts.link ?? null, created),
    ),
  );
  // Email is best effort and never blocks or fails the request that caused it.
  if (!opts.email || !emailMode(env)) return;
  const base = (opts.baseUrl || env.SITE_URL || "").replace(/\/+$/, "");
  for (const r of rows) {
    if (r.user_id === opts.exceptUserId) continue;
    ctx.waitUntil(
      sendEmail(env, {
        to: r.email,
        subject: `Nomic: ${opts.body}`.slice(0, 200),
        text: `${opts.body}\n\n${base}${opts.link ?? "/"}\n\nYou get this because you are a player in Nomic.`,
      })
        .then(() => env.DB.prepare("UPDATE notifications SET emailed_at = ? WHERE id = ?").bind(nowIso(), r.id).run())
        .catch((e) => console.error("notification email failed:", e?.message || e)),
    );
  }
}
