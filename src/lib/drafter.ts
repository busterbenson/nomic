// The small model that drafts REWORDING (rule 103.1): the player's plain words in, the exact new text of the rule or
// clause out, with the other rules it would conflict with (rule 108.3). Every other kind is drafted by code
// (src/lib/proposals.js draftOf), so play never waits on a model for them.
//   MODEL_API_KEY   the secret (wrangler secret put MODEL_API_KEY). Unset: rewording answers "drafting is unavailable"
//                   and the mechanical kinds still work.
//   MODEL_BASE_URL  where the Messages API is (default https://api.anthropic.com). The tests point it at a local stub
//                   with recorded answers; never set it in production.
//   MODEL_NAME      the model (default claude-haiku-5-5).
//   DRAFTER_FLAGS   which levers are on, a comma list of: candidates (code lists the parts a change could collide with, for
//                   the model to judge), cache (the instructions and the rulebook go first, marked for prompt caching, the
//                   player's words last), structured (the answer is constrained to a JSON schema). "none" = all off;
//                   "-cache" turns one off of the default set. Unset = DEFAULT_FLAGS.
// The key is sent only in the request header and never logged or returned.
import { answerSchema, modelPrompt, readModelAnswer } from "./proposals.js";
import { Env } from "./util";

export type DraftAnswer = { after_text: string; conflicts: string[]; settings: Record<string, unknown> };
// "refused": the model or a check said no, with a sentence for the player (reason: declined, scope, setting, nochange, 110.1).
export class DrafterError extends Error {
  constructor(public code: "unavailable" | "failed" | "malformed" | "refused", message: string, public reason?: string) { super(message); }
}
export const UNAVAILABLE = "Drafting a rewording is unavailable right now. You can still add a clause, add a rule, repeal, move or change a mark, or edit the wording yourself.";

export type DrafterFlags = { candidates: boolean; cache: boolean; structured: boolean };
// candidates and structured held their score on the live eval (docs/drafter-eval.md) and are on. cache held it too, but pays only when
// drafts arrive within 5 minutes of each other (a cache write costs 1.25x, a read 0.1x), so it is off until traffic is bursty.
export const DEFAULT_FLAGS: DrafterFlags = { candidates: true, cache: false, structured: true };
/** @rule 103.1 */
export function drafterFlags(env: Env): DrafterFlags {
  const raw = (env.DRAFTER_FLAGS ?? "").trim();
  if (!raw) return { ...DEFAULT_FLAGS };
  const names = raw.split(",").map((x) => x.trim()).filter(Boolean);
  const on = names.every((n) => n.startsWith("-")) ? { ...DEFAULT_FLAGS } : { candidates: false, cache: false, structured: false };
  for (const n of names) {
    const k = n.replace(/^-/, "") as keyof DrafterFlags;
    if (k in on) on[k] = !n.startsWith("-");
  }
  return on;
}

/** @rule 103.1 */
export const drafterReady = (env: Env) => !!env.MODEL_API_KEY;

/** @rule 103.1, 108.3 */
export async function draftRewording(env: Env, book: any, rulesMd: string, req: any): Promise<DraftAnswer> {
  if (!env.MODEL_API_KEY) throw new DrafterError("unavailable", UNAVAILABLE);
  const base = (env.MODEL_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  const flags = drafterFlags(env);
  const p = modelPrompt(book, rulesMd, req, { candidates: flags.candidates });
  // With caching, the rulebook is its own block ending in a cache breakpoint: everything before it (the instructions and the
  // rulebook) is the same for every player all day, and the player's words come after it.
  const content = flags.cache
    ? [{ type: "text", text: p.rulebook, cache_control: { type: "ephemeral" } }, { type: "text", text: p.rest }]
    : p.user;
  let res: Response;
  try {
    res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      signal: AbortSignal.timeout(25_000),
      headers: { "content-type": "application/json", "x-api-key": env.MODEL_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: env.MODEL_NAME || "claude-haiku-5-5",
        max_tokens: 2000,
        output_config: flags.structured ? { effort: "low", format: { type: "json_schema", schema: answerSchema() } } : { effort: "low" },
        system: p.system,
        messages: [{ role: "user", content }],
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
  const u = body?.usage;
  if (flags.cache && u) console.log("drafter: tokens", { input: u.input_tokens, cache_read: u.cache_read_input_tokens, cache_write: u.cache_creation_input_tokens, output: u.output_tokens });
  const text = Array.isArray(body?.content) ? body.content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("") : "";
  const a = readModelAnswer(book, req, text);
  if ("error" in a && a.error === "refused") throw new DrafterError("refused", String((a as any).message), String((a as any).reason));
  if ("error" in a) throw new DrafterError("malformed", "The moderator's draft came back garbled. Try again, or edit the wording yourself.");
  return a as DraftAnswer;
}
