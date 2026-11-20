// GET /<slug>/api/rules: the game's rules. A game with a BUNDLE (built from its repo at its latest day-N tag,
// scripts/bundle-games.mjs) is answered from the bundle, so the text you read is the text whose code is running.
// Any other game is read server-side from its own public GitHub repo
// (raw.githubusercontent.com/<repo>/<ref>/<path>) and cached 60 s.
// Public repos only: no token is ever sent. RULES_BASE_URL overrides the host
// (tests point it at a local stub; never set it in production).
import { bundleFor } from "../engine/host";
import { Ctx, validRef, validRepo, validRulesPath } from "../lib/util";

const MAX_BYTES = 200_000;
const text = (body: string, status: number, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "content-type": "text/markdown; charset=utf-8", ...extra } });

export const get = async ({ env, data, waitUntil }: Ctx) => {
  const g = data.game!;
  const { bundle, bundled } = bundleFor(g);
  if (bundled) return text(bundle.rulesMd, 200, { "cache-control": "public, max-age=60" });
  if (!validRepo(g.repo) || !validRulesPath(g.rules_path) || !validRef(g.rules_ref)) {
    return text("The rules are unavailable: this game's repo settings are invalid.", 502, { "cache-control": "no-store" });
  }
  const base = (env.RULES_BASE_URL || "https://raw.githubusercontent.com").replace(/\/+$/, "");
  const upstream = `${base}/${g.repo}/${g.rules_ref}/${g.rules_path.split("/").map(encodeURIComponent).join("/")}`;
  const key = new Request(upstream);
  const cache = (globalThis as any).caches?.default;
  try {
    const hit = cache ? await cache.match(key) : null;
    if (hit) return hit;
  } catch {}
  try {
    const res = await fetch(upstream, { signal: AbortSignal.timeout(8000), redirect: "follow", headers: { accept: "text/plain" } });
    if (!res.ok) return text(`The rules are unavailable (the game's repo answered ${res.status}).`, 502, { "cache-control": "no-store" });
    const body = await res.text();
    if (body.length > MAX_BYTES) return text("The rules are unavailable (the file is too large).", 502, { "cache-control": "no-store" });
    const out = text(body, 200, { "cache-control": "public, max-age=60" });
    if (cache) waitUntil(cache.put(key, out.clone()).catch(() => {}));
    return out;
  } catch {
    return text("The rules are unavailable (could not reach the game's repo).", 502, { "cache-control": "no-store" });
  }
};
