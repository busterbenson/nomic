import { Env, SESSION_TTL_MS, nowIso, randomToken, sha256Hex } from "./util";

export const COOKIE = "nomic_session";

export function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export const cookieHeader = (value: string, maxAgeSeconds: number) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;

// The cookie holds a random 32-byte id; only its hash is stored.
export async function createSession(env: Env, userId: string): Promise<string> {
  const id = randomToken(32);
  const now = Date.now();
  await env.DB.prepare("INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(id), userId, nowIso(now), nowIso(now + SESSION_TTL_MS))
    .run();
  return cookieHeader(id, SESSION_TTL_MS / 1000);
}

export async function getUser(env: Env, request: Request): Promise<{ id: string; email: string; display_name: string } | null> {
  const id = readCookie(request, COOKIE);
  if (!id) return null;
  return await env.DB.prepare(
    `SELECT u.id, u.email, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id_hash = ? AND s.expires_at > ?`,
  ).bind(await sha256Hex(id), nowIso()).first();
}

export async function destroySession(env: Env, request: Request): Promise<void> {
  const id = readCookie(request, COOKIE);
  if (id) await env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(await sha256Hex(id)).run();
}
