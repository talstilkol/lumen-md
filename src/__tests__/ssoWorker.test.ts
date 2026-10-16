// @vitest-environment node
/**
 * Tests for the WorkOS SSO edge worker (edge-workers/auth/worker.ts).
 * WorkOS is mocked through a stubbed global `fetch`; the worker's own
 * routing is driven by calling `worker.fetch(request, env)` directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import worker, {
  signJwt,
  verifyJwt,
  SESSION_COOKIE,
  STATE_COOKIE,
  BILLING_TOKEN_TTL,
  type Env,
} from "../../edge-workers/auth/worker";

const APP = "https://app.lumen.test";
const WORKER = "https://auth.lumen.test";

const env: Env = {
  WORKOS_API_KEY: "sk_test_123",
  WORKOS_CLIENT_ID: "client_abc",
  SESSION_SECRET: "x".repeat(40),
  ALLOWED_ORIGINS: `${APP}, http://localhost:5173`,
};

function req(path: string, init: RequestInit & { origin?: string | null; cookie?: string } = {}): Request {
  const headers = new Headers(init.headers);
  if (init.origin !== null) headers.set("origin", init.origin ?? APP);
  if (init.cookie) headers.set("cookie", init.cookie);
  return new Request(`${WORKER}${path}`, { method: init.method ?? "GET", headers });
}

function setCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}

function cookieValue(res: Response, name: string): string | undefined {
  for (const c of setCookies(res)) {
    const [pair] = c.split(";");
    const [k, v] = pair.split("=");
    if (k === name) return v;
  }
  return undefined;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function orgsResponse(data: unknown[]) {
  return new Response(JSON.stringify({ data }), { status: 200 });
}

/** Run /authorize successfully and return the state + nonce cookie. */
async function startFlow(): Promise<{ state: string; nonce: string }> {
  fetchMock.mockResolvedValueOnce(orgsResponse([{ id: "org_01", domains: [{ domain: "acme.com" }] }]));
  const res = await worker.fetch(req("/api/sso/authorize?domain=acme.com"), env);
  expect(res.status).toBe(200);
  const { redirect } = (await res.json()) as { redirect: string };
  const state = new URL(redirect).searchParams.get("state")!;
  const nonce = cookieValue(res, STATE_COOKIE)!;
  return { state, nonce };
}

describe("routing + config", () => {
  it("answers CORS preflight only for allowed origins", async () => {
    const ok = await worker.fetch(req("/api/sso/session", { method: "OPTIONS" }), env);
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe(APP);
    expect(ok.headers.get("access-control-allow-credentials")).toBe("true");

    const bad = await worker.fetch(req("/api/sso/session", { method: "OPTIONS", origin: "https://evil.test" }), env);
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("404s unknown paths and 405s wrong methods", async () => {
    expect((await worker.fetch(req("/nope"), env)).status).toBe(404);
    expect((await worker.fetch(req("/api/sso/session", { method: "POST" }), env)).status).toBe(405);
    expect((await worker.fetch(req("/api/sso/whatever"), env)).status).toBe(404);
  });

  it("returns 503 when secrets are missing", async () => {
    const res = await worker.fetch(req("/api/sso/session"), { ...env, WORKOS_API_KEY: "" });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("not_configured");
  });

  it("reports configuration on /health", async () => {
    const res = await worker.fetch(req("/health"), env);
    expect(await res.json()).toEqual({ ok: true, configured: true });
  });
});

describe("GET /api/sso/authorize", () => {
  it("returns the WorkOS authorization URL and sets a state cookie", async () => {
    fetchMock.mockResolvedValueOnce(orgsResponse([{ id: "org_01", domains: [{ domain: "acme.com" }] }]));
    const res = await worker.fetch(req("/api/sso/authorize?domain=Acme.com"), env);
    expect(res.status).toBe(200);
    const [orgUrl, orgInit] = fetchMock.mock.calls[0];
    expect(String(orgUrl)).toBe("https://api.workos.com/organizations?domains=acme.com&limit=1");
    expect((orgInit as RequestInit).headers).toEqual({ Authorization: "Bearer sk_test_123" });

    const { redirect } = (await res.json()) as { redirect: string };
    const u = new URL(redirect);
    expect(u.origin + u.pathname).toBe("https://api.workos.com/sso/authorize");
    expect(u.searchParams.get("client_id")).toBe("client_abc");
    expect(u.searchParams.get("organization")).toBe("org_01");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("redirect_uri")).toBe(`${WORKER}/api/sso/callback`);
    expect(u.searchParams.get("state")).toMatch(/^[\w-]+\.[\w-]+$/);

    const stateCookie = setCookies(res).find((c) => c.startsWith(`${STATE_COOKIE}=`))!;
    expect(stateCookie).toMatch(/HttpOnly/);
    expect(stateCookie).toMatch(/Secure/);
    expect(stateCookie).toMatch(/SameSite=None/);
    expect(res.headers.get("access-control-allow-origin")).toBe(APP);
  });

  it("honours WORKOS_REDIRECT_URI", async () => {
    fetchMock.mockResolvedValueOnce(orgsResponse([{ id: "org_01", domains: [{ domain: "acme.com" }] }]));
    const res = await worker.fetch(req("/api/sso/authorize?domain=acme.com"), {
      ...env,
      WORKOS_REDIRECT_URI: "https://sso.example.org/cb",
    });
    const { redirect } = (await res.json()) as { redirect: string };
    expect(new URL(redirect).searchParams.get("redirect_uri")).toBe("https://sso.example.org/cb");
  });

  it("rejects disallowed origins", async () => {
    const res = await worker.fetch(req("/api/sso/authorize?domain=acme.com", { origin: "https://evil.test" }), env);
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects requests with no Origin header", async () => {
    const res = await worker.fetch(req("/api/sso/authorize?domain=acme.com", { origin: null }), env);
    expect(res.status).toBe(403);
  });

  it("validates the domain", async () => {
    for (const d of ["", "not a domain", "acme", "acme.com/evil"]) {
      const res = await worker.fetch(req(`/api/sso/authorize?domain=${encodeURIComponent(d)}`), env);
      expect(res.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404s when no WorkOS organization owns the domain", async () => {
    fetchMock.mockResolvedValueOnce(orgsResponse([]));
    const res = await worker.fetch(req("/api/sso/authorize?domain=acme.com"), env);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("no_sso_connection");
  });

  it("never routes to an organization that doesn't list the domain", async () => {
    // e.g. the domain filter ignored: the environment's first org comes back.
    fetchMock.mockResolvedValueOnce(orgsResponse([{ id: "org_other", domains: [{ domain: "other.io" }] }]));
    const res = await worker.fetch(req("/api/sso/authorize?domain=acme.com"), env);
    expect(res.status).toBe(404);
  });

  it("502s when WorkOS errors or is unreachable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    expect((await worker.fetch(req("/api/sso/authorize?domain=acme.com"), env)).status).toBe(502);
    fetchMock.mockRejectedValueOnce(new TypeError("network"));
    expect((await worker.fetch(req("/api/sso/authorize?domain=acme.com"), env)).status).toBe(502);
  });
});

describe("GET /api/sso/callback", () => {
  it("exchanges the code, sets a session cookie and redirects to ?sso=ok", async () => {
    const { state, nonce } = await startFlow();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "at",
          profile: {
            id: "prof_1",
            email: "ada@acme.com",
            first_name: "Ada",
            last_name: "Lovelace",
            organization_id: "org_01",
          },
        }),
        { status: 200 },
      ),
    );
    const res = await worker.fetch(
      req(`/api/sso/callback?code=c0de&state=${encodeURIComponent(state)}`, {
        origin: null,
        cookie: `${STATE_COOKIE}=${nonce}`,
      }),
      env,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${APP}/?sso=ok`);

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[1];
    expect(String(tokenUrl)).toBe("https://api.workos.com/sso/token");
    const form = new URLSearchParams(String((tokenInit as RequestInit).body));
    expect(form.get("client_id")).toBe("client_abc");
    expect(form.get("client_secret")).toBe("sk_test_123");
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("c0de");

    const jwt = cookieValue(res, SESSION_COOKIE)!;
    const payload = await verifyJwt(jwt, env.SESSION_SECRET);
    expect(payload?.user).toEqual({
      id: "prof_1",
      email: "ada@acme.com",
      name: "Ada Lovelace",
      provider: "workos",
      orgId: "org_01",
    });
    // State cookie is cleared.
    expect(setCookies(res).some((c) => c.startsWith(`${STATE_COOKIE}=;`) && /Max-Age=0/.test(c))).toBe(true);
  });

  it("400s on a forged or missing state", async () => {
    const res = await worker.fetch(req("/api/sso/callback?code=x&state=abc.def", { origin: null }), env);
    expect(res.status).toBe(400);
    const res2 = await worker.fetch(req("/api/sso/callback?code=x", { origin: null }), env);
    expect(res2.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("redirects with state_mismatch when the nonce cookie is missing or wrong (CSRF)", async () => {
    const { state } = await startFlow();
    const res = await worker.fetch(
      req(`/api/sso/callback?code=x&state=${encodeURIComponent(state)}`, { origin: null, cookie: `${STATE_COOKIE}=other` }),
      env,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${APP}/?sso=error&reason=state_mismatch`);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the org lookup
  });

  it("forwards IdP errors and a missing code", async () => {
    const { state, nonce } = await startFlow();
    const base = `/api/sso/callback?state=${encodeURIComponent(state)}`;
    const opts = { origin: null, cookie: `${STATE_COOKIE}=${nonce}` };
    const denied = await worker.fetch(req(`${base}&error=access_denied`, opts), env);
    expect(denied.headers.get("location")).toBe(`${APP}/?sso=error&reason=access_denied`);
    const noCode = await worker.fetch(req(base, opts), env);
    expect(noCode.headers.get("location")).toBe(`${APP}/?sso=error&reason=missing_code`);
  });

  it("redirects with code_exchange_failed when WorkOS rejects the code", async () => {
    const { state, nonce } = await startFlow();
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 400 }));
    const res = await worker.fetch(
      req(`/api/sso/callback?code=bad&state=${encodeURIComponent(state)}`, { origin: null, cookie: `${STATE_COOKIE}=${nonce}` }),
      env,
    );
    expect(res.headers.get("location")).toBe(`${APP}/?sso=error&reason=code_exchange_failed`);
    expect(cookieValue(res, SESSION_COOKIE)).toBeUndefined();
  });
});

describe("GET /api/sso/session", () => {
  it("401s without a cookie", async () => {
    expect((await worker.fetch(req("/api/sso/session"), env)).status).toBe(401);
  });

  it("returns the user for a valid session", async () => {
    const now = Math.floor(Date.now() / 1000);
    const user = { id: "u1", email: "a@b.co", provider: "workos" };
    const jwt = await signJwt({ sub: "u1", user, iat: now, exp: now + 60 }, env.SESSION_SECRET);
    const res = await worker.fetch(req("/api/sso/session", { cookie: `${SESSION_COOKIE}=${jwt}` }), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user });
  });

  it("401s for expired or tampered tokens", async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = await signJwt({ user: { id: "u1" }, exp: now - 1 }, env.SESSION_SECRET);
    expect((await worker.fetch(req("/api/sso/session", { cookie: `${SESSION_COOKIE}=${expired}` }), env)).status).toBe(401);
    const foreign = await signJwt({ user: { id: "u1" }, exp: now + 60 }, "another-secret");
    expect((await worker.fetch(req("/api/sso/session", { cookie: `${SESSION_COOKIE}=${foreign}` }), env)).status).toBe(401);
    expect((await worker.fetch(req("/api/sso/session", { cookie: `${SESSION_COOKIE}=garbage` }), env)).status).toBe(401);
  });
});

describe("POST /api/sso/signout", () => {
  it("clears the session cookie for allowed origins", async () => {
    const res = await worker.fetch(req("/api/sso/signout", { method: "POST" }), env);
    expect(res.status).toBe(204);
    expect(setCookies(res).some((c) => c.startsWith(`${SESSION_COOKIE}=;`) && /Max-Age=0/.test(c))).toBe(true);
  });

  it("refuses cross-site sign-out (CSRF)", async () => {
    const res = await worker.fetch(req("/api/sso/signout", { method: "POST", origin: "https://evil.test" }), env);
    expect(res.status).toBe(403);
  });
});

describe("jwt helpers", () => {
  it("round-trips and rejects alg tampering", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt({ a: 1, exp: now + 10 }, "s");
    expect(await verifyJwt(token, "s")).toMatchObject({ a: 1 });
    const [, body, sig] = token.split(".");
    const noneHeader = btoa(JSON.stringify({ alg: "none" })).replace(/=+$/, "");
    expect(await verifyJwt(`${noneHeader}.${body}.${sig}`, "s")).toBeNull();
  });
});

describe("GET /api/sso/token (billing bearer token)", () => {
  const tokenEnv: Env = { ...env, BILLING_TOKEN_SECRET: "b".repeat(40) };
  const now = () => Math.floor(Date.now() / 1000);
  async function sessionCookie(user: Record<string, unknown>, ttl = 3600): Promise<string> {
    const jwt = await signJwt({ sub: user.id, user, iat: now(), exp: now() + ttl }, env.SESSION_SECRET);
    return `${SESSION_COOKIE}=${jwt}`;
  }

  it("mints a short-lived token with sub/org, signed with BILLING_TOKEN_SECRET (not the session secret)", async () => {
    const cookie = await sessionCookie({ id: "user_01", provider: "workos", orgId: "org_9" });
    const res = await worker.fetch(req("/api/sso/token", { cookie }), tokenEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(APP);
    const { token, expiresAt } = (await res.json()) as { token: string; expiresAt: number };
    expect(expiresAt - now()).toBeLessThanOrEqual(BILLING_TOKEN_TTL);
    const claims = await verifyJwt(token, tokenEnv.BILLING_TOKEN_SECRET!);
    expect(claims).toMatchObject({ iss: "lumen-sso", aud: "lumen-billing", sub: "user_01", org: "org_9" });
    // Can't be replayed as a session.
    expect(await verifyJwt(token, env.SESSION_SECRET)).toBeNull();
  });

  it("never outlives the session it was minted from", async () => {
    const cookie = await sessionCookie({ id: "u", provider: "workos" }, 60);
    const res = await worker.fetch(req("/api/sso/token", { cookie }), tokenEnv);
    const { expiresAt } = (await res.json()) as { expiresAt: number };
    expect(expiresAt).toBeLessThanOrEqual(now() + 60);
  });

  it("401s without a valid session, 403s for other origins, 501s when not configured", async () => {
    expect((await worker.fetch(req("/api/sso/token"), tokenEnv)).status).toBe(401);
    const cookie = await sessionCookie({ id: "u", provider: "workos" });
    expect((await worker.fetch(req("/api/sso/token", { cookie, origin: "https://evil.test" }), tokenEnv)).status).toBe(403);
    expect((await worker.fetch(req("/api/sso/token", { cookie, origin: null }), tokenEnv)).status).toBe(403);
    expect((await worker.fetch(req("/api/sso/token", { cookie }), env)).status).toBe(501);
  });

  it("carries the WorkOS role, which the shared verifier exposes to the audit worker", async () => {
    const { verifySsoToken } = await import("../../edge-workers/shared/ssoToken");
    const cookie = await sessionCookie({ id: "user_01", provider: "workos", orgId: "org_9", role: "admin" });
    const { token } = (await (await worker.fetch(req("/api/sso/token", { cookie }), tokenEnv)).json()) as { token: string };
    expect(await verifySsoToken(token, tokenEnv.BILLING_TOKEN_SECRET!)).toEqual({ sub: "user_01", org: "org_9", role: "admin" });
  });

  it("a minted token is accepted by the billing worker", async () => {
    const billing = await import("../../edge-workers/billing/worker");
    const cookie = await sessionCookie({ id: "user_01", provider: "workos", orgId: "org_9" });
    const { token } = (await (await worker.fetch(req("/api/sso/token", { cookie }), tokenEnv)).json()) as { token: string };
    expect(await billing.verifySsoBillingToken(token, tokenEnv.BILLING_TOKEN_SECRET!)).toEqual({
      uid: "workos:user_01",
      orgUid: "workos-org:org_9",
    });
  });
});
