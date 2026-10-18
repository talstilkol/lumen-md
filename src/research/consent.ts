/**
 * The one-time web-research consent (T34): the first research that would
 * reach the web asks once, and only the query (or a page address) is sent.
 * `research.ask` asks for it; agent network tools (`search_web`,
 * `fetch_page`) count it as consent under the `local-only` policy unless
 * the caller asks per call (`RunOptions.consentNetwork`).
 */

const WEB_CONSENT_KEY = "lumen.research.webConsent";

export function hasWebConsent(): boolean {
  try {
    return localStorage.getItem(WEB_CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

export function grantWebConsent(): void {
  try {
    localStorage.setItem(WEB_CONSENT_KEY, "1");
  } catch {
    /* asked again next time */
  }
}

export function revokeWebConsent(): void {
  try {
    localStorage.removeItem(WEB_CONSENT_KEY);
  } catch {
    /* nothing stored */
  }
}
