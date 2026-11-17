/**
 * Is this browser inside the support policy (plan W13.T2,
 * docs/support-policy.md)? A few features that every supported engine has
 * and older ones lack: URL.parse (Chrome/Edge 126, Firefox 126, Safari 18),
 * Promise.withResolvers and the Set methods. A browser that lacks any of
 * them is told once per version, in a lazy notice; nothing is blocked.
 * Startup path: tiny, no imports.
 */

/** The features a supported engine must have, by name (for the diagnostics). */
export function missingFeatures(g: typeof globalThis = globalThis): string[] {
  const out: string[] = [];
  const url = g.URL as unknown as { parse?: unknown } | undefined;
  if (typeof url?.parse !== "function") out.push("URL.parse");
  if (typeof (g.Promise as unknown as { withResolvers?: unknown } | undefined)?.withResolvers !== "function") out.push("Promise.withResolvers");
  if (typeof (g.Set?.prototype as unknown as { union?: unknown } | undefined)?.union !== "function") out.push("Set.prototype.union");
  if (typeof (g.Intl as unknown as { Segmenter?: unknown } | undefined)?.Segmenter !== "function") out.push("Intl.Segmenter");
  return out;
}

export const SUPPORT_NOTICE_KEY = "lumen-support-notice";

/** Show the notice? Not when supported, and once per app version when not. */
export function shouldNotify(missing: string[], version: string, storage: Pick<Storage, "getItem"> | null): boolean {
  if (!missing.length) return false;
  try {
    return storage?.getItem(SUPPORT_NOTICE_KEY) !== version;
  } catch {
    // why: storage blocked: tell them, every start (it cannot be remembered)
    return true;
  }
}
