// Small shared helpers for the Pages Functions. No dependencies.

// Loose types: wrangler bundles this with esbuild and does not type-check.
export type Env = {
  DB: any;
  EMAIL?: { send(msg: any): Promise<any> };
  RESEND_API_KEY?: string;
  DEV_MODE?: string;
  MAIL_FROM?: string;
  SITE_URL?: string;
};
export type Ctx = {
  request: Request;
  env: Env;
  waitUntil(p: Promise<unknown>): void;
  next(): Promise<Response>;
  params: Record<string, string | string[]>;
};

// The marker set from the original board. A game seats at most this many.
export const MARKERS = [
  { marker: "🦉", color: "#c47f2c" },
  { marker: "🐙", color: "#3a7ca5" },
  { marker: "🦊", color: "#b5452f" },
  { marker: "🐢", color: "#4f8a4b" },
  { marker: "🦋", color: "#7a5ba8" },
];

export const TOKEN_TTL_MS = 15 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_LINKS_PER_WINDOW = 3; // magic links per email per TOKEN_TTL_MS

export const nowIso = (ms = Date.now()) => new Date(ms).toISOString();

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

// POST bodies must be JSON. The middleware enforces the content type; a
// cross-site HTML form cannot send application/json, so this is the CSRF guard
// that goes with SameSite=Lax cookies.
export async function readJson(request: Request): Promise<any | null> {
  try {
    const v = await request.json();
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

export function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const randomToken = (bytes = 32) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Join codes are shown in capitals without lookalikes; accept any case,
// and ignore spaces and dashes people add when typing one in.
export const normCode = (s: unknown) => String(s ?? "").replace(/[\s-]/g, "").toUpperCase();

export function validEmail(s: unknown): s is string {
  return typeof s === "string" && s.length <= 254 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(s);
}
export const normEmail = (s: string) => s.trim().toLowerCase();

// Display names: 1-40 characters, no control characters or newlines (they end
// up in email subjects and the public log).
export function cleanName(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, "").replace(/\s+/g, " ").trim(); // \s also folds U+2028/2029
  return t.length >= 1 && [...t].length <= 40 ? t : null;
}

export const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// Links in emails. SITE_URL wins so a forged Host header can't point a magic
// link somewhere else; the request origin is the fallback for local use.
export function siteUrl(env: Env, request: Request): string {
  return (env.SITE_URL || new URL(request.url).origin).replace(/\/+$/, "");
}

// There is one game at a time: the newest.
export async function currentGame(env: Env): Promise<any | null> {
  return await env.DB.prepare("SELECT * FROM games ORDER BY created_at DESC, rowid DESC LIMIT 1").first();
}

export async function gameByCode(env: Env, code: string): Promise<any | null> {
  return await env.DB.prepare("SELECT * FROM games WHERE join_code = ?").bind(code).first();
}

export async function seatsTaken(env: Env, gameId: string): Promise<{ marker: string }[]> {
  const r = await env.DB.prepare("SELECT marker FROM players WHERE game_id = ?").bind(gameId).all();
  return r.results as { marker: string }[];
}
