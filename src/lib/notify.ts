// notify() writes one in-game notification per player of ONE game and queues the
// emails. Today player_joined and turn_submitted use it. turn_started,
// proposal_open, vote_result and ruling are meant to call it the same way once
// the referee exists.
import { emailMode, sendEmail } from "./email";
import { Ctx, Env, nowIso } from "./util";

export type NotifyOpts = {
  kind: string;
  body: string;
  link?: string; // site-relative, e.g. "/<slug>/"
  email?: boolean; // also send an email
  exceptPlayerId?: string; // do not EMAIL this player (they still get the in-game row)
  baseUrl?: string; // absolute site URL for links in emails
};

export async function notify(
  env: Env,
  ctx: Pick<Ctx, "waitUntil">,
  game: { id: string; slug: string; name: string },
  opts: NotifyOpts,
): Promise<void> {
  const players = (
    await env.DB.prepare("SELECT id AS player_id, email FROM players WHERE game_id = ?").bind(game.id).all()
  ).results as { player_id: string; email: string }[];
  const created = nowIso();
  const rows = players.map((p) => ({ ...p, id: crypto.randomUUID() }));
  if (!rows.length) return;
  const link = opts.link ?? `/${game.slug}/`;
  await env.DB.batch(
    rows.map((r) =>
      env.DB.prepare(
        "INSERT INTO notifications (id, game_id, player_id, kind, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(r.id, game.id, r.player_id, opts.kind, opts.body, link, created),
    ),
  );
  // Email is best effort and never blocks or fails the request that caused it.
  if (!opts.email || !emailMode(env)) return;
  const base = (opts.baseUrl || env.SITE_URL || "").replace(/\/+$/, "");
  for (const r of rows) {
    if (r.player_id === opts.exceptPlayerId) continue;
    ctx.waitUntil(
      sendEmail(env, {
        to: r.email,
        subject: `${game.name}: ${opts.body}`.slice(0, 200),
        text: `${opts.body}\n\n${base}${link}\n\nYou get this because you are a player in ${game.name}.`,
      })
        .then(() => env.DB.prepare("UPDATE notifications SET emailed_at = ? WHERE id = ?").bind(nowIso(), r.id).run())
        .catch((e) => console.error("notification email failed:", e?.message || e)),
    );
  }
}
