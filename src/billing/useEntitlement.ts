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
import { useAuth } from "../auth/useAuth";
import { fetchWithRetry } from "../lib/fetchRetry";

interface EntitlementStore {
  entitlement: Entitlement | null;
  capabilities: Capabilities;
  loading: boolean;
  refresh: () => Promise<void>;
  /** Dev/QA helper — set the local tier without round-tripping the backend. */
  setLocal: (tier: Entitlement["tier"]) => void;
}

const DEV_KEY = "lumen.dev.tier";

type EnvShape = {
  VITE_ENTITLEMENT_ENDPOINT?: string;
};

type Env = { env?: EnvShape };

function readEnvVar(key: keyof EnvShape): string {
  try {
    const env = (import.meta as ImportMeta & Env).env;
    return env?.[key]?.trim() ?? "";
  } catch {
    return "";
  }
}

function normalizeStatus(value: unknown): value is Entitlement["status"] {
  return value === "active" || value === "past_due" || value === "canceled" || value === "trialing" || value === "none";
}

function normalizeTier(value: unknown): value is Entitlement["tier"] {
  return value === "free" || value === "pro" || value === "team";
}

function isPlaceholder(value: string): boolean {
  const needle = value.toLowerCase();
  return (
    !value ||
    needle.includes("placeholder") ||
    needle.includes("example") ||
    needle.includes("change-me") ||
    needle.includes("todo")
  );
}

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value, location.origin);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function toEntitlement(payload: unknown): Entitlement | null {
  if (!payload || typeof payload !== "object") return null;
  const src = payload as Record<string, unknown>;
  if (!normalizeTier(src.tier)) return null;
  if (!normalizeStatus(src.status)) return null;
  const ent: Entitlement = {
    tier: src.tier,
    status: src.status,
  };
  if (typeof src.renewsAt === "number") ent.renewsAt = src.renewsAt;
  if (typeof src.subscriptionId === "string") ent.subscriptionId = src.subscriptionId;
  return ent;
}

async function fetchEntitlementFromBackend(): Promise<Entitlement | null> {
  const endpoint = readEnvVar("VITE_ENTITLEMENT_ENDPOINT");
  if (!endpoint || isPlaceholder(endpoint) || !isValidUrl(endpoint)) return null;
  const res = await fetchWithRetry(
    endpoint,
    {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    },
    { label: "entitlement.refresh" },
  );
  if (!res.ok) {
    throw new Error(`Could not fetch entitlement status (${res.status}).`);
  }
  const payload = (await res.json()) as { entitlement?: unknown } | Entitlement | null;
  const candidate =
    payload && typeof payload === "object" && "entitlement" in payload
      ? (payload as { entitlement: unknown }).entitlement
      : payload;
  return toEntitlement(candidate);
}

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
      const user = useAuth.getState().user;
      const ent = user ? await fetchEntitlementFromBackend() : null;
      if (ent) {
        set({ entitlement: ent, capabilities: capabilitiesFor(ent), loading: false });
        return;
      }
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
