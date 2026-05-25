/**
 * Shared init script for e2e specs: nukes all Lumen-owned localStorage
 * keys so each test starts from a deterministic blank state.
 *
 * Persisted prefixes/keys (from a sweep of `localStorage.setItem(...)`
 * calls in src/):
 *   - "lumen-md"             — main Zustand persist bucket
 *   - "lumen-tour-done"      — onboarding tour completion flag
 *   - "lumen.*"              — feature-specific keys (collab, canvas,
 *                              gdrive tokens, dropbox tokens, publish
 *                              mock, search history, template downloads,
 *                              entitlement override, etc.)
 *   - "lumen-*"              — older flat keys (sidebar width, etc.)
 *
 * The dotted "lumen." namespace covers OAuth tokens and collab signaling
 * URLs which previously leaked between test runs. We clear those too so
 * a test box that was logged into gdrive/dropbox manually doesn't taint
 * the suite.
 */
export const CLEAR_LUMEN_STATE = (): void => {
  try {
    const remove: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith("lumen-") || k.startsWith("lumen.")) remove.push(k);
    }
    for (const k of remove) localStorage.removeItem(k);
    // Re-set the tour-done flag so the onboarding modal doesn't pop on
    // first paint. Cleared state + tour-done is the canonical "fresh
    // user, second-launch" snapshot.
    localStorage.setItem("lumen-tour-done", "1");
  } catch {
    /* localStorage unavailable — beforeEach will still pass. */
  }
};
