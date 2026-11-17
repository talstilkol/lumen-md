/**
 * The pure parts of airplane mode (src/privacy/airplane.ts): where a request
 * goes, and the sandbox a frame keeps. Split out so airplane.ts stays under
 * the 800-line limit (W6.25); airplane.ts re-exports them. Nothing here
 * records an attempt or reads the switch: airplane.ts passes it in.
 */

import { contentFrameOrigin } from "../lib/contentFrame";

import { EMBED_PROVIDER_ORIGINS } from "../lib/embedProviders";

/** Origin + path only. */
export function egressTarget(url: string, base: string = typeof location !== "undefined" ? location.href : "http://localhost/"): string {
  try {
    const u = new URL(url, base);
    if (u.protocol === "blob:" || u.protocol === "data:") return `${u.protocol}…`;
    return `${u.origin}${u.pathname}`;
  } catch {
    return String(url).split(/[?#]/)[0].slice(0, 200);
  }
}

/**
 * The sites whose embeds keep `allow-same-origin`: the https origins of
 * public/_headers' frame-src and script-src, which are the providers of
 * src/plugins/embedUrl.ts and the embed codes they hand out (review 8,
 * RR8-451-2: one list, security/policy.json's embedProviders, plan W8.7;
 * a test keeps them equal). A frame from any other site
 * loses it, so it has no storage and no service worker of its own (review 6,
 * RR6-451-2). W6.40: the content frame's own site (src/lib/contentFrame.ts),
 * another site by design, in whose frame an embed player keeps an origin
 * that is never the app's; it is the app policy's frame-src entry. No
 * gist.github.com (W10.D2): a Gist is a link, never framed or scripted.
 */
export const EMBED_ORIGINS: ReadonlySet<string> = new Set([
  // security/policy.json's embedProviders: the content frame's frame-src (plan W8.7).
  ...EMBED_PROVIDER_ORIGINS,
  // No gist.github.com: a Gist is a link (W10.D2), not a script in the content frame.
  // The content frame's own site, the app policy's frame-src entry (W6.40).
  "https://lumen-md-frame.pages.dev",
]);

/**
 * A site whose frames keep `allow-same-origin`: EMBED_ORIGINS, and the frame
 * site this build was made with. That one comes from LUMEN_CONTENT_FRAME_URL
 * (src/lib/contentFrame.ts, a build-time value, with the same checks as
 * cspEndpoints.ts's frame-src entry), so a self-hosted frame site keeps its
 * embeds' players working without an edit here (review t5, L4).
 */
export function isKnownEmbedOrigin(origin: string): boolean {
  return EMBED_ORIGINS.has(origin) || origin === contentFrameOrigin();
}

const NO_POPUPS = new Set(["allow-popups", "allow-popups-to-escape-sandbox"]);

/**
 * A frame's sandbox as `guardFrames` leaves it: no popups while the switch is
 * on (`stripPopups`, review 8, RR8-451-2: before it, an embed's links still
 * open their page); same-origin powers only for the app and the known embeds.
 */
export function guardedSandbox(sandbox: string, src: string | null, base: string, stripPopups: boolean): string {
  let foreign = false;
  if (src) {
    try {
      const u = new URL(src, base);
      foreign = /^https?:$/.test(u.protocol) && u.origin !== new URL(base).origin && !isKnownEmbedOrigin(u.origin);
    } catch {
      foreign = true; // why: a URL that doesn't parse gets no powers
    }
  }
  return sandbox
    .split(/[\t\n\f\r ]+/)
    .filter((t) => t && !(stripPopups && NO_POPUPS.has(t.toLowerCase())) && !(foreign && t.toLowerCase() === "allow-same-origin"))
    .join(" ");
}
