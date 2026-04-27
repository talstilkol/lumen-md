/**
 * Entitlement store — reads the user's plan from the configured backend and
 * exposes a tiny `useCapabilities()` selector that feature code uses to gate
 * Pro-only paths.
 *
 * Today: localStorage shim for development (`lumen.dev.tier` ∈ free/pro/team).
 * Production wiring lives in `loadFromSupabase()` — flip the import when ready.
 *
 * Usage:
 *   const caps = useCapabilities();
 *   if (!caps.smartSearch) showUpgradePrompt();
 */

import { create } from "zustand";
import { capabilitiesFor, type Capabilities, type Entitlement, FREE_CAPS } from "./types";
import { log } from "../lib/logger";

interface EntitlementStore {
  entitlement: Entitlement | null;
  capabilities: Capabilities;
  loading: boolean;
  refresh: () => Promise<void>;
  /** Dev/QA helper — set the local tier without round-tripping the backend. */
  setLocal: (tier: Entitlement["tier"]) => void;
}

const DEV_KEY = "lumen.dev.tier";

function readDevTier(): Entitlement | null {
  try {
    const raw = localStorage.getItem(DEV_KEY);
    if (!raw) return null;
    if (raw === "free" || raw === "pro" || raw === "team") {
      return { tier: raw, status: "active" };
    }
  } catch {
    /* storage may be denied */
  }
  return null;
}

export const useEntitlement = create<EntitlementStore>((set) => ({
  entitlement: null,
  capabilities: FREE_CAPS,
  loading: true,
  async refresh() {
    set({ loading: true });
    try {
      // Prefer the dev shim while we wait for the real backend.
      const dev = readDevTier();
      if (dev) {
        set({ entitlement: dev, capabilities: capabilitiesFor(dev), loading: false });
        return;
      }
      // TODO(P2-05): replace with `await fetchFromBillingBackend()` once the
      // Stripe webhook → Supabase row pipeline ships.
      set({ entitlement: null, capabilities: FREE_CAPS, loading: false });
    } catch (err) {
      log.warn("entitlement refresh failed", err);
      set({ entitlement: null, capabilities: FREE_CAPS, loading: false });
    }
  },
  setLocal(tier) {
    try {
      localStorage.setItem(DEV_KEY, tier);
    } catch {
      /* */
    }
    const ent: Entitlement = { tier, status: "active" };
    set({ entitlement: ent, capabilities: capabilitiesFor(ent), loading: false });
  },
}));

export function useCapabilities(): Capabilities {
  return useEntitlement((s) => s.capabilities);
}
