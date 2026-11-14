/**
 * The sites whose embeds may load in a frame (plan W8.7).
 *
 * One list, `embedProviders` in security/policy.json. scripts/headers.mjs
 * renders it into the content frame's frame-src (public/_headers, the Vercel
 * and nginx configs, Tauri's rule) and src/plugins/embedUrl.ts frames no
 * other site. The airplane switch's EMBED_ORIGINS (src/privacy/airplaneEmbeds.ts)
 * is this list plus the content frame's own site and the Gist script. Lists
 * that had to be equal had drifted (review 8, RR8-451-2), so there is no
 * second one: change the policy file and run `npm run headers:write`.
 *
 * Only this key of the policy reaches the bundle (a named JSON import).
 */
import { embedProviders } from "../../security/policy.json";

export const EMBED_PROVIDER_ORIGINS: ReadonlySet<string> = new Set(embedProviders);

/** Is `src` an https URL on one of the embed providers? */
export function isEmbedProvider(src: string): boolean {
  try {
    const u = new URL(src);
    return u.protocol === "https:" && EMBED_PROVIDER_ORIGINS.has(u.origin);
  } catch {
    return false;
  }
}
