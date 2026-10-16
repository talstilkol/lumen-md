// @vitest-environment node
/**
 * Billing worker: /checkout sells only allow-listed prices (tier derived
 * server-side) and webhooks grant access only once payment is confirmed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import worker, {
  type Env,
  tierForPrice,
  entitlementFromEvent,
  verifyStripeSig,
} from "../../edge-workers/billing/worker";

const env: Env = {
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_test",
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SERVICE_ROLE: "svc",
  ALLOWED_ORIGIN: "https://lumen.app",
  STRIPE_PRICE_PRO: "price_pro_m, price_pro_y",
  STRIPE_PRICE_TEAM: "price_team_m",
};

afterEach(() => vi.unstubAllGlobals());

describe("tierForPrice", () => {
  it("maps allow-listed prices and rejects everything else", () => {
    expect(tierForPrice(env, "price_pro_y")).toBe("pro");
    expect(tierForPrice(env, "price_team_m")).toBe("team");
    expect(tierForPrice(env, "price_cheap_other")).toBeNull();
    expect(tierForPrice(env, undefined)).toBeNull();
  });
});

describe("POST /checkout", () => {
  function stub(rows: unknown[] = []) {
    const calls: { url: string; body: URLSearchParams }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: "u1" }), { status: 200 });
        if (url.includes("/rest/v1/entitlements")) return new Response(JSON.stringify(rows), { status: 200 });
        calls.push({ url, body: new URLSearchParams(String(init?.body ?? "")) });
        return new Response(JSON.stringify({ url: "https://checkout.stripe.com/x", id: "cs_1" }), { status: 200 });
      }),
    );
    return calls;
  }
  const post = (body: unknown) =>
    new Request("https://billing.test/checkout", {
      method: "POST",
      headers: { Authorization: "Bearer jwt", "Content-Type": "application/json", Origin: "https://lumen.app" },
      body: JSON.stringify(body),
    });

  it("stamps the server-derived tier on the session and the subscription", async () => {
    const calls = stub();
    const res = await worker.fetch(
      post({ priceId: "price_team_m", successUrl: "https://lumen.app/ok", cancelUrl: "https://lumen.app/no" }),
      env,
    );
    expect(res.status).toBe(200);
    const b = calls[0].body;
    expect(b.get("metadata[tier]")).toBe("team");
    expect(b.get("subscription_data[metadata][tier]")).toBe("team");
  });

  const okBody = { priceId: "price_pro_m", successUrl: "https://lumen.app/ok", cancelUrl: "https://lumen.app/no" };

  it("reuses the user's existing Stripe customer instead of creating a new one", async () => {
    const calls = stub([{ stripe_customer_id: "cus_old", status: "canceled" }]);
    const res = await worker.fetch(post(okBody), env);
    expect(res.status).toBe(200);
    expect(calls[0].body.get("customer")).toBe("cus_old");
  });

  it("omits customer for a first-time subscriber", async () => {
    const calls = stub([]);
    await worker.fetch(post(okBody), env);
    expect(calls[0].body.has("customer")).toBe(false);
  });

  it("refuses a second subscription while one is still billing", async () => {
    for (const status of ["active", "trialing", "past_due"]) {
      const calls = stub([{ stripe_customer_id: "cus_1", status }]);
      const res = await worker.fetch(post(okBody), env);
      expect(res.status).toBe(400);
      expect(await res.text()).toMatch(/Already subscribed/);
      expect(calls).toHaveLength(0);
    }
  });

  it("refuses prices that aren't allow-listed and off-site redirect URLs", async () => {
    const calls = stub();
    let res = await worker.fetch(
      post({ priceId: "price_cheap_other", successUrl: "https://lumen.app/ok", cancelUrl: "https://lumen.app/no" }),
      env,
    );
    expect(res.status).toBe(400);
    res = await worker.fetch(
      post({ priceId: "price_pro_m", successUrl: "https://evil.test/ok", cancelUrl: "https://lumen.app/no" }),
      env,
    );
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("entitlementFromEvent", () => {
  const ev = (type: string, object: Record<string, unknown>) => ({ type, data: { object } });
  const session = { client_reference_id: "u1", customer: "cus_1", subscription: "sub_1", metadata: { tier: "team" } };

  it("grants access only for a paid Checkout Session", () => {
    expect(entitlementFromEvent(env, ev("checkout.session.completed", { ...session, payment_status: "unpaid" }))).toBeNull();
    expect(entitlementFromEvent(env, ev("checkout.session.completed", { ...session, payment_status: "paid" }))).toMatchObject({
      user_id: "u1",
      status: "active",
      tier: "team",
      stripe_subscription_id: "sub_1",
    });
  });

  it("handles delayed payments via async_payment_succeeded / _failed", () => {
    expect(
      entitlementFromEvent(env, ev("checkout.session.async_payment_succeeded", { ...session, payment_status: "paid" })),
    ).toMatchObject({ status: "active" });
    expect(
      entitlementFromEvent(env, ev("checkout.session.async_payment_failed", { ...session, payment_status: "unpaid" })),
    ).toMatchObject({ status: "unpaid" });
  });

  it("derives the tier from the subscription's price, never defaulting to a paid plan", () => {
    const sub = (price: string) => ({
      id: "sub_1",
      status: "active",
      customer: "cus_1",
      metadata: { userId: "u1" },
      items: { data: [{ price: { id: price } }] },
      current_period_end: 1_800_000_000,
    });
    expect(entitlementFromEvent(env, ev("customer.subscription.updated", sub("price_team_m")))).toMatchObject({ tier: "team" });
    const unknown = entitlementFromEvent(env, ev("customer.subscription.updated", sub("price_unknown")))!;
    expect(unknown).not.toHaveProperty("tier");
    expect(entitlementFromEvent(env, ev("customer.subscription.deleted", sub("price_pro_m")))).toMatchObject({ status: "canceled" });
  });
});

describe("verifyStripeSig", () => {
  async function sign(payload: string, t: number, secret = env.STRIPE_WEBHOOK_SECRET) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`)));
    return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  it("accepts a fresh signature (any of several v1) and rejects stale or wrong ones", async () => {
    const now = 1_800_000_000;
    const good = await sign("{}", now);
    expect(await verifyStripeSig("{}", `t=${now},v1=deadbeef,v1=${good}`, env.STRIPE_WEBHOOK_SECRET, now)).toBe(true);
    expect(await verifyStripeSig("{}", `t=${now},v1=${good}`, env.STRIPE_WEBHOOK_SECRET, now + 301)).toBe(false);
    expect(await verifyStripeSig("{x}", `t=${now},v1=${good}`, env.STRIPE_WEBHOOK_SECRET, now)).toBe(false);
  });
});

describe("POST /webhook persistence", () => {
  async function signedRequest(event: unknown) {
    const payload = JSON.stringify(event);
    const t = Math.floor(Date.now() / 1000);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`)));
    const v1 = Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
    return new Request("https://billing.test/webhook", {
      method: "POST",
      headers: { "stripe-signature": `t=${t},v1=${v1}` },
      body: payload,
    });
  }
  const staleUpdated = {
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_1",
        status: "active",
        customer: "cus_1",
        metadata: { userId: "u1", tier: "pro" },
        items: { data: [{ price: { id: "price_pro_m" } }] },
        current_period_end: 1_800_000_000,
      },
    },
  };
  function stub(opts: { subStatus?: number; sub?: unknown; supabase?: number; stored?: unknown[] }) {
    const writes: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("https://api.stripe.com/v1/subscriptions/")) {
          return new Response(JSON.stringify(opts.sub ?? {}), { status: opts.subStatus ?? 200 });
        }
        if ((init?.method ?? "GET") === "GET" && url.includes("/rest/v1/entitlements")) {
          return new Response(JSON.stringify(opts.stored ?? []), { status: 200 });
        }
        writes.push(JSON.parse(String(init?.body)));
        return new Response("", { status: opts.supabase ?? 201 });
      }),
    );
    return writes;
  }

  it("applies the subscription's CURRENT state, so a late stale event can't revive a canceled plan", async () => {
    const writes = stub({ sub: { id: "sub_1", status: "canceled", metadata: { tier: "pro" }, current_period_end: 1_800_000_000 } });
    const res = await worker.fetch(await signedRequest(staleUpdated), env);
    expect(res.status).toBe(200);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ user_id: "u1", status: "canceled", tier: "pro" });
  });

  it("ignores a late event for a canceled subscription the user has since replaced", async () => {
    const writes = stub({
      sub: { id: "sub_1", status: "canceled", metadata: { tier: "pro" } },
      stored: [{ stripe_customer_id: "cus_1", stripe_subscription_id: "sub_2", status: "active" }],
    });
    const res = await worker.fetch(await signedRequest(staleUpdated), env);
    expect(res.status).toBe(200);
    expect(writes).toHaveLength(0);
  });

  it("applies a live replacement subscription over the stored canceled one", async () => {
    const writes = stub({
      sub: { id: "sub_1", status: "active", metadata: { tier: "pro" } },
      stored: [{ stripe_customer_id: "cus_1", stripe_subscription_id: "sub_0", status: "canceled" }],
    });
    await worker.fetch(await signedRequest(staleUpdated), env);
    expect(writes[0]).toMatchObject({ stripe_subscription_id: "sub_1", status: "active" });
  });

  it("treats a subscription Stripe no longer knows as canceled", async () => {
    const writes = stub({ subStatus: 404 });
    await worker.fetch(await signedRequest(staleUpdated), env);
    expect(writes[0]).toMatchObject({ status: "canceled" });
  });

  it("returns 500 (so Stripe retries) when the entitlement write fails", async () => {
    stub({ sub: { status: "active" }, supabase: 503 });
    const res = await worker.fetch(await signedRequest(staleUpdated), env);
    expect(res.status).toBe(500);
  });

  it("returns 500 without writing when Stripe can't be reached", async () => {
    const writes = stub({ subStatus: 502 });
    const res = await worker.fetch(await signedRequest(staleUpdated), env);
    expect(res.status).toBe(500);
    expect(writes).toHaveLength(0);
  });
});

describe("Team plans bought by SSO organization members", () => {
  const SECRET = "billing-token-secret-0123456789abcdef";
  const ssoEnv: Env = { ...env, SSO_TOKEN_SECRET: SECRET };
  async function ssoBearer() {
    const { signJwt } = await import("../../edge-workers/auth/worker");
    const { SSO_TOKEN_ISS, SSO_TOKEN_AUD } = await import("../../edge-workers/shared/ssoToken");
    const now = Math.floor(Date.now() / 1000);
    return signJwt({ iss: SSO_TOKEN_ISS, aud: SSO_TOKEN_AUD, sub: "user_01", org: "org_9", iat: now, exp: now + 300 }, SECRET);
  }
  function stub(rows: Record<string, unknown[]> = {}, sub: unknown = {}) {
    const stripeCalls: { url: string; body: URLSearchParams }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/rest/v1/entitlements")) {
          const id = decodeURIComponent(new URL(url).searchParams.get("user_id")!.replace(/^eq\./, ""));
          return new Response(JSON.stringify(rows[id] ?? []), { status: 200 });
        }
        if (url.startsWith("https://api.stripe.com/v1/subscriptions/")) return new Response(JSON.stringify(sub), { status: 200 });
        stripeCalls.push({ url, body: new URLSearchParams(String(init?.body ?? "")) });
        return new Response(JSON.stringify({ url: "https://stripe.test/x", id: "cs_1" }), { status: 200 });
      }),
    );
    return stripeCalls;
  }
  const req = (path: string, token: string, body?: unknown) =>
    new Request(`https://billing.test${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Origin: "https://lumen.app" },
      body: JSON.stringify(body ?? {}),
    });

  it("entitles the organization's row for Team, the member's own row for Pro", async () => {
    const tok = await ssoBearer();
    let calls = stub();
    await worker.fetch(req("/checkout", tok, { priceId: "price_team_m", successUrl: "https://lumen.app/ok", cancelUrl: "https://lumen.app/no" }), ssoEnv);
    expect(calls[0].body.get("metadata[userId]")).toBe("workos-org:org_9");
    expect(calls[0].body.get("client_reference_id")).toBe("workos-org:org_9");
    expect(calls[0].body.get("subscription_data[metadata][purchaser]")).toBe("workos:user_01");
    calls = stub();
    await worker.fetch(req("/checkout", tok, { priceId: "price_pro_m", successUrl: "https://lumen.app/ok", cancelUrl: "https://lumen.app/no" }), ssoEnv);
    expect(calls[0].body.get("metadata[userId]")).toBe("workos:user_01");
  });

  it("opens the org's billing portal only for the member who purchased it", async () => {
    const tok = await ssoBearer();
    const orgRow = { "workos-org:org_9": [{ stripe_customer_id: "cus_org", stripe_subscription_id: "sub_org", status: "active" }] };
    let calls = stub(orgRow, { metadata: { purchaser: "workos:user_01" } });
    let res = await worker.fetch(req("/portal", tok), ssoEnv);
    expect(res.status).toBe(200);
    expect(calls[0].body.get("customer")).toBe("cus_org");
    calls = stub(orgRow, { metadata: { purchaser: "workos:someone_else" } });
    res = await worker.fetch(req("/portal", tok), ssoEnv);
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("prefers the org Team plan the caller bought over their personal Pro, with an explicit personal scope", async () => {
    const tok = await ssoBearer();
    const rows = {
      "workos-org:org_9": [{ stripe_customer_id: "cus_org", stripe_subscription_id: "sub_org", status: "active" }],
      "workos:user_01": [{ stripe_customer_id: "cus_me", stripe_subscription_id: "sub_me", status: "active" }],
    };
    let calls = stub(rows, { metadata: { purchaser: "workos:user_01" } });
    await worker.fetch(req("/portal", tok), ssoEnv);
    expect(calls[0].body.get("customer")).toBe("cus_org");
    calls = stub(rows, { metadata: { purchaser: "workos:user_01" } });
    await worker.fetch(req("/portal", tok, { scope: "personal" }), ssoEnv);
    expect(calls[0].body.get("customer")).toBe("cus_me");
    // Someone else's org plan doesn't block the member's own portal.
    calls = stub(rows, { metadata: { purchaser: "workos:other" } });
    await worker.fetch(req("/portal", tok), ssoEnv);
    expect(calls[0].body.get("customer")).toBe("cus_me");
  });
});

describe("a failed async payment after recovery", () => {
  const event = { user_id: "u1", status: "unpaid", tier: "pro" as const, stripe_subscription_id: "sub_1" };
  const stub = (body: object) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));

  it("keeps access when Stripe shows the subscription active with a paid invoice", async () => {
    const { withCurrentSubscriptionState } = await import("../../edge-workers/billing/worker");
    stub({ status: "active", latest_invoice: { status: "paid" }, items: { data: [] } });
    expect((await withCurrentSubscriptionState(env, event)).status).toBe("active");
    stub({ status: "trialing", latest_invoice: { status: "paid" }, items: { data: [] } });
    expect((await withCurrentSubscriptionState(env, event)).status).toBe("trialing");
  });

  it("stays unpaid while the payment is still open or the subscription incomplete", async () => {
    const { withCurrentSubscriptionState } = await import("../../edge-workers/billing/worker");
    for (const body of [
      { status: "active", latest_invoice: { status: "open" } },
      { status: "active", latest_invoice: "in_123" }, // not expanded
      { status: "active" },
      { status: "incomplete", latest_invoice: { status: "paid" } },
    ]) {
      stub({ ...body, items: { data: [] } });
      expect((await withCurrentSubscriptionState(env, event)).status).toBe("unpaid");
    }
  });

  it("asks Stripe for the latest invoice", async () => {
    const { withCurrentSubscriptionState } = await import("../../edge-workers/billing/worker");
    const f = vi.fn(async () => new Response(JSON.stringify({ status: "active" }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    await withCurrentSubscriptionState(env, event);
    expect(String((f.mock.calls[0] as unknown[])[0])).toContain("expand[]=latest_invoice");
  });
});

describe("plan switches in the Billing Portal", () => {
  it("derive the tier from the current price, not the stale Checkout metadata", async () => {
    const { withCurrentSubscriptionState } = await import("../../edge-workers/billing/worker");
    const sub = (price: string) => ({
      id: "sub_1",
      status: "active",
      customer: "cus_1",
      metadata: { userId: "u1", tier: "pro" }, // stamped at Checkout
      items: { data: [{ price: { id: price } }] },
    });
    // Event payload: Pro → Team upgrade.
    expect(entitlementFromEvent(env, { type: "customer.subscription.updated", data: { object: sub("price_team_m") } })).toMatchObject({ tier: "team" });
    // Current-state refresh: Team → Pro downgrade even though metadata says team.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...sub("price_pro_m"), metadata: { tier: "team" } }), { status: 200 })));
    const row = await withCurrentSubscriptionState(env, { user_id: "u1", status: "active", tier: "team", stripe_subscription_id: "sub_1" });
    expect(row.tier).toBe("pro");
  });
});
