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
