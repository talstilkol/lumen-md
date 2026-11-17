/**
 * The system-search bridge (plan W13.K3) for Settings → Privacy. The desktop
 * shell has no command for Core Spotlight / Windows Search yet, and a new
 * command must be on the isolation allow-list (src-tauri/isolation), which
 * is the owner's. Until then this stub says so: nothing can be indexed, and
 * clearing has nothing to delete (nothing was ever sent).
 */
import type { Manifest, OsSearchBridge, VaultRef } from "./osSearchIndex";
import { domainOf } from "./osSearchIndex";

export const NEEDS_COMMAND = "needs desktop command (owner: isolation allow-list)";

export interface OsSearchBridgeStatus extends OsSearchBridge {
  /** Why it is not available (shown to the user), or null. */
  readonly reason: string | null;
}

export const stubBridge: OsSearchBridgeStatus = {
  available: false,
  reason: NEEDS_COMMAND,
  async index() {
    throw new Error(NEEDS_COMMAND);
  },
  async remove() {
    throw new Error(NEEDS_COMMAND);
  },
  async clearDomain() {
    // Nothing reached the system index through this stub: there is nothing to delete.
  },
};

/** Per-vault consent and the manifest of what was sent, in this device's storage (never in the vault). */
export function vaultStore(vault: VaultRef, ls: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = typeof localStorage === "undefined" ? null : localStorage) {
  const d = domainOf(vault);
  const on = `lumen.osSearch.enabled.${d}`;
  const man = `lumen.osSearch.manifest.${d}`;
  return {
    enabled: () => ls?.getItem(on) === "1",
    setEnabled: (v: boolean) => (v ? ls?.setItem(on, "1") : ls?.removeItem(on)),
    load: (): Manifest | null => {
      try {
        return JSON.parse(ls?.getItem(man) ?? "null") as Manifest | null;
      } catch {
        return null; // why: a damaged manifest is treated as "nothing sent"; the next sync resends
      }
    },
    save: (m: Manifest | null) => (m ? ls?.setItem(man, JSON.stringify(m)) : ls?.removeItem(man)),
  };
}
