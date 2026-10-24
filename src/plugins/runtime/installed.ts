/**
 * Installed plugins (plan 11.2 part c): install from the first-party
 * registry or from a bundle file, update, change permissions, enable,
 * disable, uninstall — and start the enabled ones at boot.
 *
 * Trust:
 *   - A registry bundle must match the sha256 the registry (served by the
 *     app itself) pins; if it is signed, the signature must verify against
 *     a trusted key (plugins/signing.ts).
 *   - A file bundle is "unverified" unless it is signed by a trusted key;
 *     the install dialog says so.
 *   - Grants start empty: the user ticks each capability (default deny).
 *     An update that asks for a new capability does not get it until the
 *     user grants it.
 */
import { get as idbGet, set as idbSet } from "idb-keyval";
import { verifyPluginSignature } from "../signing";
import { bundlePayload, parseBundle, sha256Hex, type PluginBundle } from "./bundle";
import { grantsFrom, intersectWithManifest } from "./capabilities";
import type { Capability, PluginManifest } from "./manifest";

export interface InstalledPlugin {
  id: string;
  manifestText: string;
  main: string;
  sha256: string;
  grants: Capability[];
  enabled: boolean;
  source: "registry" | "file";
  /** "signed" = verified against a trusted key; "pinned" = the first-party registry's sha256; "unverified" = a file nobody vouches for. */
  trust: "signed" | "pinned" | "unverified";
  installedAt: number;
  updatedAt: number;
}

export interface RegistryEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  license: string;
  capabilities: string[];
  bundle: string;
  sha256: string;
  signature?: string;
  signedBy?: string;
}

const DB_KEY = "lumen.plugins.installed";
/** A cheap flag the app checks at boot before importing any plugin code. */
export const ANY_FLAG = "lumen.plugins.any";

const listeners = new Set<() => void>();
const changed = () => {
  for (const f of [...listeners]) f();
};
export function subscribeInstalled(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export async function listInstalled(): Promise<InstalledPlugin[]> {
  const v = (await idbGet(DB_KEY).catch(() => undefined)) as InstalledPlugin[] | undefined;
  return Array.isArray(v) ? v : [];
}

async function save(list: InstalledPlugin[]): Promise<void> {
  await idbSet(DB_KEY, list);
  try {
    if (list.length) localStorage.setItem(ANY_FLAG, "1");
    else localStorage.removeItem(ANY_FLAG);
  } catch {
    /* storage denied: plugins just won't start at boot */
  }
  changed();
}

export function manifestOf(p: InstalledPlugin): PluginManifest {
  return parseBundle(JSON.stringify({ format: "lumen-plugin/1", manifest: p.manifestText, main: "" })).manifest;
}

const base = (): string => (import.meta.env?.BASE_URL as string | undefined) ?? "/";

export async function fetchRegistry(signal?: AbortSignal): Promise<RegistryEntry[]> {
  const res = await fetch(`${base()}plugins/registry.json`, { signal, cache: "no-cache" });
  if (!res.ok) throw new Error(`plugin registry: ${res.status}`);
  const data = (await res.json()) as { schema?: number; plugins?: RegistryEntry[] };
  if (data.schema !== 1 || !Array.isArray(data.plugins)) throw new Error("plugin registry: unknown format");
  return data.plugins;
}

/** Check a bundle's integrity; returns its trust level or throws. */
export async function verifyBundle(bundle: PluginBundle, pinnedSha256?: string): Promise<{ sha256: string; trust: InstalledPlugin["trust"] }> {
  const payload = bundlePayload(bundle.manifestText, bundle.main);
  const sha256 = await sha256Hex(payload);
  if (pinnedSha256 && sha256 !== pinnedSha256) throw new Error("the plugin's bytes do not match the registry (sha256) — not installed");
  if (bundle.signature) {
    const v = await verifyPluginSignature(payload, { signature: bundle.signature, signedBy: bundle.signedBy });
    if (v === false) throw new Error("the plugin's signature is invalid — not installed");
    if (v === true) return { sha256, trust: "signed" };
    // A correct signature by an untrusted key vouches for nothing more than an unsigned file.
  }
  return { sha256, trust: pinnedSha256 ? "pinned" : "unverified" };
}

export async function fetchRegistryBundle(entry: RegistryEntry, signal?: AbortSignal): Promise<{ bundle: PluginBundle; sha256: string; trust: InstalledPlugin["trust"] }> {
  if (!/^plugins\/bundles\/[A-Za-z0-9._-]+\.lumenplugin\.json$/.test(entry.bundle)) throw new Error("plugin registry: bad bundle path");
  const res = await fetch(`${base()}${entry.bundle}`, { signal });
  if (!res.ok) throw new Error(`plugin bundle: ${res.status}`);
  const bundle = parseBundle(await res.text());
  if (bundle.manifest.id !== entry.id || bundle.manifest.version !== entry.version) throw new Error("the bundle does not match its registry entry");
  const v = await verifyBundle({ ...bundle, ...(entry.signature ? { signature: entry.signature, signedBy: entry.signedBy } : {}) }, entry.sha256);
  return { bundle, ...v };
}

/**
 * Install (or reinstall / update) a verified bundle with the grants the
 * user ticked. Grants are capped by what the manifest asks for.
 */
export async function installPlugin(bundle: PluginBundle, opts: { sha256: string; trust: InstalledPlugin["trust"]; source: InstalledPlugin["source"]; grants: string[]; enabled?: boolean }): Promise<InstalledPlugin> {
  const list = await listInstalled();
  const prev = list.find((p) => p.id === bundle.manifest.id);
  const grants = [...intersectWithManifest(grantsFrom(opts.grants), bundle.manifest)];
  const now = Date.now();
  const item: InstalledPlugin = {
    id: bundle.manifest.id,
    manifestText: bundle.manifestText,
    main: bundle.main,
    sha256: opts.sha256,
    grants,
    enabled: opts.enabled ?? true,
    source: opts.source,
    trust: opts.trust,
    installedAt: prev?.installedAt ?? now,
    updatedAt: now,
  };
  await save([...list.filter((p) => p.id !== item.id), item]);
  if (item.enabled) await restart(item);
  else await stop(item.id);
  return item;
}

/** Grants an update keeps: the ones already granted that the new version still asks for. New capabilities start denied. */
export function carriedGrants(prev: InstalledPlugin | undefined, next: PluginManifest): Capability[] {
  return [...intersectWithManifest(grantsFrom(prev?.grants), next)];
}

export async function setGrants(id: string, grants: string[]): Promise<void> {
  const list = await listInstalled();
  const p = list.find((x) => x.id === id);
  if (!p) return;
  p.grants = [...intersectWithManifest(grantsFrom(grants), manifestOf(p))];
  p.updatedAt = Date.now();
  await save(list);
  if (p.enabled) await restart(p);
}

export async function setEnabled(id: string, enabled: boolean): Promise<void> {
  const list = await listInstalled();
  const p = list.find((x) => x.id === id);
  if (!p) return;
  p.enabled = enabled;
  await save(list);
  if (enabled) await restart(p);
  else await stop(id);
}

export async function uninstallPlugin(id: string): Promise<void> {
  await stop(id);
  const { clearPluginData } = await import("./manager");
  await clearPluginData(id);
  await save((await listInstalled()).filter((p) => p.id !== id));
}

async function stop(id: string): Promise<void> {
  const { stopPlugin } = await import("./manager");
  await stopPlugin(id);
}

/** Last start error per plugin, for the gallery. */
const startErrors = new Map<string, string>();
export const startError = (id: string): string | undefined => startErrors.get(id);

async function restart(p: InstalledPlugin): Promise<void> {
  const { startPlugin } = await import("./manager");
  startErrors.delete(p.id);
  try {
    await startPlugin({ manifest: manifestOf(p), code: p.main, grants: grantsFrom(p.grants) });
  } catch (e) {
    startErrors.set(p.id, e instanceof Error ? e.message : String(e));
  }
  changed();
}

/** At boot (App, after idle): start every enabled plugin. Errors stay per plugin. */
export async function startInstalledPlugins(): Promise<void> {
  for (const p of await listInstalled()) if (p.enabled) await restart(p);
}
