/**
 * Lumen SSO edge worker (MASTER_PLAN ε.1 / TASKS F4.3).
 *
 * Implements the endpoints `src/auth/workosProvider.ts` calls, on top of
 * the WorkOS SSO REST API (plain `fetch`, no SDK — keeps the bundle tiny
 * and the worker runtime-agnostic):
 *
 *   GET  /api/sso/authorize?domain=acme.com
 *        → resolves the WorkOS organization for the email domain, mints a
 *          signed `state` (CSRF nonce + return origin), sets the nonce in
 *          an HttpOnly cookie and answers `{ redirect }` with the WorkOS
 *          authorization URL. The browser navigates there itself.
 *
 *   GET  /api/sso/callback?code=…&state=…
 *        → the IdP round-trip lands here. Verifies `state` (HMAC + the
 *          nonce cookie), exchanges `code` for a profile at
 *          `POST /sso/token`, signs a Lumen session JWT (HS256) into the
 *          `lumen_session` HttpOnly cookie and 302s to `${origin}/?sso=ok`
 *          (or `?sso=error&reason=…`).
 *
 *   GET  /api/sso/session
 *        → `{ user }` from a valid session cookie, 401 otherwise.
 *
 *   POST /api/sso/signout
 *        → clears the session cookie (204). Origin-checked.
 *
 *   GET  /api/sso/token
 *        → `{ token, expiresAt }`: a 5-minute HS256 bearer token
 *          (iss "lumen-sso", aud "lumen-billing", sub, org) signed with
 *          BILLING_TOKEN_SECRET, for the billing worker's /entitlements.
 *          The session cookie is HttpOnly, so this is how an SSO user
 *          proves who they are to another service. Origin-checked;
 *          501 when BILLING_TOKEN_SECRET isn't set.
 *
 * Cookies are `SameSite=None; Secure` because the app and the worker are
 * normally on different sites (the client uses `credentials: "include"`).
 * CORS only echoes origins listed in `ALLOWED_ORIGINS` — never `*`, which
 * browsers reject for credentialed requests anyway.
 *
 * Secrets (`wrangler secret put`): WORKOS_API_KEY, WORKOS_CLIENT_ID,
 * SESSION_SECRET, optional BILLING_TOKEN_SECRET (same value as the billing
 * worker's SSO_TOKEN_SECRET; keep it distinct from SESSION_SECRET). Vars: ALLOWED_ORIGINS, optional WORKOS_REDIRECT_URI,
 * WORKOS_API_BASE, SESSION_TTL_SECONDS.
 *
 * Deploy: `cd edge-workers/auth && wrangler deploy` (see README.md).
 */

export interface Env {
  /** WorkOS secret API key (`sk_…`). Doubles as the OAuth client secret. */
  WORKOS_API_KEY: string;
  /** WorkOS client id (`client_…`). */
  WORKOS_CLIENT_ID: string;
  /** ≥32 random bytes; signs session JWTs and the OAuth `state`. */
  SESSION_SECRET: string;
  /** Comma-separated list of app origins allowed to use this worker. */
  ALLOWED_ORIGINS: string;
  /** Override the callback URL registered in WorkOS. Defaults to `${worker}/api/sso/callback`. */
  WORKOS_REDIRECT_URI?: string;
  /** Override the WorkOS API base (tests / proxies). */
  WORKOS_API_BASE?: string;
  /** Session lifetime in seconds. Default 7 days. */
  SESSION_TTL_SECONDS?: string;
  /**
   * Signs the short-lived billing tokens (`GET /api/sso/token`). Must equal
   * the billing worker's SSO_TOKEN_SECRET and differ from SESSION_SECRET, so
   * the billing worker can verify tokens without being able to mint sessions.
   */
  BILLING_TOKEN_SECRET?: string;
}

/** Shape the client expects (`src/auth/types.ts` → `User`). */
export interface SessionUser {
  id: string;
  email?: string;
  name?: string;
  provider: "workos";
  orgId?: string;
  /** WorkOS role slug within the organization (e.g. "admin"), when configured. */
  role?: string;
}

export const SESSION_COOKIE = "lumen_session";
export const STATE_COOKIE = "lumen_sso_state";
const STATE_TTL_SECONDS = 10 * 60;
const DEFAULT_SESSION_TTL = 7 * 24 * 60 * 60;
export const BILLING_TOKEN_TTL = 5 * 60;
export const BILLING_TOKEN_ISS = "lumen-sso";
export const BILLING_TOKEN_AUD = "lumen-billing";
const DEFAULT_API_BASE = "https://api.workos.com";
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/* ─── Encoding helpers ───────────────────────────────────────────────── */

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomToken(bytes = 24): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return b64urlEncode(buf);
}

/** Constant-time string compare (both inputs are ASCII tokens). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return b64urlEncode(new Uint8Array(sig));
}

/* ─── Signed tokens (JWT HS256 + OAuth state) ───────────────────────── */

export async function signJwt(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = b64urlEncode(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sig = await hmac(secret, `${header}.${body}`);
  return `${header}.${body}.${sig}`;
}

export async function verifyJwt(
  token: string,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  try {
    const head = JSON.parse(dec.decode(b64urlDecode(header))) as { alg?: string };
    if (head.alg !== "HS256") return null;
    const expected = await hmac(secret, `${header}.${body}`);
    if (!safeEqual(expected, sig)) return null;
    const payload = JSON.parse(dec.decode(b64urlDecode(body))) as Record<string, unknown>;
    if (typeof payload.exp !== "number" || payload.exp <= nowSec) return null;
    return payload;
  } catch {
    return null;
  }
}

interface StatePayload {
  nonce: string;
  origin: string;
  exp: number;
}

async function signState(p: StatePayload, secret: string): Promise<string> {
  const body = b64urlEncode(enc.encode(JSON.stringify(p)));
  return `${body}.${await hmac(secret, `state.${body}`)}`;
}

async function verifyState(state: string, secret: string): Promise<StatePayload | null> {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = await hmac(secret, `state.${body}`);
  if (!safeEqual(expected, sig)) return null;
  try {
    const p = JSON.parse(dec.decode(b64urlDecode(body))) as StatePayload;
    if (typeof p.nonce !== "string" || typeof p.origin !== "string") return null;
    if (typeof p.exp !== "number" || p.exp <= Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch {
    return null;
  }
}

/* ─── HTTP helpers ───────────────────────────────────────────────────── */

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function isAllowedOrigin(origin: string | null, env: Env): origin is string {
  return !!origin && allowedOrigins(env).includes(origin);
}

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!isAllowedOrigin(origin, env)) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, headers: Record<string, string>, cookies: string[] = []): Response {
  const h = new Headers({ ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" });
  for (const c of cookies) h.append("Set-Cookie", c);
  return new Response(JSON.stringify(body), { status, headers: h });
}

function errorJson(status: number, error: string, message: string, headers: Record<string, string>): Response {
  return json({ error, message }, status, headers);
}

function cookie(name: string, value: string, maxAge: number, path = "/"): string {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=None`;
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

function redirect(location: string, cookies: string[] = []): Response {
  const h = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const c of cookies) h.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers: h });
}

function apiBase(env: Env): string {
  return (env.WORKOS_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, "");
}

function configured(env: Env): boolean {
  return !!(env.WORKOS_API_KEY && env.WORKOS_CLIENT_ID && env.SESSION_SECRET && allowedOrigins(env).length);
}

/* ─── Routes ─────────────────────────────────────────────────────────── */

interface WorkOSOrganizationList {
  data?: Array<{ id: string; name?: string; domains?: Array<{ domain: string }> }>;
}

async function handleAuthorize(req: Request, env: Env, url: URL, cors: Record<string, string>): Promise<Response> {
  const origin = req.headers.get("origin");
  if (!isAllowedOrigin(origin, env)) {
    return errorJson(403, "origin_not_allowed", "This origin is not allowed to start SSO.", cors);
  }
  const domain = (url.searchParams.get("domain") ?? "").trim().toLowerCase();
  if (!DOMAIN_RE.test(domain)) {
    return errorJson(400, "invalid_domain", "Provide your organization's email domain, e.g. acme.com.", cors);
  }

  // Resolve the WorkOS organization that owns this domain.
  let orgRes: Response;
  try {
    orgRes = await fetch(`${apiBase(env)}/organizations?domains=${encodeURIComponent(domain)}&limit=1`, {
      headers: { Authorization: `Bearer ${env.WORKOS_API_KEY}` },
    });
  } catch {
    return errorJson(502, "workos_unreachable", "Could not reach WorkOS.", cors);
  }
  if (!orgRes.ok) {
    return errorJson(502, "workos_error", `WorkOS organization lookup failed (${orgRes.status}).`, cors);
  }
  const orgs = (await orgRes.json().catch(() => ({}))) as WorkOSOrganizationList;
  // Only an organization that actually lists this domain: if the filter
  // were ignored, the first organization of the environment must not be
  // used for someone else's domain.
  const org = orgs.data?.find((o) => o.domains?.some((d) => d.domain?.toLowerCase() === domain));
  if (!org) {
    return errorJson(404, "no_sso_connection", `No SSO organization is configured for ${domain}.`, cors);
  }

  const nonce = randomToken();
  const state = await signState(
    { nonce, origin, exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS },
    env.SESSION_SECRET,
  );
  const redirectUri = env.WORKOS_REDIRECT_URI || `${url.origin}/api/sso/callback`;
  const authUrl = new URL(`${apiBase(env)}/sso/authorize`);
  authUrl.searchParams.set("client_id", env.WORKOS_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("organization", org.id);
  authUrl.searchParams.set("state", state);

  return json({ redirect: authUrl.toString() }, 200, cors, [
    cookie(STATE_COOKIE, nonce, STATE_TTL_SECONDS, "/api/sso"),
  ]);
}

interface WorkOSProfileResponse {
  access_token?: string;
  profile?: {
    id: string;
    email?: string;
    first_name?: string | null;
    last_name?: string | null;
    organization_id?: string | null;
    connection_id?: string;
    /** Role assigned in WorkOS (SSO / directory group role mapping), if configured. */
    role?: { slug?: string | null } | null;
  };
}

async function handleCallback(req: Request, env: Env, url: URL): Promise<Response> {
  const clearState = cookie(STATE_COOKIE, "", 0, "/api/sso");
  const stateParam = url.searchParams.get("state") ?? "";
  const state = stateParam ? await verifyState(stateParam, env.SESSION_SECRET) : null;
  // Without a verified state we don't know a safe origin to bounce to.
  if (!state || !isAllowedOrigin(state.origin, env)) {
    return new Response("Invalid or expired SSO state", {
      status: 400,
      headers: { "Set-Cookie": clearState, "Cache-Control": "no-store" },
    });
  }
  const back = (reason: string) => redirect(`${state.origin}/?sso=error&reason=${encodeURIComponent(reason)}`, [clearState]);

  const nonceCookie = readCookie(req, STATE_COOKIE);
  if (!nonceCookie || !safeEqual(nonceCookie, state.nonce)) return back("state_mismatch");

  const idpError = url.searchParams.get("error");
  if (idpError) return back(idpError);
  const code = url.searchParams.get("code");
  if (!code) return back("missing_code");

  let tokenRes: Response;
  try {
    tokenRes = await fetch(`${apiBase(env)}/sso/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.WORKOS_CLIENT_ID,
        client_secret: env.WORKOS_API_KEY,
        grant_type: "authorization_code",
        code,
      }).toString(),
    });
  } catch {
    return back("workos_unreachable");
  }
  if (!tokenRes.ok) return back("code_exchange_failed");
  const body = (await tokenRes.json().catch(() => ({}))) as WorkOSProfileResponse;
  const p = body.profile;
  if (!p?.id) return back("missing_profile");

  const name = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  const user: SessionUser = {
    id: p.id,
    provider: "workos",
    ...(p.email ? { email: p.email } : {}),
    ...(name ? { name } : {}),
    ...(p.organization_id ? { orgId: p.organization_id } : {}),
    ...(p.role?.slug ? { role: p.role.slug } : {}),
  };
  const ttl = Number(env.SESSION_TTL_SECONDS) > 0 ? Number(env.SESSION_TTL_SECONDS) : DEFAULT_SESSION_TTL;
  const now = Math.floor(Date.now() / 1000);
  const jwt = await signJwt({ sub: user.id, user, iat: now, exp: now + ttl }, env.SESSION_SECRET);
  return redirect(`${state.origin}/?sso=ok`, [clearState, cookie(SESSION_COOKIE, jwt, ttl)]);
}

async function handleSession(req: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return errorJson(401, "no_session", "Not signed in.", cors);
  const payload = await verifyJwt(token, env.SESSION_SECRET);
  const user = payload?.user as SessionUser | undefined;
  if (!user?.id) return errorJson(401, "invalid_session", "Session expired or invalid.", cors);
  return json({ user }, 200, cors);
}

async function handleToken(req: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  // Only the app's own origins may read a bearer token minted from the cookie.
  if (!isAllowedOrigin(req.headers.get("origin"), env)) {
    return errorJson(403, "origin_not_allowed", "This origin is not allowed.", cors);
  }
  if (!env.BILLING_TOKEN_SECRET) {
    return errorJson(501, "not_configured", "BILLING_TOKEN_SECRET is not set on the SSO worker.", cors);
  }
  const session = readCookie(req, SESSION_COOKIE);
  const payload = session ? await verifyJwt(session, env.SESSION_SECRET) : null;
  const user = payload?.user as SessionUser | undefined;
  if (!user?.id) return errorJson(401, "no_session", "Not signed in.", cors);
  const now = Math.floor(Date.now() / 1000);
  // Never outlive the session it was minted from.
  const exp = Math.min(now + BILLING_TOKEN_TTL, payload!.exp as number);
  const token = await signJwt(
    {
      iss: BILLING_TOKEN_ISS,
      aud: BILLING_TOKEN_AUD,
      sub: user.id,
      ...(user.orgId ? { org: user.orgId } : {}),
      // Lets Lumen's workers authorize org-admin actions (audit log).
      ...(user.role ? { role: user.role } : {}),
      iat: now,
      exp,
    },
    env.BILLING_TOKEN_SECRET,
  );
  return json({ token, expiresAt: exp }, 200, cors);
}

function handleSignout(req: Request, env: Env, cors: Record<string, string>): Response {
  // CSRF: a cross-site form could POST here; only allowed origins may.
  if (!isAllowedOrigin(req.headers.get("origin"), env)) {
    return errorJson(403, "origin_not_allowed", "This origin is not allowed.", cors);
  }
  const h = new Headers({ ...cors, "Cache-Control": "no-store" });
  h.append("Set-Cookie", cookie(SESSION_COOKIE, "", 0));
  return new Response(null, { status: 204, headers: h });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (url.pathname === "/health") {
      return json({ ok: true, configured: configured(env) }, 200, cors);
    }
    if (!url.pathname.startsWith("/api/sso/")) {
      return errorJson(404, "not_found", "Not found.", cors);
    }
    if (!configured(env)) {
      return errorJson(503, "not_configured", "SSO worker is missing WORKOS_* / SESSION_SECRET / ALLOWED_ORIGINS.", cors);
    }

    const route = `${req.method} ${url.pathname}`;
    switch (route) {
      case "GET /api/sso/authorize":
        return handleAuthorize(req, env, url, cors);
      case "GET /api/sso/callback":
        return handleCallback(req, env, url);
      case "GET /api/sso/session":
        return handleSession(req, env, cors);
      case "POST /api/sso/signout":
        return handleSignout(req, env, cors);
      case "GET /api/sso/token":
        return handleToken(req, env, cors);
      default:
        if (["/api/sso/authorize", "/api/sso/callback", "/api/sso/session", "/api/sso/signout", "/api/sso/token"].includes(url.pathname)) {
          return errorJson(405, "method_not_allowed", "Method not allowed.", cors);
        }
        return errorJson(404, "not_found", "Not found.", cors);
    }
  },
};
