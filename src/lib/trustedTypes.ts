/**
 * Trusted Types wrapper for innerHTML assignments.
 *
 * When the CSP directive `require-trusted-types-for 'script'` is set,
 * browsers block direct innerHTML. This module provides a small policy
 * that DOMPurify-based SVG sanitizers can use, and a fallback for
 * environments where Trusted Types are not enforced.
 *
 * Usage:
 *   import { safeSetHtml } from "./trustedTypes";
 *   safeSetHtml(element, svgString);
 *
 * The policy name must match the CSP header:
 *   require-trusted-types-for 'script';
 *   trusted-types lumen;
 */

const POLICY_NAME = "lumen";

function getPolicy(): { createHTML: (input: string) => string } | undefined {
  if (typeof window === "undefined") return undefined;
  const tt = (window as unknown as Record<string, unknown>).trustedTypes as
    | { createPolicy: (name: string, opts: unknown) => unknown }
    | undefined;
  if (!tt) return undefined;

  try {
    // Attempt to retrieve or create the policy.
    const policy =
      (tt as unknown as Record<string, unknown>).createPolicy === undefined
        ? undefined
        : (tt as unknown as Record<string, unknown>)[POLICY_NAME] ??
          (tt as { createPolicy: (name: string, opts: unknown) => unknown }).createPolicy(
            POLICY_NAME,
            {
              createHTML: (input: string) => input,
              createScript: () => "",
              createScriptURL: () => "",
            },
          );
    return policy as { createHTML: (input: string) => string } | undefined;
  } catch {
    // Policy already exists with a different definition — ignore.
    return undefined;
  }
}

let cachedPolicy: ReturnType<typeof getPolicy>;

/**
 * Safely set `innerHTML` using a Trusted Types policy when available,
 * falling back to a direct assignment otherwise.
 */
export function safeSetHtml(el: HTMLElement, html: string): void {
  if (typeof window === "undefined") {
    (el as unknown as Record<string, string>).innerHTML = html;
    return;
  }
  cachedPolicy ??= getPolicy();
  if (cachedPolicy) {
    el.innerHTML = cachedPolicy.createHTML(html);
  } else {
    el.innerHTML = html;
  }
}

/**
 * Clear an element's content safely.
 */
export function safeClearHtml(el: HTMLElement): void {
  safeSetHtml(el, "");
}
