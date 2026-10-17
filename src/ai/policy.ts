/**
 * AI policy — where a request is allowed to go.
 *
 *   local-only   Nothing leaves the machine: Ollama, in-browser WebGPU and
 *                transformers.js only. A cloud provider is never contacted,
 *                not even as a fallback when the local model is unavailable.
 *   local-first  Local executors first; a cloud provider (with the user's
 *                own key) only when none of them can answer.
 *   cloud        The selected cloud provider is used directly.
 *
 * The stored value (`lumen.ai.policy`) wins. Until the user picks one, the
 * default is `local-only` — except for an installation that was already
 * set up for the cloud before policies existed (a cloud provider selected
 * in `lumen.ai.provider`, or any cloud key configured): that keeps working
 * as `local-first`, so an upgrade never silently cuts a configured
 * provider off. The AI settings panel shows the effective policy and lets
 * the user pin it.
 */

import { useAppStore } from "../store/useStore";

export type AiPolicy = "local-only" | "local-first" | "cloud";

export const AI_POLICIES: readonly AiPolicy[] = ["local-only", "local-first", "cloud"];

const STORAGE_KEY = "lumen.ai.policy";

/** Providers that send prompts to a third party. */
export const CLOUD_PROVIDERS = ["openai", "anthropic", "gemini", "mistral"] as const;
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];

export function isCloudProvider(p: string): p is CloudProvider {
  return (CLOUD_PROVIDERS as readonly string[]).includes(p);
}

function storedPolicy(): AiPolicy | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && (AI_POLICIES as readonly string[]).includes(v) ? (v as AiPolicy) : null;
  } catch {
    return null;
  }
}

/** True when the user picked a policy explicitly (not the derived default). */
export function hasExplicitAiPolicy(): boolean {
  return storedPolicy() !== null;
}

/** Any cloud key present — the pre-policy signal that the user opted into the cloud. */
export function hasAnyCloudKey(): boolean {
  try {
    if (useAppStore.getState().aiKey) return true;
  } catch {
    /* store not mounted (tests) */
  }
  try {
    return CLOUD_PROVIDERS.some((p) => !!localStorage.getItem(`lumen.ai.key.${p}`));
  } catch {
    return false;
  }
}

function cloudProviderSelected(): boolean {
  try {
    const p = localStorage.getItem("lumen.ai.provider");
    return !!p && isCloudProvider(p);
  } catch {
    return false;
  }
}

/** The effective policy: the stored choice, or the compatibility default. */
export function getAiPolicy(): AiPolicy {
  const stored = storedPolicy();
  if (stored) return stored;
  return cloudProviderSelected() || hasAnyCloudKey() ? "local-first" : "local-only";
}

export function setAiPolicy(policy: AiPolicy): void {
  if (!(AI_POLICIES as readonly string[]).includes(policy)) throw new Error(`Unknown AI policy: ${policy}`);
  localStorage.setItem(STORAGE_KEY, policy);
}

/** May a request go to a cloud provider under the current policy? */
export function cloudAllowed(policy: AiPolicy = getAiPolicy()): boolean {
  return policy !== "local-only";
}

/**
 * May a request go to `provider` under the current policy? Local providers
 * are always allowed; cloud providers only outside `local-only`.
 */
export function providerAllowed(provider: string, policy: AiPolicy = getAiPolicy()): boolean {
  return !isCloudProvider(provider) || cloudAllowed(policy);
}
