/**
 * Templates marketplace client (P3-06).
 *
 * Loads `/public/templates/registry.json` (the same shape as the plugin
 * registry) and exposes:
 *
 *   • `fetchTemplateRegistry()` — list every template available.
 *   • `installTemplate(id)`     — fetch the body, write it as a new file,
 *                                 bump the registry's `downloads` counter
 *                                 in localStorage so the UI can rank by
 *                                 "popular in your workspace".
 *
 * The registry is fetched once per session and cached in module scope so
 * the gallery feels snappy. A "Reload registry" command bypasses the
 * cache when needed.
 */

import { writeWorkspaceFile } from "./workspace";
import { fetchWithRetry } from "../lib/fetchRetry";

export interface MarketplaceTemplate {
  id: string;
  name: string;
  category: string;
  author: string;
  description: string;
  icon: string;
  version: string;
  url: string;
  rating: number;
  downloads: number;
  tags: string[];
}

interface Registry {
  version: number;
  updated: string;
  templates: MarketplaceTemplate[];
}

const LOCAL_DOWNLOADS_KEY = "lumen.templates.downloads";

let cache: Registry | null = null;

export async function fetchTemplateRegistry(force = false): Promise<MarketplaceTemplate[]> {
  if (cache && !force) return mergeLocalDownloads(cache.templates);
  const res = await fetchWithRetry("/templates/registry.json", { cache: "no-cache" }, { label: "templates.registry", maxRetries: 2, baseDelayMs: 600 });
  if (!res.ok) throw new Error(`Registry ${res.status}`);
  cache = (await res.json()) as Registry;
  return mergeLocalDownloads(cache.templates);
}

/**
 * Pull the body of `template` from its `url`, save it under
 * `templates/<id>.md` in the workspace, and increment the local download
 * counter so the gallery can re-rank.
 */
export async function installTemplate(
  template: MarketplaceTemplate,
): Promise<{ path: string; bytes: number }> {
  const url = template.url.startsWith("/") || /^https?:\/\//.test(template.url)
    ? template.url
    : `/${template.url}`;
  const res = await fetchWithRetry(url, { cache: "no-cache" }, { label: "templates.install", maxRetries: 2, baseDelayMs: 700, maxDelayMs: 2500 });
  if (!res.ok) throw new Error(`Template ${res.status}`);
  const body = await res.text();
  const path = `templates/${template.id}.md`;
  await writeWorkspaceFile(path, body);
  bumpDownloads(template.id);
  void recordRemoteInstall(template.id);
  return { path, bytes: body.length };
}

function bumpDownloads(id: string): void {
  try {
    const raw = localStorage.getItem(LOCAL_DOWNLOADS_KEY);
    const parsed: Record<string, number> = raw ? JSON.parse(raw) : {};
    parsed[id] = (parsed[id] ?? 0) + 1;
    localStorage.setItem(LOCAL_DOWNLOADS_KEY, JSON.stringify(parsed));
  } catch {
    /* private mode — counter is best-effort */
  }
}

function mergeLocalDownloads(templates: MarketplaceTemplate[]): MarketplaceTemplate[] {
  let local: Record<string, number> = {};
  try {
    const raw = localStorage.getItem(LOCAL_DOWNLOADS_KEY);
    local = raw ? JSON.parse(raw) : {};
  } catch {
    /* */
  }
  return templates.map((t) => ({
    ...t,
    downloads: t.downloads + (local[t.id] ?? 0),
  }));
}

/* ─── Real marketplace backend (marketplace-server) ────────────────── */

const BACKEND_KEY = "lumen.marketplace.url";

/** Configured marketplace backend base URL, or null for offline/static mode. */
export function getMarketplaceBackendUrl(): string | null {
  try {
    const fromStorage = localStorage.getItem(BACKEND_KEY);
    if (fromStorage) return fromStorage.replace(/\/+$/, "");
  } catch {
    /* private mode */
  }
  const env = (import.meta as ImportMeta & { env?: { VITE_MARKETPLACE_URL?: string } }).env
    ?.VITE_MARKETPLACE_URL;
  return env ? env.replace(/\/+$/, "") : null;
}

interface BackendItem {
  id: string;
  type: string;
  name: string;
  description: string;
  author: string;
  version: string;
  url: string;
  tags: string[];
  downloads: number;
  rating: number;
}

function toTemplate(it: BackendItem): MarketplaceTemplate {
  return {
    id: it.id,
    name: it.name,
    category: it.type,
    author: it.author,
    description: it.description,
    icon: "🧩",
    version: it.version,
    url: it.url,
    rating: it.rating,
    downloads: it.downloads,
    tags: it.tags ?? [],
  };
}

/**
 * List marketplace items from the REAL backend when one is configured
 * (`localStorage["lumen.marketplace.url"]` or `VITE_MARKETPLACE_URL`); falls
 * back to the bundled static registry so the gallery still works offline.
 */
export async function fetchMarketplaceItems(
  opts: { type?: string; query?: string } = {},
): Promise<MarketplaceTemplate[]> {
  const backend = getMarketplaceBackendUrl();
  if (!backend) return fetchTemplateRegistry();
  const params = new URLSearchParams();
  if (opts.type) params.set("type", opts.type);
  if (opts.query) params.set("q", opts.query);
  const qs = params.toString();
  const res = await fetchWithRetry(
    `${backend}/items${qs ? `?${qs}` : ""}`,
    { cache: "no-cache" },
    { label: "marketplace.list", maxRetries: 2, baseDelayMs: 600 },
  );
  if (!res.ok) throw new Error(`Marketplace ${res.status}`);
  return ((await res.json()) as BackendItem[]).map(toTemplate);
}

/** Record a real install against the backend (best-effort; no-op offline). */
export async function recordRemoteInstall(id: string): Promise<void> {
  const backend = getMarketplaceBackendUrl();
  if (!backend) return;
  try {
    await fetch(`${backend}/items/${encodeURIComponent(id)}/install`, { method: "POST" });
  } catch {
    /* best effort */
  }
}

/** Publish (or update) an item on the marketplace backend. */
export async function publishToMarketplace(item: {
  id: string;
  type: "template" | "plugin" | "theme";
  name: string;
  [k: string]: unknown;
}): Promise<MarketplaceTemplate> {
  const backend = getMarketplaceBackendUrl();
  if (!backend) throw new Error("No marketplace backend configured");
  const res = await fetch(`${backend}/items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error(`Publish ${res.status}`);
  return toTemplate((await res.json()) as BackendItem);
}

/** Submit a 1–5 rating to the backend; returns the new average. */
export async function rateMarketplaceItem(id: string, rating: number): Promise<number> {
  const backend = getMarketplaceBackendUrl();
  if (!backend) throw new Error("No marketplace backend configured");
  const res = await fetch(`${backend}/items/${encodeURIComponent(id)}/rate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rating }),
  });
  if (!res.ok) throw new Error(`Rate ${res.status}`);
  return ((await res.json()) as { rating: number }).rating;
}
