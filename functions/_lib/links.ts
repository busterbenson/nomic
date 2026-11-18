// Shared by /api/join and /api/login: rate limit, create a token, mail it.
import { emailMode, sendEmail } from "./email";
import { Ctx, MAX_LINKS_PER_WINDOW, TOKEN_TTL_MS, nowIso, randomToken, sha256Hex, siteUrl } from "./util";

// Counts every token for the address in the window, including decoys for
// unknown log-in emails, so the limit behaves the same for everyone.
export async function tooManyLinks(env: Ctx["env"], email: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_tokens WHERE email = ? AND created_at > ?")
    .bind(email, nowIso(Date.now() - TOKEN_TTL_MS))
    .first();
  return (row?.n ?? 0) >= MAX_LINKS_PER_WINDOW;
}

export async function issueLink(
  ctx: Ctx,
  t: { email: string; purpose: "join" | "login"; gameId?: string; name?: string; marker?: string; send: boolean; subject: string; intro: string },
): Promise<string | null> {
  const { env, request } = ctx;
  const token = randomToken(32);
  const now = Date.now();
  // The limit check and the insert are ONE statement, so concurrent requests
  // cannot all read "under the limit" and each insert a token.
  const ins = await env.DB.prepare(
    `INSERT INTO login_tokens (token_hash, email, purpose, game_id, display_name, marker, created_at, expires_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?
     WHERE (SELECT COUNT(*) FROM login_tokens WHERE email = ? AND created_at > ?) < ?`,
  )
    .bind(await sha256Hex(token), t.email, t.purpose, t.gameId ?? null, t.name ?? null, t.marker ?? null, nowIso(now), nowIso(now + TOKEN_TTL_MS),
      t.email, nowIso(now - TOKEN_TTL_MS), MAX_LINKS_PER_WINDOW)
    .run();
  if (!(ins.meta?.changes > 0)) return null; // over the limit: nothing stored, nothing sent
  // Decoy rows for unknown addresses would otherwise pile up: sweep old ones.
  ctx.waitUntil(env.DB.prepare("DELETE FROM login_tokens WHERE expires_at < ?").bind(nowIso(now - 24 * 3600 * 1000)).run());
  const link = `${siteUrl(env, request)}/auth/verify?token=${token}`;
  if (t.send && emailMode(env)) {
    ctx.waitUntil(
      sendEmail(env, {
        to: t.email,
        subject: t.subject,
        text: `${t.intro}\n\n${link}\n\nThe link works once and expires in 15 minutes. If you did not ask for it, ignore this email.`,
      }).catch((e) => console.error("magic link email failed:", e?.message || e)),
    );
  }
  return link;
}
