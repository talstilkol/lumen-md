/**
 * The whole OAuth flow for a remote MCP server (plan W13.A1), per the
 * 2026-07-28 authorization spec, on top of the checks in ./oauth.ts:
 *
 *   1. Discovery. The server's 401 names its Protected Resource Metadata
 *      (RFC 9728, `WWW-Authenticate: Bearer resource_metadata="…"`), else
 *      the well-known address is tried. The metadata must be for this very
 *      server (`resource`), and names the authorization server; that
 *      server's metadata (RFC 8414, then OpenID discovery) must name itself
 *      as the issuer it was fetched for. No fetch follows a redirect.
 *   2. Registration. When the authorization server advertises Client ID
 *      Metadata Documents, our client_id is the URL of our metadata
 *      document and nothing is registered: Dynamic Client Registration is
 *      deprecated and is never called then. Without CIMD, a client id the
 *      user entered for that issuer is used; DCR only when the user allowed
 *      the legacy path for that server, and its result is kept for that
 *      issuer only (issuer-bound client credentials).
 *   3. The redirect. Desktop: the loopback address of our metadata document
 *      (RFC 8252 §7.3, `application_type: native`); web: our https callback.
 *   4. The code. `iss` (RFC 9207) and `state` are checked before anything is
 *      sent to a token endpoint; the token endpoint is the one of the issuer
 *      the request was started with (a mix-up attack swaps the metadata);
 *      the code goes with its PKCE verifier and `resource` (RFC 8707).
 *   5. The token is stored under (issuer, resource) and refreshed from the
 *      same issuer only.
 *
 * `fetchImpl` is passed in: this module opens no connection of its own (the
 * remote-server path that calls it is already in the privacy ledger).
 */
import { authorizationRequest, canonicalResource, checkAuthorizationResponse, checkAuthServerMetadata, CLIENT_ID, type AuthServerMetadata, type PendingAuthorization, type StoredCredential } from "./oauth";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The redirect URIs in public/oauth/client-metadata.json. */
export const WEB_REDIRECT = "https://lumen-md.vercel.app/oauth/callback";
export const LOOPBACK_REDIRECT = "http://127.0.0.1:47613/oauth/callback";

export function redirectUriFor(surface: "desktop" | "web"): string {
  return surface === "desktop" ? LOOPBACK_REDIRECT : WEB_REDIRECT;
}

export interface FullAuthServerMetadata extends AuthServerMetadata {
  registration_endpoint?: string;
}

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  scopes_supported?: string[];
}

export class OAuthFlowError extends Error {}

async function getJson(fetchImpl: Fetch, url: string): Promise<unknown | null> {
  const res = await fetchImpl(url, { method: "GET", headers: { Accept: "application/json" }, redirect: "error" });
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** The `resource_metadata` URL of a `WWW-Authenticate: Bearer …` header, or null. */
export function resourceMetadataUrl(wwwAuthenticate: string | null | undefined): string | null {
  const m = /resource_metadata="([^"]+)"/i.exec(wwwAuthenticate ?? "");
  return m ? m[1] : null;
}

/** `/.well-known/<name>` inserted before the path (RFC 8414 §3.1, RFC 9728 §3.1). */
export function wellKnown(url: string, name: string): string {
  const u = new URL(url);
  const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
  return `${u.origin}/.well-known/${name}${path}`;
}

/** Steps 1: the authorization server of an MCP server, checked. */
export async function discover(serverUrl: string, fetchImpl: Fetch, wwwAuthenticate?: string | null): Promise<{ resource: string; meta: FullAuthServerMetadata; scopes?: string[] }> {
  const resource = canonicalResource(serverUrl);
  const prmUrl = resourceMetadataUrl(wwwAuthenticate) ?? wellKnown(serverUrl, "oauth-protected-resource");
  if (new URL(prmUrl).protocol !== "https:" && !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(prmUrl)) throw new OAuthFlowError("the resource metadata is not on https: refused");
  const prm = (await getJson(fetchImpl, prmUrl)) as ProtectedResourceMetadata | null;
  if (!prm || typeof prm.resource !== "string" || !Array.isArray(prm.authorization_servers) || !prm.authorization_servers.length) throw new OAuthFlowError("the server publishes no protected resource metadata");
  if (canonicalResource(prm.resource) !== resource) throw new OAuthFlowError(`the resource metadata is for ${prm.resource}, not ${resource}: refused`);
  const issuer = prm.authorization_servers[0];
  if (new URL(issuer).protocol !== "https:") throw new OAuthFlowError("the authorization server is not on https: refused");
  let meta = (await getJson(fetchImpl, wellKnown(issuer, "oauth-authorization-server"))) as FullAuthServerMetadata | null;
  if (!meta) meta = (await getJson(fetchImpl, wellKnown(issuer, "openid-configuration"))) as FullAuthServerMetadata | null;
  if (!meta) throw new OAuthFlowError(`no authorization server metadata at ${issuer}`);
  checkAuthServerMetadata(meta, issuer);
  return { resource, meta, ...(prm.scopes_supported ? { scopes: prm.scopes_supported } : {}) };
}

/** Client ids per issuer: one issuer's id is never sent to another (issuer-bound client credentials). */
export class ClientRegistry {
  private readonly byIssuer = new Map<string, { clientId: string; via: "manual" | "dcr" }>();
  set(issuer: string, clientId: string, via: "manual" | "dcr"): void {
    if (!issuer || !clientId) throw new OAuthFlowError("a client id needs its issuer");
    this.byIssuer.set(issuer, { clientId, via });
  }
  get(issuer: string): { clientId: string; via: "manual" | "dcr" } | null {
    return this.byIssuer.get(issuer) ?? null;
  }
}

export interface Registration {
  method: "cimd" | "manual" | "dcr";
  clientId: string;
}

/** Step 2: which client id to use with this authorization server. DCR is never called when CIMD is advertised. */
export async function registrationFor(meta: FullAuthServerMetadata, opts: { registry: ClientRegistry; fetchImpl: Fetch; redirectUri: string; allowLegacyDcr?: boolean }): Promise<Registration> {
  if (meta.client_id_metadata_document_supported) return { method: "cimd", clientId: CLIENT_ID };
  const known = opts.registry.get(meta.issuer);
  if (known) return { method: known.via, clientId: known.clientId };
  if (!opts.allowLegacyDcr || !meta.registration_endpoint) {
    throw new OAuthFlowError("this authorization server supports neither Client ID Metadata Documents nor a client id you entered; dynamic registration is deprecated and off for it");
  }
  const res = await opts.fetchImpl(meta.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_name: "Lumen", redirect_uris: [opts.redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none", application_type: "native" }),
    redirect: "error",
  });
  const body = res.ok ? ((await res.json().catch(() => null)) as { client_id?: unknown } | null) : null;
  if (!body || typeof body.client_id !== "string") throw new OAuthFlowError("dynamic registration failed");
  opts.registry.set(meta.issuer, body.client_id, "dcr");
  return { method: "dcr", clientId: body.client_id };
}

export interface StartedAuthorization {
  url: string;
  pending: PendingAuthorization & { clientId: string; tokenEndpoint: string };
}

/** Steps 1–3: the URL to open in the system browser, and what to keep until the redirect returns. */
export async function startAuthorization(serverUrl: string, opts: { fetchImpl: Fetch; surface: "desktop" | "web"; registry: ClientRegistry; wwwAuthenticate?: string | null; allowLegacyDcr?: boolean; scope?: string }): Promise<StartedAuthorization> {
  const { resource, meta, scopes } = await discover(serverUrl, opts.fetchImpl, opts.wwwAuthenticate);
  const redirectUri = redirectUriFor(opts.surface);
  const reg = await registrationFor(meta, { registry: opts.registry, fetchImpl: opts.fetchImpl, redirectUri, allowLegacyDcr: opts.allowLegacyDcr });
  const scope = opts.scope ?? scopes?.join(" ");
  const { url, pending } = await authorizationRequest(meta, redirectUri, { resource, ...(scope ? { scope } : {}) });
  const u = new URL(url);
  u.searchParams.set("client_id", reg.clientId);
  return { url: u.toString(), pending: { ...pending, clientId: reg.clientId, tokenEndpoint: meta.token_endpoint } };
}

async function tokenRequest(fetchImpl: Fetch, endpoint: string, form: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in?: number; token_type?: string }> {
  const res = await fetchImpl(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams(form).toString(), redirect: "error" });
  const body = (await res.json().catch(() => null)) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; token_type?: unknown; error?: unknown } | null;
  if (!res.ok || !body || typeof body.access_token !== "string") throw new OAuthFlowError(`the token request failed${body && typeof body.error === "string" ? `: ${body.error}` : ""}`);
  if (body.token_type !== undefined && String(body.token_type).toLowerCase() !== "bearer") throw new OAuthFlowError("not a bearer token");
  return { access_token: body.access_token, ...(typeof body.refresh_token === "string" ? { refresh_token: body.refresh_token } : {}), ...(typeof body.expires_in === "number" ? { expires_in: body.expires_in } : {}) };
}

/**
 * Step 4: the redirect came back. `meta` is the metadata the caller holds for
 * the issuer now; a different issuer than the one the request started with
 * (a mix-up) is refused before anything is sent.
 */
export async function finishAuthorization(params: URLSearchParams, pending: StartedAuthorization["pending"], meta: FullAuthServerMetadata, fetchImpl: Fetch, now = Date.now()): Promise<StoredCredential> {
  if (meta.issuer !== pending.issuer || meta.token_endpoint !== pending.tokenEndpoint) throw new OAuthFlowError(`the response is for ${pending.issuer}, but the metadata is ${meta.issuer}'s: refused (mix-up)`);
  const code = checkAuthorizationResponse(params, pending, meta); // iss and state, before the code leaves this device
  const t = await tokenRequest(fetchImpl, pending.tokenEndpoint, { grant_type: "authorization_code", code, redirect_uri: pending.redirectUri, client_id: pending.clientId, code_verifier: pending.verifier, resource: pending.resource });
  return { issuer: pending.issuer, resource: pending.resource, accessToken: t.access_token, ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}), ...(t.expires_in ? { expiresAt: now + t.expires_in * 1000 } : {}) };
}

/** Step 5: a new access token from the same issuer, for the same server. */
export async function refresh(cred: StoredCredential, meta: FullAuthServerMetadata, clientId: string, fetchImpl: Fetch, now = Date.now()): Promise<StoredCredential> {
  if (!cred.refreshToken) throw new OAuthFlowError("no refresh token: sign in again");
  if (meta.issuer !== cred.issuer) throw new OAuthFlowError(`this credential is ${cred.issuer}'s, not ${meta.issuer}'s: refused`);
  const t = await tokenRequest(fetchImpl, meta.token_endpoint, { grant_type: "refresh_token", refresh_token: cred.refreshToken, client_id: clientId, resource: cred.resource });
  return { ...cred, accessToken: t.access_token, refreshToken: t.refresh_token ?? cred.refreshToken, ...(t.expires_in ? { expiresAt: now + t.expires_in * 1000 } : {}) };
}
