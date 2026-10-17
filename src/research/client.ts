/**
 * Client for the research worker (edge-workers/research): page extraction
 * and search with the user's own key. The endpoint comes from the build
 * (VITE_RESEARCH_ENDPOINT, added to the CSP) or a runtime override that
 * the CSP must already allow.
 */
import { connectAllowedByCsp } from "../lib/cspConnect";

export interface ExtractedPage {
  url: string;
  finalUrl: string;
  /** HTTP status of the final response; 0 when it wasn't fetched. */
  status: number;
  title?: string;
  text?: string;
  truncated?: boolean;
  /** blocked-url | http-error | unsupported-type | too-many-redirects | network */
  error?: string;
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export type SearchProvider = "claude" | "brave" | "tavily";

export interface ResearchSettings {
  provider: SearchProvider;
  key: string;
}

const ls = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

export function researchEndpoint(): string | null {
  const built = (import.meta.env?.VITE_RESEARCH_ENDPOINT as string | undefined)?.trim();
  const override = ls("lumen.research.endpoint")?.trim();
  const url = override || built;
  if (!url) return null;
  return connectAllowedByCsp(url) ? url.replace(/\/+$/, "") : null;
}

/**
 * Headers for research-service requests: the optional shared token the
 * worker requires when its RESEARCH_TOKEN is set (see the worker README).
 * Sent only when configured, so a plain GET stays a simple CORS request.
 */
function serviceHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = (import.meta.env?.VITE_RESEARCH_TOKEN as string | undefined)?.trim();
  return token ? { ...extra, "X-Lumen-Research-Token": token } : extra;
}

export function getResearchSettings(): ResearchSettings {
  const p = ls("lumen.research.provider");
  return {
    provider: p === "brave" || p === "tavily" ? p : "claude",
    key: ls("lumen.research.searchKey") ?? "",
  };
}

export function setResearchSettings(s: Partial<ResearchSettings>): void {
  try {
    if (s.provider) localStorage.setItem("lumen.research.provider", s.provider);
    if (s.key !== undefined) {
      if (s.key) localStorage.setItem("lumen.research.searchKey", s.key);
      else localStorage.removeItem("lumen.research.searchKey");
    }
  } catch {
    /* */
  }
}

export class ResearchUnavailableError extends Error {
  constructor(message = "The research service isn't configured for this deployment (VITE_RESEARCH_ENDPOINT).") {
    super(message);
    this.name = "ResearchUnavailableError";
  }
}

export async function extractPage(url: string, signal?: AbortSignal, endpoint = researchEndpoint()): Promise<ExtractedPage> {
  if (!endpoint) throw new ResearchUnavailableError();
  try {
    const res = await fetch(`${endpoint}/extract?url=${encodeURIComponent(url)}`, { signal, headers: serviceHeaders() });
    const body = (await res.json().catch(() => ({}))) as Partial<ExtractedPage> & { error?: string };
    if (!res.ok && !body.status) return { url, finalUrl: url, status: 0, error: body.error ?? `service ${res.status}` };
    return { url, finalUrl: body.finalUrl ?? url, status: body.status ?? res.status, ...body } as ExtractedPage;
  } catch (e) {
    if (signal?.aborted) throw e;
    return { url, finalUrl: url, status: 0, error: "network" };
  }
}

export async function searchWeb(
  query: string,
  settings: ResearchSettings,
  count = 5,
  signal?: AbortSignal,
  endpoint = researchEndpoint(),
): Promise<SearchHit[]> {
  if (!endpoint) throw new ResearchUnavailableError();
  if (settings.provider === "claude") throw new Error("Claude web search runs through the Anthropic API, not the research service.");
  if (!settings.key) throw new Error(`Add your ${settings.provider} API key (Research: Settings…).`);
  const res = await fetch(`${endpoint}/search`, {
    method: "POST",
    headers: serviceHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ provider: settings.provider, query, key: settings.key, count }),
    signal,
  });
  const body = (await res.json().catch(() => ({}))) as { results?: SearchHit[]; error?: string };
  if (!res.ok) throw new Error(`Search failed: ${body.error ?? res.status}`);
  return body.results ?? [];
}
