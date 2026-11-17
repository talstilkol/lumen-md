/**
 * Plugins found as files in the vault (plan W13.S2): a plugin folder can
 * reach the disk through a sync (a shared vault where the user allowed
 * plugins, an imported Obsidian vault, a copied folder). Files on disk are
 * never a reason to run code. A vault plugin runs only after the install's
 * permission screen (W1.20) approved exactly these bytes, with exactly the
 * grants the user saw; a changed `main.js` or `manifest.json` (the next sync
 * can bring one) needs the screen again.
 *
 * The approvals are kept on this device (IndexedDB), never in the vault, so
 * no synced file can approve a plugin.
 */
import { get as idbGet, set as idbSet } from "idb-keyval";

export const VAULT_PLUGIN_DIRS = [".lumen/plugins/", ".obsidian/plugins/"] as const;
const APPROVED_KEY = "lumen.plugins.vaultApproved.v1";

export interface VaultPluginCandidate {
  id: string;
  /** The plugin's folder in the vault (`.lumen/plugins/<id>`). */
  dir: string;
  manifestText: string;
  code: string;
  sha256: string;
  manifestSha256: string;
}

export interface VaultApproval {
  id: string;
  dir: string;
  sha256: string;
  manifestSha256: string;
  grants: string[];
  approvedAt: number;
}

export type VaultPluginVerdict = "needs-permission" | "approved" | "changed";

export class VaultPluginNotApproved extends Error {
  constructor(readonly id: string, readonly verdict: Exclude<VaultPluginVerdict, "approved">) {
    super(`${id}: a plugin found in the vault runs only after its permission screen (${verdict})`);
    this.name = "VaultPluginNotApproved";
  }
}

async function sha256Hex(text: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Plugin folders among `paths` that hold both a manifest.json and a main.js. */
export async function findVaultPlugins(paths: readonly string[], read: (path: string) => Promise<string>): Promise<VaultPluginCandidate[]> {
  const dirs = new Set<string>();
  for (const p of paths)
    for (const root of VAULT_PLUGIN_DIRS) {
      if (!p.startsWith(root)) continue;
      const id = p.slice(root.length).split("/")[0];
      if (id) dirs.add(root + id);
    }
  const set = new Set(paths);
  const out: VaultPluginCandidate[] = [];
  for (const dir of [...dirs].sort()) {
    if (!set.has(`${dir}/manifest.json`) || !set.has(`${dir}/main.js`)) continue;
    const manifestText = await read(`${dir}/manifest.json`);
    const code = await read(`${dir}/main.js`);
    out.push({ id: dir.slice(dir.lastIndexOf("/") + 1), dir, manifestText, code, sha256: await sha256Hex(code), manifestSha256: await sha256Hex(manifestText) });
  }
  return out;
}

export async function vaultApprovals(): Promise<Record<string, VaultApproval>> {
  return ((await idbGet(APPROVED_KEY)) as Record<string, VaultApproval> | undefined) ?? {};
}

/** Whether `c` may run: approved for these exact bytes, changed since, or never approved. */
export function vaultPluginVerdict(c: VaultPluginCandidate, approvals: Record<string, VaultApproval>): VaultPluginVerdict {
  const a = approvals[c.dir];
  if (!a) return "needs-permission";
  return a.sha256 === c.sha256 && a.manifestSha256 === c.manifestSha256 ? "approved" : "changed";
}

/**
 * Record the permission screen's "Install" for `c`, with the grants the
 * user saw there. Only the install screen calls this (never a sync, never
 * a file).
 */
export async function approveVaultPlugin(c: VaultPluginCandidate, grants: readonly string[], now = Date.now()): Promise<VaultApproval> {
  const all = await vaultApprovals();
  const a: VaultApproval = { id: c.id, dir: c.dir, sha256: c.sha256, manifestSha256: c.manifestSha256, grants: [...grants], approvedAt: now };
  all[c.dir] = a;
  await idbSet(APPROVED_KEY, all);
  return a;
}

export async function revokeVaultPlugin(dir: string): Promise<void> {
  const all = await vaultApprovals();
  delete all[dir];
  await idbSet(APPROVED_KEY, all);
}

/**
 * Start a vault plugin through `start` (the sandbox), with the grants the
 * user approved — never the ones its manifest asks for now. Throws
 * VaultPluginNotApproved when it has no approval for these bytes.
 */
export async function startVaultPlugin<T>(
  c: VaultPluginCandidate,
  start: (opts: { manifestText: string; code: string; grants: Set<string> }) => Promise<T>,
): Promise<T> {
  const approvals = await vaultApprovals();
  const v = vaultPluginVerdict(c, approvals);
  if (v !== "approved") throw new VaultPluginNotApproved(c.id, v);
  return start({ manifestText: c.manifestText, code: c.code, grants: new Set(approvals[c.dir].grants) });
}
