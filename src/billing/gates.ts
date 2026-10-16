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

/**
 * True once the plan is actually known: gates aren't enforced, or the last
 * entitlement refresh finished successfully. While loading (or after a
 * failed refresh) the capabilities read FREE_CAPS only as a placeholder.
 */
export function entitlementResolved(): boolean {
  if (!gatesEnforced()) return true;
  const s = useEntitlement.getState();
  return !s.loading && !s.failed;
}

/** React form of `entitlementResolved()`. */
export function useEntitlementResolved(): boolean {
  const resolved = useEntitlement((s) => !s.loading && !s.failed);
  useEntitlement((s) => s.entitlement);
  return gatesEnforced() ? resolved : true;
}

/**
 * Resolve once the plan is known (true) or after `timeoutMs` (false), so a
 * decision that depends on a paid capability isn't taken from the
 * placeholder FREE_CAPS shown while the entitlement is still loading.
 */
export function waitForEntitlement(timeoutMs: number): Promise<boolean> {
  if (entitlementResolved()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(value);
    };
    const unsubscribe = useEntitlement.subscribe(() => {
      if (entitlementResolved()) finish(true);
    });
    const timer = setTimeout(() => finish(false), timeoutMs);
  });
}
