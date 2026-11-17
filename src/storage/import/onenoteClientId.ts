/**
 * Plan W4.19: where the OneNote sign-in's Microsoft app (client) id comes
 * from — at run time, not from a build variable. A client id is public (a
 * PKCE public client has no secret), but a `VITE_*` name would have to join
 * security/vite-env-allowlist.json, which this plan does not widen.
 *
 * Two sources, the first one set wins:
 *  1. the user's own app registration, typed into the import wizard
 *     (`lumen.onenote.clientId` in this browser): anyone can register a
 *     free Entra app and import their own OneNote on any build;
 *  2. the deployment's runtime config, `/lumen-runtime.json` on the app's
 *     own origin (`{ "onenote": { "clientId": "<guid>" } }`), read once on
 *     use. The host serves it next to the app; no rebuild, no env var.
 *
 * Only a GUID is accepted from either. Nothing here leaves the origin: the
 * config is a same-origin GET without credentials, and the id is only ever
 * sent to Microsoft's sign-in page by onenoteSignIn.ts.
 */
export const CLIENT_ID_KEY = "lumen.onenote.clientId";
export const RUNTIME_CONFIG_PATH = "/lumen-runtime.json";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A Microsoft app (client) id: a GUID. */
export const isClientId = (s: unknown): s is string => typeof s === "string" && GUID.test(s.trim());

let deployed: string | null = null;
let loading: Promise<string | null> | null = null;

/** The id the user entered in this browser, or "". */
export function userClientId(): string {
  try {
    const v = localStorage.getItem(CLIENT_ID_KEY) ?? "";
    return isClientId(v) ? v.trim() : "";
  } catch {
    return "";
  }
}

/** Saves the user's own client id ("" forgets it). False when it is not a GUID. */
export function setUserClientId(id: string): boolean {
  const v = id.trim();
  try {
    if (!v) {
      localStorage.removeItem(CLIENT_ID_KEY);
      return true;
    }
    if (!isClientId(v)) return false;
    localStorage.setItem(CLIENT_ID_KEY, v.toLowerCase());
    return true;
  } catch {
    return false;
  }
}

/** Reads the deployment's runtime config once; null when it has no (valid) OneNote client id. */
export function loadDeployedClientId(fetcher: typeof fetch = (...a) => fetch(...a)): Promise<string | null> {
  loading ??= (async () => {
    try {
      // privacy-ledger: a same-origin GET of the app's own config file, no user data, no credentials
      const res = await fetcher(RUNTIME_CONFIG_PATH, { cache: "no-cache", credentials: "omit", headers: { Accept: "application/json" } });
      if (!res.ok) return null;
      const body = (await res.json()) as { onenote?: { clientId?: unknown } } | null;
      const id = body?.onenote?.clientId;
      deployed = isClientId(id) ? id.trim().toLowerCase() : null;
    } catch {
      deployed = null; // offline, no file, or not JSON: the sign-in is simply not offered from the deployment
    }
    return deployed;
  })();
  return loading;
}

/** The id to sign in with now: the user's, else the deployment's (once loaded), else "". */
export function oneNoteClientId(): string {
  return userClientId() || deployed || "";
}

/** Test hook: forget the loaded runtime config. */
export function __resetOneNoteClientId(): void {
  deployed = null;
  loading = null;
}
