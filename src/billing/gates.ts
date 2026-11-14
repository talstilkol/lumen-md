/**
 * Feature gates (MASTER_PLAN β.3.6 / TASKS β.3.7; W11.P12 pricing promise).
 *
 * **The free tier never shrinks.** A gate may only cover a service that runs
 * on a host and costs money to run — the encrypted relay, the persistent
 * collaboration server, workspace sharing, the hosted audit-log worker,
 * hosted publish. Everything that runs on the user's device (search,
 * semantic search, AI with the user's own key or a local model, the number
 * of devices, importers, export, …) is never locked, even when an operator
 * configures a billing backend. `HOSTED_GATES` is the complete list of gates;
 * `src/__tests__/billingGatesHostedOnly.test.ts` enumerates it and fails if a
 * local feature appears in it or is enforced anyway.
 *
 * `Capabilities` (types.ts) says what a plan includes; this module decides
 * whether those limits are *enforced* at all:
 *
 *   - Billing backend configured (VITE_ENTITLEMENT_ENDPOINT set to a real
 *     URL) → enforce the capabilities from `useEntitlement`, for the keys in
 *     `HOSTED_GATES` only.
 *   - Dev/QA tier shim set (`localStorage["lumen.dev.tier"]`) → enforce too,
 *     so the free/pro/team experience can be tested locally.
 *   - Otherwise (self-hosted, dev, on-prem) → everything is unlocked. A
 *     self-hoster who never wired billing must never hit an upgrade wall.
 *
 * Feature code reads `useCapability("cloudSync")` in React or
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

/** The hosted services a gate may cover. Nothing local belongs here. */
export type HostedService =
  | "encrypted-relay"
  | "persistent-collab-server"
  | "workspace-sharing"
  | "audit-log-worker"
  | "hosted-publish";

export interface HostedGate {
  /** Always "host": the service runs on a server someone pays for. */
  readonly runsOn: "host";
  /** Always true: running it costs money per user. */
  readonly costsMoney: true;
  readonly service: HostedService;
  /** One line: what the host does that costs money. */
  readonly why: string;
}

/**
 * Every gate there is. A capability not listed here is never enforced:
 * `effectiveCapabilities()` and `useCapability()` return its unlocked value
 * in every mode.
 */
export const HOSTED_GATES = Object.freeze({
  cloudSync: {
    runsOn: "host",
    costsMoney: true,
    service: "encrypted-relay",
    why: "The relay stores and forwards end-to-end encrypted sync blobs between devices.",
  },
  persistentCollab: {
    runsOn: "host",
    costsMoney: true,
    service: "persistent-collab-server",
    why: "A hosted y-websocket server keeps collaboration rooms alive while every peer is offline.",
  },
  workspaceSharing: {
    runsOn: "host",
    costsMoney: true,
    service: "workspace-sharing",
    why: "Shared workspaces need hosted membership, invitations and storage.",
  },
  auditLog: {
    runsOn: "host",
    costsMoney: true,
    service: "audit-log-worker",
    why: "The audit log is written to and read from the hosted lumen-audit worker.",
  },
} as const satisfies Partial<Record<keyof Capabilities, HostedGate>>);

/** A capability that may be enforced. */
export type GatedCapability = keyof typeof HOSTED_GATES;

export function isHostedGate(key: string): key is GatedCapability {
  return Object.prototype.hasOwnProperty.call(HOSTED_GATES, key);
}

/** The entitlement's capabilities with every non-hosted key unlocked. */
function hostedOnly(caps: Capabilities): Capabilities {
  const out: Capabilities = { ...UNLOCKED_CAPS };
  for (const key of Object.keys(HOSTED_GATES) as GatedCapability[]) out[key] = caps[key];
  return out;
}

/** True when plan limits apply (billing configured or dev tier shim set). */
export function gatesEnforced(): boolean {
  return isBillingConfigured() || hasDevTierOverride();
}

/** Capabilities feature code should honour right now. */
export function effectiveCapabilities(): Capabilities {
  return gatesEnforced() ? hostedOnly(useEntitlement.getState().capabilities) : { ...UNLOCKED_CAPS };
}

/** React hook — re-renders when the entitlement changes. Hosted gates only. */
export function useCapability<K extends GatedCapability>(key: K): Capabilities[K] {
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
