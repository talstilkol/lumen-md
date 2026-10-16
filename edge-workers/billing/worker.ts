/**
 * Lumen billing edge worker (Cloudflare).
 *
 * Endpoints:
 *
 *   GET  /entitlements — the signed-in user's plan, read from the Supabase
 *                    `entitlements` table. Auth: `Authorization: Bearer
 *                    <supabase access token>`. Response:
 *                    { entitlement: { tier, status, renewsAt?, subscriptionId? } }
 *                    — the shape `src/billing/useEntitlement.ts` parses.
 *                    No token / no row / unknown status → free tier.
 *                    The client fetches with `credentials: "include"`, so
 *                    this route answers with a credentialed CORS header for
 *                    origins listed in ALLOWED_ORIGIN (never `*`).
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
 *   - STRIPE_PRICE_PRO / STRIPE_PRICE_TEAM — sellable price ids per tier
 *                                (comma-separated); /checkout rejects others
 *   - SSO_TOKEN_SECRET         — optional; same value as the SSO worker's
 *                                BILLING_TOKEN_SECRET. Lets WorkOS/SSO users
 *                                (who have no Supabase token) authenticate
 *                                with the short-lived token from
 *                                `GET /api/sso/token`. Their rows are keyed
 *                                `workos:<user id>`, with an org-wide
 *                                fallback row `workos-org:<organization id>`.
 *
 * Deploy with:
 *   cd edge-workers/billing && wrangler deploy
 */

export interface Env {
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE: string;
  /** Comma-separated list of web origins allowed to make credentialed calls. */
  ALLOWED_ORIGIN?: string;
  /** HS256 secret shared with the SSO worker (its BILLING_TOKEN_SECRET). */
  SSO_TOKEN_SECRET?: string;
  /**
   * Stripe price ids that may be bought, comma-separated per tier (the
   * same values as the client's VITE_PRICE_ID_PRO / VITE_PRICE_ID_TEAM).
   * /checkout refuses any other price, and the tier is derived from here —
   * never taken from the request.
   */
  STRIPE_PRICE_PRO?: string;
  STRIPE_PRICE_TEAM?: string;
}

type PaidTier = "pro" | "team";

/** The tier a Stripe price id grants, or null when it isn't on the allowlist. */
export function tierForPrice(env: Env, priceId: unknown): PaidTier | null {
  if (typeof priceId !== "string" || !priceId) return null;
  const list = (v?: string) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (list(env.STRIPE_PRICE_TEAM).includes(priceId)) return "team";
  if (list(env.STRIPE_PRICE_PRO).includes(priceId)) return "pro";
  return null;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

/**
 * CORS headers for a specific request. When the caller's Origin is in
 * ALLOWED_ORIGIN we echo it back and allow credentials (required because
 * the entitlement client uses `credentials: "include"`, which browsers
 * reject against a `*` origin). Otherwise fall back to the public `*`.
 */
export function corsFor(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGIN ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (origin && allowed.includes(origin)) {
    return {
      ...CORS,
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    };
  }
  return { ...CORS, Vary: "Origin" };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsFor(req, env) });
    const url = new URL(req.url);
    try {
      switch (url.pathname) {
        case "/entitlements":
          if (req.method !== "GET") {
            return new Response("Method not allowed", {
              status: 405,
              headers: { ...corsFor(req, env), Allow: "GET, OPTIONS" },
            });
          }
          return entitlements(req, env);
        case "/checkout":  return json(await checkout(req, env), req, env);
        case "/portal":    return json(await portal(req, env), req, env);
        case "/webhook":   return await webhook(req, env);
        default:           return new Response("Not found", { status: 404 });
      }
    } catch (err) {
      return new Response(`${(err as Error).message}`, { status: 400, headers: corsFor(req, env) });
    }
  },
};

function json(body: unknown, req: Request, env: Env): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", ...corsFor(req, env) },
  });
}

/* ─── Caller identity ───────────────────────────────────────────────── */

/** Issuer / audience of the billing tokens minted by the SSO worker. */
export const SSO_TOKEN_ISS = "lumen-sso";
export const SSO_TOKEN_AUD = "lumen-billing";

interface Identity {
  /** Key of the caller's own `entitlements` row. */
  uid: string;
  /** Org-wide fallback row (SSO users), e.g. an enterprise contract. */
  orgUid?: string;
}

const te = new TextEncoder();

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/**
 * Verify an HS256 billing token from the SSO worker. Returns null for
 * anything that isn't one (so the caller can fall back to Supabase) and
 * throws for one that claims to be ours but fails verification.
 */
export async function verifySsoBillingToken(
  token: string,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<Identity | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let head: { alg?: unknown };
  let payload: { iss?: unknown; aud?: unknown; sub?: unknown; org?: unknown; exp?: unknown };
  try {
    head = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch {
    return null;
  }
  if (head.alg !== "HS256" || payload.iss !== SSO_TOKEN_ISS) return null;
  const key = await crypto.subtle.importKey("raw", te.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", key, b64urlToBytes(parts[2]), te.encode(`${parts[0]}.${parts[1]}`));
  } catch {
    ok = false;
  }
  if (!ok) throw new Error("Invalid token");
  if (payload.aud !== SSO_TOKEN_AUD) throw new Error("Invalid token");
  if (typeof payload.exp !== "number" || payload.exp <= nowSec) throw new Error("Token expired");
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("No user id in token");
  return {
    uid: `workos:${payload.sub}`,
    ...(typeof payload.org === "string" && payload.org ? { orgUid: `workos-org:${payload.org}` } : {}),
  };
}

/** Resolve the caller from the bearer token: an SSO billing token or a Supabase JWT. */
async function identify(req: Request, env: Env): Promise<Identity> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) throw new Error("Missing bearer token");
  const jwt = auth.slice(7);
  if (env.SSO_TOKEN_SECRET) {
    const sso = await verifySsoBillingToken(jwt, env.SSO_TOKEN_SECRET);
    if (sso) return sso;
  }
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: env.SUPABASE_SERVICE_ROLE },
  });
  if (!res.ok) throw new Error("Invalid token");
  const u = (await res.json()) as { id?: string };
  if (!u.id) throw new Error("No user id in token");
  return { uid: u.id };
}

async function userId(req: Request, env: Env): Promise<string> {
  return (await identify(req, env)).uid;
}

/* ─── GET /entitlements ──────────────────────────────────────────────── */

type Tier = "free" | "pro" | "team";
type Status = "active" | "past_due" | "canceled" | "trialing" | "none";

export interface EntitlementBody {
  tier: Tier;
  status: Status;
  renewsAt?: number;
  subscriptionId?: string;
}

const FREE: EntitlementBody = { tier: "free", status: "none" };

/**
 * Map whatever the webhook stored (raw Stripe subscription / checkout
 * status) onto the client's closed status set. Anything we don't
 * recognise becomes "none", which the client treats as free.
 */
function normalizeStatus(raw: unknown): Status {
  switch (raw) {
    case "active":
    case "trialing":
    case "past_due":
    case "canceled":
      return raw;
    case "complete": // legacy rows written from a completed Checkout Session
      return "active";
    case "unpaid":
      return "past_due";
    default:
      return "none";
  }
}

function normalizeTier(raw: unknown): Tier {
  return raw === "pro" || raw === "team" ? raw : "free";
}

async function entitlements(req: Request, env: Env): Promise<Response> {
  const headers = {
    ...corsFor(req, env),
    "Content-Type": "application/json",
    // Per-user answer — never let a shared cache hold it.
    "Cache-Control": "private, no-store",
    Vary: "Origin, Authorization",
  };
  const send = (entitlement: EntitlementBody, status = 200) =>
    new Response(JSON.stringify({ entitlement }), { status, headers });

  // Anonymous callers are simply on the free plan.
  if (!req.headers.get("Authorization")) return send(FREE);

  let who: Identity;
  try {
    who = await identify(req, env);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers });
  }

  // The caller's own row first; SSO users fall back to their org's row.
  const ids = [who.uid, ...(who.orgUid ? [who.orgUid] : [])];
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/entitlements?user_id=in.(${ids.map((i) => `"${encodeURIComponent(i)}"`).join(",")})` +
      `&select=user_id,tier,status,renews_at,stripe_subscription_id`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
        Accept: "application/json",
      },
    },
  );
  if (!res.ok) {
    return new Response(JSON.stringify({ error: "Entitlement lookup failed" }), {
      status: 502,
      headers,
    });
  }
  const found = (await res.json()) as {
    user_id?: unknown;
    tier?: unknown;
    status?: unknown;
    renews_at?: unknown;
    stripe_subscription_id?: unknown;
  }[];
  const rows = ids.map((id) => found.find((r) => r.user_id === id)).filter((r) => r !== undefined);
  // An active plan on the user's own row wins; otherwise an active org-wide
  // plan; otherwise whatever (lapsed) row exists.
  // Only statuses that actually unlock capabilities on the client count as
  // live (`capabilitiesFor` treats past_due/canceled/none as free).
  const live = (r: (typeof rows)[number]) => {
    const st = normalizeStatus(r.status);
    return st === "active" || st === "trialing";
  };
  const row = rows.find(live) ?? rows[0];
  if (!row) return send(FREE);

  const body: EntitlementBody = {
    tier: normalizeTier(row.tier),
    status: normalizeStatus(row.status),
  };
  const renews = typeof row.renews_at === "string" ? Number(row.renews_at) : row.renews_at;
  if (typeof renews === "number" && Number.isFinite(renews)) body.renewsAt = renews;
  if (typeof row.stripe_subscription_id === "string") body.subscriptionId = row.stripe_subscription_id;
  return send(body);
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
  // The price comes from the browser: only sell prices on the server-side
  // allowlist, and derive the tier from it (never trust a client tier).
  const tier = tierForPrice(env, priceId);
  if (!tier) throw new Error("Unknown price");
  // Stripe redirects back to these; keep them on our own origins.
  for (const u of [successUrl, cancelUrl]) {
    if (!isAllowedRedirect(env, u)) throw new Error("Redirect URL not allowed");
  }
  const session = await stripe<{ url: string; id: string }>(env, "/checkout/sessions", {
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: successUrl,
    cancel_url: cancelUrl,
    "metadata[userId]": uid,
    "metadata[tier]": tier,
    // Copied onto the Subscription so customer.subscription.* webhooks
    // can be attributed to the user (and plan) too.
    "subscription_data[metadata][userId]": uid,
    "subscription_data[metadata][tier]": tier,
    client_reference_id: uid,
  });
  return { url: session.url };
}

/** http(s) URL on one of ALLOWED_ORIGIN's origins (any origin when unset, for dev). */
function isAllowedRedirect(env: Env, url: unknown): boolean {
  if (typeof url !== "string") return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const allowed = (env.ALLOWED_ORIGIN ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  return allowed.length === 0 || allowed.includes(u.origin);
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
    `${env.SUPABASE_URL}/rest/v1/entitlements?user_id=eq.${encodeURIComponent(uid)}&select=stripe_customer_id`,
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
  const update = entitlementFromEvent(env, event);
  if (!update) return new Response("ok");
  try {
    // Stripe doesn't deliver events in order: an old `subscription.updated`
    // (active) can arrive after `subscription.deleted`. The event only says
    // WHICH subscription changed — its current state comes from Stripe.
    const row = await withCurrentSubscriptionState(env, update);
    await upsertEntitlement(env, row);
  } catch (err) {
    // Non-2xx makes Stripe retry the delivery instead of dropping it.
    return new Response(`Webhook not persisted: ${(err as Error).message}`, { status: 500 });
  }
  return new Response("ok");
}

/**
 * Replace the status / renewal / tier implied by the event with the
 * subscription's CURRENT state, fetched from Stripe. Events without a
 * subscription (one-off payments) are applied as-is. A subscription Stripe
 * no longer knows is treated as canceled.
 */
export async function withCurrentSubscriptionState(
  env: Env,
  update: EntitlementUpdate,
): Promise<EntitlementUpdate> {
  const id = update.stripe_subscription_id;
  if (!id) return update;
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  if (res.status === 404) return { ...update, status: "canceled" };
  if (!res.ok) throw new Error(`Stripe ${res.status} reading subscription`);
  const sub = (await res.json()) as {
    status?: unknown;
    current_period_end?: unknown;
    metadata?: { tier?: unknown };
    items?: { data?: Array<{ price?: { id?: unknown } }> };
  };
  // An unpaid async checkout must not be upgraded by a subscription that is
  // still "incomplete"/"active" pending that payment — keep the denial.
  const status = update.status === "unpaid" ? "unpaid" : String(sub.status ?? update.status);
  const metaTier = sub.metadata?.tier === "pro" || sub.metadata?.tier === "team" ? sub.metadata.tier : null;
  const tier =
    metaTier ?? (sub.items?.data ?? []).map((i) => tierForPrice(env, i.price?.id)).find((x) => x) ?? update.tier;
  const end = sub.current_period_end;
  return {
    ...update,
    status,
    ...(tier ? { tier } : {}),
    renews_at: typeof end === "number" ? end : (update.renews_at ?? null),
  };
}

export interface EntitlementUpdate {
  user_id: string;
  status: string;
  /** Omitted when it can't be derived, so an upsert keeps the stored tier. */
  tier?: PaidTier;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  renews_at?: number | null;
}

/**
 * Map a (signature-verified) Stripe event to the entitlement row it implies,
 * or null for events that don't change access. Rules:
 *  - Checkout grants access only once paid: `checkout.session.completed`
 *    with payment_status "paid"/"no_payment_required", or
 *    `checkout.session.async_payment_succeeded` for delayed methods;
 *    `…async_payment_failed` records "unpaid" (= no access).
 *  - Subscription events carry Stripe's own status (active, trialing,
 *    past_due, canceled, …); deletion is "canceled".
 *  - The tier comes from metadata stamped by /checkout, else from the
 *    subscription's price via the allowlist — never defaults to a paid plan.
 */
export function entitlementFromEvent(
  env: Env,
  event: { type: string; data: { object: Record<string, unknown> } },
): EntitlementUpdate | null {
  const obj = event.data.object;
  const meta = (obj.metadata ?? {}) as { userId?: unknown; tier?: unknown };
  const uid =
    (typeof obj.client_reference_id === "string" && obj.client_reference_id) ||
    (typeof meta.userId === "string" && meta.userId) ||
    null;
  if (!uid) return null;
  const metaTier = meta.tier === "pro" || meta.tier === "team" ? meta.tier : null;
  const customer = typeof obj.customer === "string" ? obj.customer : null;

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
    case "checkout.session.async_payment_failed": {
      const paid = obj.payment_status === "paid" || obj.payment_status === "no_payment_required";
      if (event.type === "checkout.session.completed" && !paid) return null; // wait for async result
      const ok = event.type !== "checkout.session.async_payment_failed" && paid;
      return {
        user_id: uid,
        status: ok ? "active" : "unpaid",
        ...(metaTier ? { tier: metaTier } : {}),
        stripe_customer_id: customer,
        stripe_subscription_id: typeof obj.subscription === "string" ? obj.subscription : null,
      };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const items = (obj.items as { data?: Array<{ price?: { id?: unknown } }> } | undefined)?.data ?? [];
      const tier = metaTier ?? items.map((i) => tierForPrice(env, i.price?.id)).find((x) => x) ?? null;
      const end = obj.current_period_end;
      return {
        user_id: uid,
        status: event.type === "customer.subscription.deleted" ? "canceled" : String(obj.status ?? "incomplete"),
        ...(tier ? { tier } : {}),
        stripe_customer_id: customer,
        stripe_subscription_id: typeof obj.id === "string" ? obj.id : null,
        renews_at: typeof end === "number" ? end : null,
      };
    }
    default:
      return null;
  }
}

async function upsertEntitlement(env: Env, row: EntitlementUpdate): Promise<void> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/entitlements`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
  });
  // fetch() resolves on 4xx/5xx — a failed write must not be acknowledged.
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
}

/**
 * Minimal Stripe webhook signature verifier — same algorithm as the
 * official SDK without pulling it in. The header is `t=…,v1=…`.
 */
/** Max age of a webhook signature (Stripe's recommended replay window). */
const STRIPE_SIG_TOLERANCE_S = 300;

export async function verifyStripeSig(
  payload: string,
  header: string,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  let t = "";
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1") v1.push(v);
  }
  if (!t || v1.length === 0) return false;
  const ts = Number(t);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > STRIPE_SIG_TOLERANCE_S) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`)));
  const hex = Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
  // Constant-time compare against each provided v1 (Stripe may send several).
  return v1.some((cand) => {
    if (cand.length !== hex.length) return false;
    let diff = 0;
    for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ cand.charCodeAt(i);
    return diff === 0;
  });
}
