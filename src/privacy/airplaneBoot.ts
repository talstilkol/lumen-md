/**
 * Airplane mode at start-up (plan W5.9) — the small part that must run
 * before anything else (src/main.tsx imports it second, after Trusted Types).
 *
 * When the switch is on, a Content-Security-Policy <meta> goes into the page
 * at once: from then on the browser itself refuses every image, font, media
 * file, frame and connection to another site. The wrappers and the live list
 * of attempts (src/privacy/airplane.ts) load right after, off the startup
 * bundle.
 */

export const AIRPLANE_KEY = "lumen.airplane";
const META_ID = "lumen-airplane-csp";

/** What the page may still load while the switch is on: itself, blob:, data:, loopback. */
export const AIRPLANE_CSP =
  "default-src 'self' blob: data:; script-src 'self' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob: data:; font-src 'self' data:; frame-src 'self' blob:; worker-src 'self' blob:; connect-src 'self' blob: data: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*";

/** When the switch went on (ms since the epoch), or null when it is off. */
export function airplaneSinceStored(): number | null {
  try {
    const v = JSON.parse(localStorage.getItem(AIRPLANE_KEY) ?? "null") as { since?: unknown } | null;
    return v && typeof v.since === "number" ? v.since : null;
  } catch {
    return null;
  }
}

let on = airplaneSinceStored() !== null;

/** Is airplane mode on in this page? */
export function airplaneFlagOn(): boolean {
  return on;
}

/** The browser-enforced half: once added, the page cannot loosen it (turning off reloads). */
export function addAirplaneCsp(doc: Document = document): void {
  on = true;
  if (!doc?.head || typeof doc.getElementById !== "function" || doc.getElementById(META_ID)) return;
  const meta = doc.createElement("meta");
  meta.id = META_ID;
  meta.httpEquiv = "Content-Security-Policy";
  meta.content = AIRPLANE_CSP;
  doc.head.appendChild(meta);
}

if (on && typeof document !== "undefined" && document.head) addAirplaneCsp(document);

/** Tests only: the flag as if the page had just loaded with it. */
export function __setAirplaneFlag(value: boolean): void {
  on = value;
}
