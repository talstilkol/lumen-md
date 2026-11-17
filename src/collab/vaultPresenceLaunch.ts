/**
 * Starts presence for a shared vault (plan W13.S6) — loaded on demand, only
 * when the user switched presence on. Opens a password room of the collab
 * transport (./yjs.ts: Hocuspocus or WebRTC, the same relay a shared note
 * uses) whose name and password come from the vault's secret, so the relay
 * sees an opaque room and sealed states only; follows the note open in the
 * editor; stops when airplane mode goes on.
 */
import { airplaneModeOn, onAirplaneOn } from "../privacy/airplane";
import { useAppStore } from "../store/useStore";
import { presenceDeviceName, presenceEnabled, presenceKeys, startVaultPresence, type VaultPresence } from "./vaultPresence";
import type { AwarenessLike } from "./e2eAwareness";

export interface LaunchDeps {
  /** Opens the room; default: a collab session with the room password and no seed. */
  connect?: (room: string, password: string) => Promise<{ awareness: AwarenessLike; destroy(): void }>;
}

async function defaultConnect(room: string, password: string) {
  const { connectCollab } = await import("./yjs");
  const s = connectCollab(room, "", { password, isNewRoom: false, share: null });
  return { awareness: s.awareness as unknown as AwarenessLike, destroy: () => s.destroy() };
}

/** Presence for the vault with these keys, until the returned stop is called; null when it may not run. */
export async function startPresenceForVault(keys: { secret: Uint8Array; vaultId: string }, deps: LaunchDeps = {}): Promise<(() => void) | null> {
  if (!presenceEnabled() || airplaneModeOn() || !presenceDeviceName()) return null;
  const { room, password } = await presenceKeys(keys.secret, keys.vaultId);
  const conn = await (deps.connect ?? defaultConnect)(room, password);
  const p: VaultPresence | null = startVaultPresence({ plain: conn.awareness, room, password, device: presenceDeviceName(), airplane: airplaneModeOn });
  if (!p) {
    conn.destroy();
    return null;
  }
  const active = () => useAppStore.getState().doc.workspaceName ?? null;
  p.setNote(active());
  let last = active();
  const offStore = useAppStore.subscribe(() => {
    const now = active();
    if (now !== last) p.setNote((last = now));
  });
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    offStore();
    offAirplane();
    p.destroy();
    conn.destroy();
  };
  const offAirplane = onAirplaneOn(stop);
  return stop;
}
