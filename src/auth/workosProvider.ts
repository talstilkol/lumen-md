/**
 * WorkOS SSO provider (ε.1 / F4).
 *
 * Wraps WorkOS's SAML / OIDC authorization-code dance through the
 * Lumen edge worker (`edge-workers/auth/`):
 *
 *   1. `signInWithSso(domain)` → POST `/api/sso/authorize` with the
 *      org domain → worker returns `{ redirect }` → browser navigates
 *      to the IdP.
 *   2. After the IdP roundtrip, the IdP posts back to the worker's
 *      `/api/sso/callback?code=…`. The worker exchanges the code for
 *      a profile, signs a Lumen session JWT, and 302-redirects to
 *      `${origin}/?sso=ok`.
 *   3. `loadSession()` reads the cookie (or `?sso=ok` flash param)
 *      and returns the resulting `User`.
 *
 * This module is the **client surface only**. The edge worker that
 * holds the WorkOS API key is in `edge-workers/auth/worker.ts`
 * (created in F4.3 once the WorkOS account exists).
 */

import type { AuthProvider, User } from "./types";

interface WorkOSConfig {
  /** Edge worker base URL, e.g. `https://auth.lumen.md`. */
  endpoint: string;
}

function readEndpoint(): string | null {
  try {
    const env = (
      import.meta as ImportMeta & {
        env?: { VITE_WORKOS_ENDPOINT?: string };
      }
    ).env;
    const url = env?.VITE_WORKOS_ENDPOINT;
    return url && url.length > 0 ? url.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

let testOverride: WorkOSConfig | null = null;
/** Test-only hook — skips the env read so tests can drive the provider. */
export function __setWorkOSConfigForTesting(cfg: WorkOSConfig | null): void {
  testOverride = cfg;
}

function readConfig(): WorkOSConfig | null {
  if (testOverride) return testOverride;
  const endpoint = readEndpoint();
  return endpoint ? { endpoint } : null;
}

/**
 * SSO entry point. Resolves to the redirect URL the browser must
 * navigate to. Caller does the actual `location.href = …`.
 */
export async function signInWithSso(domain: string): Promise<string> {
  const cfg = readConfig();
  if (!cfg) throw new Error("WorkOS endpoint not configured (VITE_WORKOS_ENDPOINT)");
  if (!domain.trim()) throw new Error("Org domain required");
  const res = await fetch(
    `${cfg.endpoint}/api/sso/authorize?domain=${encodeURIComponent(domain)}`,
    { credentials: "include" },
  );
  if (!res.ok) {
    throw new Error(`SSO authorize failed: ${res.status}`);
  }
  const json = (await res.json()) as { redirect?: string };
  if (!json.redirect) throw new Error("SSO authorize response missing `redirect`");
  return json.redirect;
}

/**
 * Read the current session from the worker. Returns `null` when the
 * user is anonymous. We rely on a session cookie set by the worker —
 * the browser ships it on every same-site request to the edge.
 */
export async function loadSsoSession(): Promise<User | null> {
  const cfg = readConfig();
  if (!cfg) return null;
  try {
    const res = await fetch(`${cfg.endpoint}/api/sso/session`, {
      credentials: "include",
    });
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) return null;
    const json = (await res.json()) as { user?: User };
    return json.user ?? null;
  } catch {
    return null;
  }
}

export async function signOutSso(): Promise<void> {
  const cfg = readConfig();
  if (!cfg) return;
  try {
    await fetch(`${cfg.endpoint}/api/sso/signout`, {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // Best-effort. The cookie expires on its own.
  }
}

/**
 * Provider record matching the rest of the auth layer's interface.
 * `signInWithProvider` is intentionally NOT implemented — WorkOS
 * does the IdP redirect itself; callers use `signInWithSso(domain)`
 * directly.
 */
export const workosProvider: AuthProvider = {
  name: "workos",
  async loadSession() {
    return loadSsoSession();
  },
  async signOut() {
    await signOutSso();
  },
};

/** Whether WorkOS is available (env var set). */
export function isWorkosEnabled(): boolean {
  return readConfig() !== null;
}
