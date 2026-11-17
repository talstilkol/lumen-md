/**
 * The configuration health report the status bar shows (sign-in, plan, AI
 * key or local model): moved verbatim out of App.tsx (W10.E28), so App stays
 * well under the 800-line limit.
 */
import { useMemo } from "react";
import { useAppStore } from "../store/useStore";
import { useAuth } from "../auth/useAuth";
import { useEntitlement } from "../billing/useEntitlement";
import { localLlmAvailable } from "../ai/localLlm";
import { assessConfigHealth } from "../lib/configHealth";

export function useConfigHealth() {
  const aiKey = useAppStore((s) => s.aiKey);
  const useLocalAi = useAppStore((s) => s.useLocalAi);
  const authStatus = useAuth((s) => s.status);
  const authProviderName = useAuth((s) => s.provider.name);
  const authError = useAuth((s) => s.error);
  const authUserId = useAuth((s) => s.user?.id);
  const entitlementLoading = useEntitlement((s) => s.loading);
  const entitlement = useEntitlement((s) => s.entitlement);
  const capabilitiesCloudSync = useEntitlement((s) => s.capabilities.cloudSync);
  const hasWebGPU = useMemo(() => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false;
    return localLlmAvailable().available;
  }, []);
  return useMemo(
    () =>
      assessConfigHealth({
        authStatus,
        authProviderName,
        authError,
        userId: authUserId,
        entitlementLoading,
        entitlement,
        capabilitiesCloudSync,
        aiKey,
        useLocalAi,
        hasWebGPU,
      }),
    [
      authStatus,
      authProviderName,
      authError,
      authUserId,
      entitlementLoading,
      entitlement,
      capabilitiesCloudSync,
      aiKey,
      useLocalAi,
      hasWebGPU,
    ],
  );
}
