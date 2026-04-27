/**
 * Stripe checkout launcher.
 *
 * The browser never sees a Stripe secret key — we POST to a server endpoint
 * that creates a Checkout Session and returns its URL, then redirect.
 *
 * The endpoint is a tiny Edge function (Cloudflare Worker / Vercel /
 * Supabase Edge Function) that:
 *   1. Reads the bearer token (from `Authorization: Bearer <jwt>`).
 *   2. Verifies the user is who they say they are.
 *   3. Calls `stripe.checkout.sessions.create({ ... })` with the price id.
 *   4. Returns `{ url }`.
 *
 * Wire it via `VITE_BILLING_ENDPOINT=https://your-edge.example.com/checkout`.
 */

import type { PlanTier } from "./types";

const PRICE_IDS: Record<Exclude<PlanTier, "free">, string> = {
  pro: "price_pro_placeholder",
  team: "price_team_placeholder",
};

function endpoint(): string {
  const env = (
    import.meta as ImportMeta & { env?: { VITE_BILLING_ENDPOINT?: string } }
  ).env?.VITE_BILLING_ENDPOINT;
  if (!env) throw new Error("VITE_BILLING_ENDPOINT is not set — billing offline.");
  return env;
}

export async function startCheckout(tier: Exclude<PlanTier, "free">, jwt: string | null): Promise<void> {
  if (!jwt) throw new Error("Sign in first to subscribe.");
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      priceId: PRICE_IDS[tier],
      successUrl: `${location.origin}/billing/success`,
      cancelUrl: `${location.origin}/billing/cancel`,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Checkout failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const { url } = (await res.json()) as { url: string };
  location.assign(url);
}

export async function openBillingPortal(jwt: string | null): Promise<void> {
  if (!jwt) throw new Error("Sign in first to manage billing.");
  const res = await fetch(`${endpoint().replace(/\/checkout$/, "")}/portal`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) throw new Error(`Portal failed (${res.status})`);
  const { url } = (await res.json()) as { url: string };
  location.assign(url);
}
