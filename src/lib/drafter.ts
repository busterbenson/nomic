// The small model that drafts REWORDING (rule 103.1): the player's plain words in, the exact new text of the rule or
// clause out, with the other rules it would conflict with (rule 108.3). Every other kind is drafted by code
// (src/lib/proposals.js draftOf), so play never waits on a model for them.
//   MODEL_API_KEY   the secret (wrangler secret put MODEL_API_KEY). Unset: rewording answers "drafting is unavailable"
//                   and the mechanical kinds still work.
//   MODEL_BASE_URL  where the Messages API is (default https://api.anthropic.com). The tests point it at a local stub
//                   with recorded answers; never set it in production.
//   MODEL_NAME      the model (default claude-haiku-5-5).
// The key is sent only in the request header and never logged or returned.
import { modelPrompt, readModelAnswer } from "./proposals.js";
import { Env } from "./util";

export type DraftAnswer = { after_text: string; conflicts: string[]; settings: Record<string, unknown> };
export class DrafterError extends Error {
  constructor(public code: "unavailable" | "failed" | "malformed", message: string) { super(message); }
}
export const UNAVAILABLE = "Drafting a rewording is unavailable right now. You can still add a clause, add a rule, repeal, move or change a mark, or edit the wording yourself.";

/** @rule 103.1 */
export const drafterReady = (env: Env) => !!env.MODEL_API_KEY;

/** @rule 103.1, 108.3 */
export async function draftRewording(env: Env, book: any, rulesMd: string, req: any): Promise<DraftAnswer> {
  if (!env.MODEL_API_KEY) throw new DrafterError("unavailable", UNAVAILABLE);
  const base = (env.MODEL_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  const { system, user } = modelPrompt(book, rulesMd, req);
  let res: Response;
  try {
    res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      signal: AbortSignal.timeout(25_000),
      headers: { "content-type": "application/json", "x-api-key": env.MODEL_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: env.MODEL_NAME || "claude-haiku-5-5",
        max_tokens: 2000,
        output_config: { effort: "low" },
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
  } catch (e: any) {
    console.error("drafter: request failed:", e?.name || "error");
    throw new DrafterError("failed", "The moderator could not draft that just now. Try again in a minute.");
  }
  if (!res.ok) {
    console.error("drafter: model answered", res.status);
    throw new DrafterError("failed", "The moderator could not draft that just now. Try again in a minute.");
  }
  let body: any;
  try { body = await res.json(); } catch { body = null; }
  const text = Array.isArray(body?.content) ? body.content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("") : "";
  const a = readModelAnswer(book, req, text);
  if ("error" in a) throw new DrafterError("malformed", "The moderator's draft came back garbled. Try again, or edit the wording yourself.");
  return a as DraftAnswer;
}
