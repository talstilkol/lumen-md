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
  function stub() {
    const calls: { url: string; body: URLSearchParams }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: "u1" }), { status: 200 });
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
