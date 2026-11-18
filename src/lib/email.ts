// One pluggable sender. Chosen at runtime, in this order:
//   1. env.EMAIL            Cloudflare Email Sending (send_email binding)
//   2. env.RESEND_API_KEY   Resend REST API
//   3. env.DEV_MODE === "1" the outbox table (local testing only)
//   4. none of them         emailMode() is null and callers must fail loudly
import { Env, nowIso } from "./util";

export type Mail = { to: string; subject: string; text: string };
export type Mode = "cloudflare" | "resend" | "dev";

export function emailMode(env: Env): Mode | null {
  // A real sender needs a From address; without one the mode is not usable.
  if (env.EMAIL && env.MAIL_FROM) return "cloudflare";
  if (env.RESEND_API_KEY && env.MAIL_FROM) return "resend";
  if (env.DEV_MODE === "1") return "dev";
  return null;
}

// "Promptocracy <a@b.com>" -> {email, name}; a bare address stays a string.
function parseFrom(from: string): string | { email: string; name: string } {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m && m[1] ? { email: m[2], name: m[1].replace(/^"|"$/g, "") } : from.replace(/[<>]/g, "").trim();
}

export async function sendEmail(env: Env, mail: Mail): Promise<void> {
  const mode = emailMode(env);
  if (mode === "cloudflare") {
    // https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
    await env.EMAIL!.send({ to: mail.to, from: parseFrom(env.MAIL_FROM!), subject: mail.subject, text: mail.text });
  } else if (mode === "resend") {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text }),
    });
    if (!res.ok) throw new Error(`Resend answered ${res.status}`);
  } else if (mode === "dev") {
    await env.DB.prepare("INSERT INTO outbox (to_addr, subject, body, created_at) VALUES (?, ?, ?, ?)")
      .bind(mail.to, mail.subject, mail.text, nowIso())
      .run();
  } else {
    throw new Error("email is not configured");
  }
}
