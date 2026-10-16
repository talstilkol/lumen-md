// @vitest-environment node
/**
 * Billing edge worker — GET /entitlements.
 *
 * The worker's storage is the Supabase `entitlements` table (written by the
 * Stripe webhook) reached over PostgREST, and the caller is identified via
 * Supabase `/auth/v1/user`. Both are plain `fetch` calls, so the tests mock
 * the env bindings (SUPABASE_URL / SUPABASE_SERVICE_ROLE / ALLOWED_ORIGIN)
 * and stub global fetch to play the Supabase side.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import worker, { type Env, verifySsoBillingToken, SSO_TOKEN_ISS, SSO_TOKEN_AUD } from "../../edge-workers/billing/worker";
import { signJwt } from "../../edge-workers/auth/worker";
import { capabilitiesFor, FREE_CAPS, PRO_CAPS, type Entitlement } from "../billing/types";

const ORIGIN = "https://lumen.app";
const SUPABASE = "https://proj.supabase.co";

const env: Env = {
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_x",
  SUPABASE_URL: SUPABASE,
  SUPABASE_SERVICE_ROLE: "service-role-jwt",
  ALLOWED_ORIGIN: `${ORIGIN}, http://localhost:5173`,
};

type Row = Record<string, unknown>;

/** Fake Supabase: token → user id, user id → entitlement rows. */
function mockSupabase(users: Record<string, string>, rows: Record<string, Row[]>) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const headers = new Headers(init?.headers);
    if (url === `${SUPABASE}/auth/v1/user`) {
      const token = headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
      const id = users[token];
      return id
        ? new Response(JSON.stringify({ id }), { status: 200 })
        : new Response(JSON.stringify({ msg: "invalid JWT" }), { status: 401 });
    }
    if (url.startsWith(`${SUPABASE}/rest/v1/entitlements?`)) {
      expect(headers.get("apikey")).toBe(env.SUPABASE_SERVICE_ROLE);
      // PostgREST `user_id=in.("a","b")` (values URL-encoded inside quotes).
      const param = new URL(url).searchParams.get("user_id")!;
      const ids = param
        .replace(/^in\.\(|\)$/g, "")
        .split(",")
        .map((v) => decodeURIComponent(v.replace(/^"|"$/g, "")));
      const out = ids.flatMap((id) => (rows[id] ?? []).map((r) => ({ user_id: id, ...r })));
      return new Response(JSON.stringify(out), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://billing.example.workers.dev${path}`, {
    method: "GET",
    headers: { Accept: "application/json", Origin: ORIGIN, ...headers },
  });
}

async function entitlementOf(res: Response): Promise<Entitlement> {
  const body = (await res.json()) as { entitlement: Entitlement };
  return body.entitlement;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("billing worker GET /entitlements", () => {
  it("anonymous caller (no Authorization) → free, without touching Supabase", async () => {
    const { fetchMock } = mockSupabase({}, {});
    const res = await worker.fetch(get("/entitlements"), env);
    expect(res.status).toBe(200);
    const ent = await entitlementOf(res);
    expect(ent).toEqual({ tier: "free", status: "none" });
    expect(capabilitiesFor(ent)).toEqual(FREE_CAPS);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("known user with no entitlement row → free", async () => {
    mockSupabase({ "tok-new": "user-new" }, {});
    const res = await worker.fetch(get("/entitlements", { Authorization: "Bearer tok-new" }), env);
    expect(res.status).toBe(200);
    const ent = await entitlementOf(res);
    expect(ent.tier).toBe("free");
    expect(capabilitiesFor(ent)).toEqual(FREE_CAPS);
  });

  it("active pro subscriber → pro tier and PRO capabilities", async () => {
    const { calls } = mockSupabase(
      { "tok-pro": "user-pro" },
      {
        "user-pro": [
          { tier: "pro", status: "active", renews_at: 1_900_000_000, stripe_subscription_id: "sub_123" },
        ],
      },
    );
    const res = await worker.fetch(get("/entitlements", { Authorization: "Bearer tok-pro" }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    const ent = await entitlementOf(res);
    expect(ent).toEqual({ tier: "pro", status: "active", renewsAt: 1_900_000_000, subscriptionId: "sub_123" });
    expect(capabilitiesFor(ent)).toEqual(PRO_CAPS);
    // Looked up the caller's own row only.
    expect(calls.some((u) => decodeURIComponent(u).includes('user_id=in.("user-pro")'))).toBe(true);
  });

  it("canceled pro / unknown status → no pro capabilities", async () => {
    mockSupabase(
      { a: "u-canceled", b: "u-weird" },
      {
        "u-canceled": [{ tier: "pro", status: "canceled" }],
        "u-weird": [{ tier: "enterprise", status: "incomplete_expired" }],
      },
    );
    const canceled = await entitlementOf(
      await worker.fetch(get("/entitlements", { Authorization: "Bearer a" }), env),
    );
    expect(canceled).toMatchObject({ tier: "pro", status: "canceled" });
    expect(capabilitiesFor(canceled)).toEqual(FREE_CAPS);

    const weird = await entitlementOf(
      await worker.fetch(get("/entitlements", { Authorization: "Bearer b" }), env),
    );
    expect(weird).toEqual({ tier: "free", status: "none" });
  });

  it("checkout-completed row (status 'complete') counts as active", async () => {
    mockSupabase({ t: "u" }, { u: [{ tier: "pro", status: "complete" }] });
    const ent = await entitlementOf(await worker.fetch(get("/entitlements", { Authorization: "Bearer t" }), env));
    expect(ent.status).toBe("active");
    expect(capabilitiesFor(ent)).toEqual(PRO_CAPS);
  });

  it("invalid bearer token → 401 (client falls back to free)", async () => {
    mockSupabase({}, {});
    const res = await worker.fetch(get("/entitlements", { Authorization: "Bearer forged" }), env);
    expect(res.status).toBe(401);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });

  it("rejects non-GET methods with 405", async () => {
    mockSupabase({}, {});
    const res = await worker.fetch(
      new Request("https://billing.example.workers.dev/entitlements", { method: "POST", headers: { Origin: ORIGIN } }),
      env,
    );
    expect(res.status).toBe(405);
  });
});

describe("billing worker CORS", () => {
  it("OPTIONS preflight from an allowed origin → 204 with credentialed CORS", async () => {
    const res = await worker.fetch(
      new Request("https://billing.example.workers.dev/entitlements", {
        method: "OPTIONS",
        headers: {
          Origin: ORIGIN,
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "authorization",
        },
      }),
      env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
    expect(res.headers.get("Access-Control-Allow-Headers")?.toLowerCase()).toContain("authorization");
    expect(res.headers.get("Vary")).toContain("Origin");
  });

  it("GET response echoes an allowed origin (credentials: include needs a non-* origin)", async () => {
    mockSupabase({}, {});
    const res = await worker.fetch(get("/entitlements", { Origin: "http://localhost:5173" }), env);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("disallowed origin gets the public * origin and no credentials", async () => {
    const res = await worker.fetch(
      new Request("https://billing.example.workers.dev/entitlements", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example" },
      }),
      env,
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });
});

describe("billing worker — SSO (WorkOS) billing tokens", () => {
  const SECRET = "billing-token-secret-0123456789abcdef";
  const ssoEnv: Env = { ...env, SSO_TOKEN_SECRET: SECRET };
  const now = () => Math.floor(Date.now() / 1000);
  const token = (claims: Record<string, unknown>, secret = SECRET) =>
    signJwt({ iss: SSO_TOKEN_ISS, aud: SSO_TOKEN_AUD, sub: "user_01", org: "org_9", iat: now(), exp: now() + 300, ...claims }, secret);

  it("SSO user with their own active row gets that plan, without calling Supabase auth", async () => {
    const { calls } = mockSupabase({}, { "workos:user_01": [{ tier: "pro", status: "active" }] });
    const res = await worker.fetch(get("/entitlements", { Authorization: `Bearer ${await token({})}` }), ssoEnv);
    expect(res.status).toBe(200);
    expect(await entitlementOf(res)).toMatchObject({ tier: "pro", status: "active" });
    expect(calls.some((u) => u.endsWith("/auth/v1/user"))).toBe(false);
  });

  it("falls back to an active org-wide row", async () => {
    mockSupabase({}, { "workos-org:org_9": [{ tier: "team", status: "active" }] });
    const res = await worker.fetch(get("/entitlements", { Authorization: `Bearer ${await token({})}` }), ssoEnv);
    expect(await entitlementOf(res)).toMatchObject({ tier: "team", status: "active" });
  });

  it("an active org plan beats the user's own lapsed row", async () => {
    mockSupabase({}, {
      "workos:user_01": [{ tier: "pro", status: "canceled" }],
      "workos-org:org_9": [{ tier: "team", status: "active" }],
    });
    const res = await worker.fetch(get("/entitlements", { Authorization: `Bearer ${await token({})}` }), ssoEnv);
    expect(await entitlementOf(res)).toMatchObject({ tier: "team" });
  });

  it("rejects a forged, expired or wrong-audience SSO token with 401", async () => {
    mockSupabase({}, { "workos:user_01": [{ tier: "pro", status: "active" }] });
    for (const bad of [
      await token({}, "another-secret-another-secret-xx"),
      await token({ exp: now() - 1 }),
      await token({ aud: "something-else" }),
    ]) {
      const res = await worker.fetch(get("/entitlements", { Authorization: `Bearer ${bad}` }), ssoEnv);
      expect(res.status).toBe(401);
    }
  });

  it("ignores SSO tokens when SSO_TOKEN_SECRET isn't configured (falls back to Supabase → 401)", async () => {
    mockSupabase({}, {});
    const res = await worker.fetch(get("/entitlements", { Authorization: `Bearer ${await token({})}` }), env);
    expect(res.status).toBe(401);
  });

  it("verifySsoBillingToken returns null for non-SSO JWTs so Supabase tokens still work", async () => {
    const supabaseLike = await signJwt({ iss: "supabase", sub: "u", exp: now() + 60 }, "x");
    expect(await verifySsoBillingToken(supabaseLike, SECRET)).toBeNull();
    expect(await verifySsoBillingToken("not-a-jwt", SECRET)).toBeNull();
  });

  it("an active org plan beats a personal past_due row (past_due doesn't unlock anything)", async () => {
    mockSupabase({}, {
      "workos:user_01": [{ tier: "pro", status: "past_due" }],
      "workos-org:org_9": [{ tier: "team", status: "active" }],
    });
    const res = await worker.fetch(get("/entitlements", { Authorization: `Bearer ${await token({})}` }), ssoEnv);
    expect(await entitlementOf(res)).toMatchObject({ tier: "team", status: "active" });
  });
});
