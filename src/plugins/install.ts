/**
 * Installing a plugin from a signed registry (plan W10.B3, audit W4.32 / 11.2).
 *
 * The steps, each of which can refuse the install:
 *   1. Download `index.json` and `index.json.sig` through the privacy
 *      ledger (`withLedger`, forced: every request is listed, also to this
 *      origin). Nothing about the user is sent: these are static files.
 *   2. Check the Ed25519 signature over the exact bytes of `index.json`
 *      (signing.ts: `verifyPluginSignature`). Only a signer pinned in
 *      VITE_PLUGIN_TRUSTED_KEYS or trusted by the user counts; a key
 *      written in the .sig file is never trusted by itself. One changed
 *      byte anywhere in index.json fails here.
 *   3. Download the version's manifest and code, also through the ledger,
 *      and compare each one's SHA-256 with the signed index. A changed
 *      byte in either fails here.
 *   4. Scan the code (scan.ts) as the gallery does, then load it into its
 *      QuickJS sandbox (manager.ts → pluginHost.ts → sandbox.ts) with the
 *      permissions its manifest declares — the permission screen shows
 *      those before the user presses Install.
 *   5. Record what was installed (id, version, hashes, granted permissions).
 *
 * Uninstall stops the sandbox, removes what the plugin stored (settings,
 * storage) and deletes the install record with its permissions.
 *
 * The registry builder that writes and signs index.json is
 * scripts/build-plugin-registry.mjs (owner key: --keygen, --sign).
 */
import { get as idbGet, set as idbSet } from "idb-keyval";
import { withLedger } from "../ai/privacyLedger";
import { verifyPluginSignature } from "./signing";
import type { Grants } from "./runtime/capabilities";
import type { PluginManifest } from "./runtime/manifest";
import type { PluginInstance } from "./runtime/pluginHost";

/** Why an install was refused. */
export type InstallRefusal =
  | "registry-unsigned"
  | "registry-signature"
  | "registry-untrusted-signer"
  | "registry-format"
  | "not-listed"
  | "delisted"
  | "download"
  | "sha256-code"
  | "sha256-manifest"
  | "manifest"
  | "scan";

export class InstallRefused extends Error {
  constructor(
    public readonly reason: InstallRefusal,
    detail: string,
  ) {
    super(`${reason}: ${detail}`);
    this.name = "InstallRefused";
  }
}

export interface RegistryVersion {
  version: string;
  path: string;
  sha256: string;
  manifestSha256: string;
  /** W11.S14: taken down after a failed review (scripts/review-plugins.mjs --takedown); never installed. */
  delisted?: { at: string; rules: string[] };
}

/** The versions a user can install: every version not taken down (W11.S14), oldest first. */
export const installableVersions = (versions: readonly RegistryVersion[]): RegistryVersion[] => versions.filter((v) => !v.delisted);
export interface RegistryIndex {
  plugins: Array<{ id: string; name: string; versions: RegistryVersion[] }>;
}
export interface RegistrySignature {
  alg: "Ed25519";
  signedBy: string;
  signature: string;
}

export interface InstalledRecord {
  id: string;
  version: string;
  registry: string;
  sha256: string;
  manifestSha256: string;
  grants: string[];
  installedAt: number;
}

const INSTALLED_KEY = "lumen.plugins.installed";
const LEDGER_REASON = "Plugin registry download (signed index, manifest, code); no user data";

export interface InstallDeps {
  /** The fetch the downloads use; it is wrapped with the privacy ledger. Default: window.fetch. */
  fetch?: typeof fetch;
  /** For tests: the worker that hosts the QuickJS sandbox. */
  createWorker?: () => Worker;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const owned = new Uint8Array(bytes.length);
  owned.set(bytes);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", owned));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

function ledgerFetch(deps: InstallDeps): typeof fetch {
  // privacy-ledger: static-asset — wrapped right below with withLedger (forced), so every registry download is listed.
  const inner = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  return withLedger(inner as typeof fetch, { force: { category: "static-asset", reason: LEDGER_REASON } });
}

async function download(f: typeof fetch, url: string, opts: { html?: "absent" } = {}): Promise<Uint8Array | null> {
  let res: Response;
  try {
    res = await f(url, { credentials: "omit", redirect: "error" });
  } catch (e) {
    throw new InstallRefused("download", `${url}: ${(e as Error).message}`);
  }
  if (opts.html && (res.status === 404 || /^text\/html\b/i.test(res.headers.get("content-type") ?? ""))) return null;
  if (!res.ok) throw new InstallRefused("download", `${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** A file that must exist. */
async function required(f: typeof fetch, url: string): Promise<Uint8Array> {
  return (await download(f, url)) as Uint8Array;
}

const join = (base: string, path: string) => `${base.replace(/\/+$/, "")}/${path}`;

/** Parse and check the shape of a signed index (after its signature verified). */
function parseIndex(bytes: Uint8Array): RegistryIndex {
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new InstallRefused("registry-format", "index.json is not JSON");
  }
  const plugins = (data as { plugins?: unknown })?.plugins;
  if (!Array.isArray(plugins)) throw new InstallRefused("registry-format", "index.json has no plugins list");
  const hex = /^[0-9a-f]{64}$/;
  for (const p of plugins as RegistryIndex["plugins"]) {
    if (typeof p?.id !== "string" || !Array.isArray(p.versions)) throw new InstallRefused("registry-format", "a plugin entry has no id or versions");
    for (const v of p.versions) {
      if (typeof v?.version !== "string" || typeof v.path !== "string" || !/^[A-Za-z0-9._@-]+$/.test(v.path)) throw new InstallRefused("registry-format", `${p.id}: a version has no safe path`);
      if (!hex.test(String(v.sha256)) || !hex.test(String(v.manifestSha256))) throw new InstallRefused("registry-format", `${p.id}@${v.version}: missing SHA-256`);
      if (v.delisted !== undefined && (typeof v.delisted?.at !== "string" || !Array.isArray(v.delisted.rules))) throw new InstallRefused("registry-format", `${p.id}@${v.version}: a takedown without its date and rules`);
    }
  }
  return data as RegistryIndex;
}

/**
 * Check a downloaded registry: the signature over the exact index bytes,
 * then its shape. Throws `InstallRefused`; returns the parsed index.
 */
export async function verifyRegistry(indexBytes: Uint8Array, sigBytes: Uint8Array | null): Promise<RegistryIndex> {
  if (!sigBytes) throw new InstallRefused("registry-unsigned", "the registry has no index.json.sig");
  let sig: Partial<RegistrySignature>;
  try {
    sig = JSON.parse(new TextDecoder().decode(sigBytes)) as Partial<RegistrySignature>;
  } catch {
    throw new InstallRefused("registry-signature", "index.json.sig is not JSON");
  }
  if (sig.alg !== "Ed25519" || typeof sig.signature !== "string" || typeof sig.signedBy !== "string") throw new InstallRefused("registry-signature", "index.json.sig is not an Ed25519 signature");
  const ok = await verifyPluginSignature(indexBytes, { signature: sig.signature, signedBy: sig.signedBy });
  if (ok === "untrusted-signer") throw new InstallRefused("registry-untrusted-signer", `signed by ${sig.signedBy}, a key this app does not trust`);
  if (ok !== true) throw new InstallRefused("registry-signature", "the signature does not match index.json");
  return parseIndex(indexBytes);
}

/** Download and verify a registry. */
export async function loadSignedRegistry(base: string, deps: InstallDeps = {}): Promise<RegistryIndex> {
  const f = ledgerFetch(deps);
  const indexBytes = await required(f, join(base, "index.json"));
  // No signature: a 404, or a dev server's HTML page for a missing file. Anything else that fails is an error.
  const sigBytes = await download(f, join(base, "index.json.sig"), { html: "absent" });
  return verifyRegistry(indexBytes, sigBytes);
}

export interface InstallResult {
  instance: PluginInstance;
  record: InstalledRecord;
}

/**
 * Install one plugin from a signed registry at `base` (a URL folder holding
 * index.json, index.json.sig and one folder per version). The latest listed
 * version unless `version` is given.
 */
export async function installFromRegistry(base: string, id: string, version?: string, deps: InstallDeps = {}): Promise<InstallResult> {
  const index = await loadSignedRegistry(base, deps);
  const entry = index.plugins.find((p) => p.id === id);
  const live = entry ? installableVersions(entry.versions) : [];
  const v = version ? live.find((x) => x.version === version) : live[live.length - 1];
  if (!entry || !v) {
    const down = entry?.versions.find((x) => x.delisted && (!version || x.version === version));
    if (down && (version || !live.length)) throw new InstallRefused("delisted", `${id}@${down.version} was taken down after its review failed (${down.delisted!.rules.join(", ")})`);
    throw new InstallRefused("not-listed", `${id}${version ? `@${version}` : ""} is not in the signed registry`);
  }

  const f = ledgerFetch(deps);
  const manifestBytes = await required(f, join(base, `${v.path}/lumen-plugin.json`));
  if ((await sha256Hex(manifestBytes)) !== v.manifestSha256) throw new InstallRefused("sha256-manifest", `${id}@${v.version}: the manifest is not the one the registry signed`);
  const { parseManifest } = await import("./runtime/manifest");
  let manifest: PluginManifest;
  try {
    manifest = parseManifest(new TextDecoder().decode(manifestBytes));
  } catch (e) {
    throw new InstallRefused("manifest", (e as Error).message);
  }
  if (manifest.id !== id || manifest.version !== v.version) throw new InstallRefused("manifest", `the manifest is ${manifest.id}@${manifest.version}, the registry lists ${id}@${v.version}`);

  const codeBytes = await required(f, join(base, `${v.path}/${manifest.main}`));
  if ((await sha256Hex(codeBytes)) !== v.sha256) throw new InstallRefused("sha256-code", `${id}@${v.version}: the code is not the code the registry signed`);
  const code = new TextDecoder().decode(codeBytes);

  const { scanPluginVersion } = await import("./runtime/scan");
  const scan = await scanPluginVersion({ manifest, main: code });
  if (!scan.passed) throw new InstallRefused("scan", `${id}@${v.version}: ${scan.findings.filter((x) => x.severity === "error").map((x) => x.rule).join(", ")}`);

  const grants: Grants = new Set(manifest.capabilities.map((c) => c.id));
  const { startPlugin } = await import("./runtime/manager");
  const instance = await startPlugin({ manifest, code, grants, ...(deps.createWorker ? { createWorker: deps.createWorker } : {}) });

  const record: InstalledRecord = { id, version: v.version, registry: base, sha256: v.sha256, manifestSha256: v.manifestSha256, grants: [...grants].sort(), installedAt: Date.now() };
  const all = await installedPlugins();
  await idbSet(INSTALLED_KEY, { ...all, [id]: record });
  return { instance, record };
}

/** What is installed, by plugin id. */
export async function installedPlugins(): Promise<Record<string, InstalledRecord>> {
  return ((await idbGet(INSTALLED_KEY).catch(() => undefined)) as Record<string, InstalledRecord> | undefined) ?? {};
}

/** Stop the plugin, remove what it stored, and delete its install record and permissions. */
export async function uninstallPlugin(id: string): Promise<void> {
  const { stopPlugin, clearPluginData } = await import("./runtime/manager");
  await stopPlugin(id);
  await clearPluginData(id);
  const all = await installedPlugins();
  if (id in all) {
    const { [id]: _gone, ...rest } = all;
    await idbSet(INSTALLED_KEY, rest);
  }
}
