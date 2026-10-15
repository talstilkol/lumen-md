/**
 * Feature gates (MASTER_PLAN β.3.6 / TASKS β.3.7).
 *
 * `Capabilities` (types.ts) says what a plan includes; this module decides
 * whether those limits are *enforced* at all:
 *
 *   - Billing backend configured (VITE_ENTITLEMENT_ENDPOINT set to a real
 *     URL) → enforce the capabilities from `useEntitlement`.
 *   - Dev/QA tier shim set (`localStorage["lumen.dev.tier"]`) → enforce too,
 *     so the free/pro/team experience can be tested locally.
 *   - Otherwise (self-hosted, dev, on-prem) → everything is unlocked. A
 *     self-hoster who never wired billing must never hit an upgrade wall.
 *
 * Feature code reads `useCapability("auditLog")` in React or
 * `effectiveCapabilities()` outside it — never `capabilities` directly.
 */

import type { Capabilities } from "./types";
import { useEntitlement, isBillingConfigured, hasDevTierOverride } from "./useEntitlement";

/** Capabilities when no billing is enforced: every flag on, no AI cap. */
export const UNLOCKED_CAPS: Readonly<Capabilities> = Object.freeze({
  smartSearch: true,
  persistentCollab: true,
  cloudSync: true,
  aiMonthlyPrompts: Number.POSITIVE_INFINITY,
  unlimitedDevices: true,
  workspaceSharing: true,
  auditLog: true,
});

/** True when plan limits apply (billing configured or dev tier shim set). */
export function gatesEnforced(): boolean {
  return isBillingConfigured() || hasDevTierOverride();
}

/** Capabilities feature code should honour right now. */
export function effectiveCapabilities(): Capabilities {
  return gatesEnforced() ? useEntitlement.getState().capabilities : { ...UNLOCKED_CAPS };
}

/** React hook — re-renders when the entitlement changes. */
export function useCapability<K extends keyof Capabilities>(key: K): Capabilities[K] {
  const value = useEntitlement((s) => s.capabilities[key]);
  // Subscribe to the entitlement too: `setLocal()` flips the dev shim and
  // with it `gatesEnforced()`, which isn't itself reactive.
  useEntitlement((s) => s.entitlement);
  return gatesEnforced() ? value : UNLOCKED_CAPS[key];
}
