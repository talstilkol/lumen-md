/**
 * Lumen billing edge worker (Cloudflare).
 *
 * Three endpoints:
 *
 *   POST /checkout — create a Stripe Checkout Session for the signed-in
 *                    user. Body: { priceId, successUrl, cancelUrl }. Returns
 *                    { url } the browser redirects to.
 *
 *   POST /portal   — create a Stripe Billing Portal Session so the user can
 *                    update payment method / cancel.
 *
 *   POST /webhook  — Stripe webhook receiver. Persists subscription state
 *                    into a Supabase row keyed by Stripe customer id. The
 *                    web app reads `entitlements.stripe.{customer}` via the
 *                    Supabase client.
 *
 * Configure secrets via `wrangler secret put`:
 *   - STRIPE_SECRET_KEY        — sk_live_… or sk_test_…
 *   - STRIPE_WEBHOOK_SECRET    — whsec_…
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE
 *
 * Deploy with:
 *   cd edge-workers/billing && wrangler deploy
 */

interface Env {
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE: string;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    try {
      switch (url.pathname) {
        case "/checkout":  return json(await checkout(req, env));
        case "/portal":    return json(await portal(req, env));
        case "/webhook":   return webhook(req, env);
        default:           return new Response("Not found", { status: 404 });
      }
    } catch (err) {
      return new Response(`${(err as Error).message}`, { status: 400, headers: CORS });
    }
  },
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

/** Decode the bearer token to get the Supabase user id. */
async function userId(req: Request, env: Env): Promise<string> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) throw new Error("Missing bearer token");
  const jwt = auth.slice(7);
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: env.SUPABASE_SERVICE_ROLE },
  });
  if (!res.ok) throw new Error("Invalid token");
  const u = (await res.json()) as { id?: string };
  if (!u.id) throw new Error("No user id in token");
  return u.id;
}

/* ─── Stripe REST helpers (no SDK — keeps the worker tiny) ───────────── */

async function stripe<T = unknown>(
  env: Env,
  path: string,
  body: Record<string, string>,
): Promise<T> {
  const form = new URLSearchParams(body).toString();
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${text}`);
  return JSON.parse(text) as T;
}

/* ─── /checkout ──────────────────────────────────────────────────────── */

async function checkout(req: Request, env: Env): Promise<{ url: string }> {
  const uid = await userId(req, env);
  const { priceId, successUrl, cancelUrl } = (await req.json()) as {
    priceId: string;
    successUrl: string;
    cancelUrl: string;
  };
  const session = await stripe<{ url: string; id: string }>(env, "/checkout/sessions", {
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: successUrl,
    cancel_url: cancelUrl,
    "metadata[userId]": uid,
    client_reference_id: uid,
  });
  return { url: session.url };
}

/* ─── /portal ────────────────────────────────────────────────────────── */

async function portal(req: Request, env: Env): Promise<{ url: string }> {
  const uid = await userId(req, env);
  // Look up the customer id from Supabase. We assume the webhook below
  // populated `entitlements` with stripe_customer_id when Checkout completed.
  const customer = await fetchCustomer(env, uid);
  if (!customer) throw new Error("No subscription on file. Subscribe first.");
  const session = await stripe<{ url: string }>(env, "/billing_portal/sessions", {
    customer,
    return_url: req.headers.get("Referer") ?? "https://lumen.app/",
  });
  return { url: session.url };
}

async function fetchCustomer(env: Env, uid: string): Promise<string | null> {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/entitlements?user_id=eq.${uid}&select=stripe_customer_id`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
      },
    },
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as { stripe_customer_id?: string }[];
  return rows[0]?.stripe_customer_id ?? null;
}

/* ─── /webhook ───────────────────────────────────────────────────────── */

async function webhook(req: Request, env: Env): Promise<Response> {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();
  if (!signature) return new Response("Missing signature", { status: 400 });
  const valid = await verifyStripeSig(body, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return new Response("Bad signature", { status: 400 });

  const event = JSON.parse(body) as {
    type: string;
    data: { object: Record<string, unknown> };
  };
  // Persist whatever the event implies. We only handle the subset that
  // affects entitlement status — the full table lives in Stripe.
  if (
    event.type === "checkout.session.completed" ||
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    await upsertEntitlement(env, event.data.object);
  }
  return new Response("ok");
}

async function upsertEntitlement(
  env: Env,
  obj: Record<string, unknown>,
): Promise<void> {
  const uid = (obj.client_reference_id ?? obj.metadata as { userId?: string })?.userId ?? null;
  if (!uid) return;
  await fetch(`${env.SUPABASE_URL}/rest/v1/entitlements`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      user_id: uid,
      tier: obj.metadata && (obj.metadata as { tier?: string }).tier ? (obj.metadata as { tier?: string }).tier : "pro",
      status: obj.status ?? "active",
      stripe_customer_id: obj.customer ?? null,
      stripe_subscription_id: obj.id ?? null,
      renews_at: obj.current_period_end ?? null,
      updated_at: new Date().toISOString(),
    }),
  });
}

/**
 * Minimal Stripe webhook signature verifier — same algorithm as the
 * official SDK without pulling it in. The header is `t=…,v1=…`.
 */
async function verifyStripeSig(
  payload: string,
  header: string,
  secret: string,
): Promise<boolean> {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  const data = `${t}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  const hex = Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
  return hex === v1;
}
