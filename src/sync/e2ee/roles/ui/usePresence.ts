/**
 * While a shared vault is open here, its presence runs (plan W13.S6) — if
 * the user switched presence on and chose a device name. The launcher loads
 * on demand; nothing is sent otherwise.
 */
import { useEffect } from "react";
import type { E2eeSync } from "../../engine";
import { swallowed } from "../../../../lib/logger";

export function usePresence(sync: E2eeSync | null | undefined, version = 0): void {
  useEffect(() => {
    if (!sync) return;
    let stop: (() => void) | null = null;
    let live = true;
    const keys = sync.keys();
    void import("../../../../collab/vaultPresence")
      .then((m) => (m.presenceEnabled() ? import("../../../../collab/vaultPresenceLaunch").then((l) => l.startPresenceForVault(keys)) : null))
      .then((s) => {
        if (live) stop = s;
        else s?.();
      })
      .catch((e: unknown) => swallowed("sync/e2ee/roles/usePresence: presence did not start; the vault works without it", e));
    return () => {
      live = false;
      stop?.();
    };
  }, [sync, version]);
}
