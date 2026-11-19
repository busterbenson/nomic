// Shared by /<slug>/api/join and /<slug>/api/login: rate limit, create a token, mail it.
import { emailMode, sendEmail } from "./email";
import { Ctx, MAX_LINKS_PER_EMAIL_HOUR, MAX_LINKS_PER_WINDOW, TOKEN_TTL_MS, nowIso, randomToken, sha256Hex, siteUrl } from "./util";

const HOUR_MS = 3600 * 1000;

// Two limits, both counting every token including decoys for unknown log-in
// emails, so they behave the same for everyone:
//   3 per (game, email) per 15 minutes, and 10 per email across all games per hour.
// This read is only for a friendlier early answer; the INSERT below enforces
// both atomically.
export async function tooManyLinks(env: Ctx["env"], gameId: string, email: string): Promise<boolean> {
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM login_tokens WHERE game_id = ? AND email = ? AND created_at > ?) AS per_game,
            (SELECT COUNT(*) FROM login_tokens WHERE email = ? AND created_at > ?) AS per_email`,
  ).bind(gameId, email, nowIso(now - TOKEN_TTL_MS), email, nowIso(now - HOUR_MS)).first();
  return (row?.per_game ?? 0) >= MAX_LINKS_PER_WINDOW || (row?.per_email ?? 0) >= MAX_LINKS_PER_EMAIL_HOUR;
}

export async function issueLink(
  ctx: Ctx,
  game: { id: string; slug: string; name: string },
  t: { email: string; purpose: "join" | "login"; name?: string; color?: string; next?: string; send: boolean; subject: string; intro: string; action: string },
): Promise<string | null> {
  const { env, request } = ctx;
  const token = randomToken(32);
  const now = Date.now();
  // The limit checks and the insert are ONE statement, so concurrent requests
  // cannot all read "under the limit" and each insert a token.
  // `next` (migration 0003) is written only when there is one, so ordinary join and log-in links keep working
  // on a database that has not had that migration yet.
  const hasNext = t.next !== undefined;
  const ins = await env.DB.prepare(
    `INSERT INTO login_tokens (token_hash, game_id, email, purpose, display_name, color, created_at, expires_at${hasNext ? ", next" : ""})
     SELECT ?, ?, ?, ?, ?, ?, ?, ?${hasNext ? ", ?" : ""}
     WHERE (SELECT COUNT(*) FROM login_tokens WHERE game_id = ? AND email = ? AND created_at > ?) < ?
       AND (SELECT COUNT(*) FROM login_tokens WHERE email = ? AND created_at > ?) < ?`,
  )
    .bind(await sha256Hex(token), game.id, t.email, t.purpose, t.name ?? null, t.color ?? null, nowIso(now), nowIso(now + TOKEN_TTL_MS), ...(hasNext ? [t.next] : []),
      game.id, t.email, nowIso(now - TOKEN_TTL_MS), MAX_LINKS_PER_WINDOW,
      t.email, nowIso(now - HOUR_MS), MAX_LINKS_PER_EMAIL_HOUR)
    .run();
  if (!(ins.meta?.changes > 0)) return null; // over a limit: nothing stored, nothing sent
  // Decoy rows for unknown addresses would otherwise pile up: sweep old ones.
  ctx.waitUntil(env.DB.prepare("DELETE FROM login_tokens WHERE expires_at < ?").bind(nowIso(now - 24 * 3600 * 1000)).run());
  const link = `${siteUrl(env, request)}/${game.slug}/auth/verify?token=${token}`;
  if (t.send && emailMode(env)) {
    ctx.waitUntil(
      sendEmail(env, {
        to: t.email,
        subject: t.subject,
        text: `${t.intro}\n\n${t.action}, open this link and press Continue:\n${link}\n\nThe link works once and expires in 15 minutes. If you didn't ask for it, you can ignore this email.\n\nChalant\nModerator, ${game.name}`,
      }).catch((e) => console.error("magic link email failed:", e?.message || e)),
    );
  }
  return link;
}
