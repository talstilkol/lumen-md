/**
 * Billing primitives — kept tiny and provider-agnostic so we can swap the
 * backend (Stripe / Paddle / LemonSqueezy) without touching feature code.
 *
 * Pricing tiers (from the launch plan):
 *   Free  — 1 device, BM25 search, P2P collab, 100 AI prompts/month.
 *   Pro   — $8/mo: unlimited devices, persistent collab, cloud sync,
 *           Smart search, 1000 AI prompts.
 *   Team  — $16/seat/mo: workspace sharing, admin, audit log.
 */

export type PlanTier = "free" | "pro" | "team";

export interface Entitlement {
  tier: PlanTier;
  status: "active" | "past_due" | "canceled" | "trialing" | "none";
  /** Seconds since epoch — when the current period ends. */
  renewsAt?: number;
  /** Provider-specific subscription id. */
  subscriptionId?: string;
}

/** Feature flags derived from the entitlement. Single source of truth. */
export interface Capabilities {
  smartSearch: boolean;
  persistentCollab: boolean;
  cloudSync: boolean;
  aiMonthlyPrompts: number;
  unlimitedDevices: boolean;
  workspaceSharing: boolean;
  auditLog: boolean;
}

export const FREE_CAPS: Capabilities = {
  smartSearch: false,
  persistentCollab: false,
  cloudSync: false,
  aiMonthlyPrompts: 100,
  unlimitedDevices: false,
  workspaceSharing: false,
  auditLog: false,
};

export const PRO_CAPS: Capabilities = {
  smartSearch: true,
  persistentCollab: true,
  cloudSync: true,
  aiMonthlyPrompts: 1000,
  unlimitedDevices: true,
  workspaceSharing: false,
  auditLog: false,
};

export const TEAM_CAPS: Capabilities = {
  ...PRO_CAPS,
  workspaceSharing: true,
  auditLog: true,
};

export function capabilitiesFor(ent: Entitlement | null): Capabilities {
  if (!ent || ent.status !== "active" && ent.status !== "trialing") return FREE_CAPS;
  if (ent.tier === "team") return TEAM_CAPS;
  if (ent.tier === "pro") return PRO_CAPS;
  return FREE_CAPS;
}
