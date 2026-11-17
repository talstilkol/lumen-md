/**
 * Encrypted presence across a shared vault (plan W13.S6): who has which
 * note open, as Notion and Google Docs show it — without the relay ever
 * seeing a name or a path.
 *
 *   - One presence "room" per shared vault. Its id and its password come
 *     from the vault's secret through HKDF (`presenceKeys`), so the relay
 *     sees an opaque room id and cannot link it to the vault.
 *   - Each device's state — the device name the user chose and the note it
 *     has open — is sealed with W2.20's awareness bridge (./e2eAwareness.ts,
 *     AES-GCM under the room key, the client id in the tag, a counter
 *     against replay). The relay forwards `{ e2e: "<base64>" }` only.
 *   - Time to live: 30 seconds. A device re-announces every 15 seconds; a
 *     peer not heard from for 30 seconds is gone (a closed laptop, a lost
 *     connection), whatever its last state said.
 *   - Off by default, per device (`lumen.presence.vault.v1`), and never in
 *     airplane mode: then nothing is sent, nothing is listened to, and a
 *     running session stops when the switch goes on.
 *
 * Works on the small `AwarenessLike` surface (y-protocols' Awareness in the
 * app, an in-memory one in tests), so it needs no particular provider.
 */
import { wireE2EAwareness, type AwarenessLike, type E2EAwarenessBridge } from "./e2eAwareness";
import { setPresence, type PresencePeer } from "./presenceStore";
import { swallowed } from "../lib/logger";
import { compareNames } from "../i18n/collate";

export const PRESENCE_TTL_MS = 30_000;
export const PRESENCE_HEARTBEAT_MS = 15_000;
const ENABLED_KEY = "lumen.presence.vault.v1";
const DEVICE_KEY = "lumen.presence.deviceName.v1";
/** A device name is shown to the other members: short, one line. */
export const MAX_DEVICE_NAME = 40;

export function presenceEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setPresenceEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(ENABLED_KEY, "1");
    else localStorage.removeItem(ENABLED_KEY);
  } catch (e) {
    swallowed("collab/vaultPresence: the presence switch could not be saved; it stays off", e);
  }
}

/** The name this device shows to the other members ("" until the user picks one). */
export function presenceDeviceName(): string {
  try {
    return cleanDeviceName(localStorage.getItem(DEVICE_KEY) ?? "");
  } catch {
    return "";
  }
}

export function setPresenceDeviceName(name: string): string {
  const clean = cleanDeviceName(name);
  try {
    if (clean) localStorage.setItem(DEVICE_KEY, clean);
    else localStorage.removeItem(DEVICE_KEY);
  } catch (e) {
    swallowed("collab/vaultPresence: the device name could not be saved", e);
  }
  return clean;
}

/** One line, no control or bidi-override characters, at most MAX_DEVICE_NAME characters. */
export function cleanDeviceName(name: string): string {
  return [...name.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim()].slice(0, MAX_DEVICE_NAME).join("");
}

const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The presence room's id and password, from the vault's secret (never the secret itself). */
export async function presenceKeys(vaultSecret: Uint8Array, vaultId: string): Promise<{ room: string; password: string }> {
  const base = await crypto.subtle.importKey("raw", vaultSecret as BufferSource, "HKDF", false, ["deriveBits"]);
  const derive = async (label: string) =>
    new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode(vaultId), info: new TextEncoder().encode(`lumen-presence/1/${label}`) }, base, 256));
  return { room: `p-${b64u((await derive("room")).slice(0, 16))}`, password: b64u(await derive("password")) };
}

export interface VaultPresenceOptions {
  /** The awareness this module reads and writes (plain states). */
  plain: AwarenessLike;
  /**
   * The awareness the network syncs, sealed here with `room` and `password`.
   * Omit it when `plain` is already sealed on its way out (a collab session
   * opened with the room password, ./yjs.ts, which wires the same bridge).
   */
  transport?: AwarenessLike;
  room: string;
  password: string;
  device: string;
  now?: () => number;
  /** Airplane mode (default: privacy/airplane's switch). */
  airplane?: () => boolean;
  /** The user's switch (default: `presenceEnabled`). */
  enabled?: () => boolean;
  /** Where the peer list goes (default: ./presenceStore, read by the tree and the tabs). */
  publish?: (peers: PresencePeer[]) => void;
  /** Timers (tests pass fake ones). */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
}

export interface VaultPresence {
  /** The note this device has open now (a vault path), or null. */
  setNote(path: string | null): void;
  /** Other devices heard from within the TTL. */
  peers(): PresencePeer[];
  /** Drop peers past the TTL (also runs on every heartbeat). */
  prune(): void;
  whenIdle(): Promise<void>;
  destroy(): void;
}

/**
 * Start presence for one shared vault, or null when it may not run (switched
 * off, airplane mode, no device name). Nothing is sent before this returns
 * non-null.
 */
export function startVaultPresence(o: VaultPresenceOptions): VaultPresence | null {
  const enabled = o.enabled ?? presenceEnabled;
  const airplane = o.airplane ?? (() => false);
  const device = cleanDeviceName(o.device);
  if (!enabled() || airplane() || !device) return null;
  const now = o.now ?? Date.now;
  const every = o.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const stop = o.clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>));
  const bridge: E2EAwarenessBridge = o.transport ? wireE2EAwareness(o.plain, o.transport, { password: o.password, room: o.room }) : { whenIdle: () => Promise.resolve(), destroy: () => undefined };
  /** When each peer was last heard from, by this device's clock (a peer's own clock is not trusted). */
  const heard = new Map<number, number>();
  let note: string | null = null;
  let destroyed = false;

  const sink = o.publish ?? setPresence;
  const publish = () => sink(peers());
  const onChange = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
    for (const id of [...added, ...updated]) if (id !== o.plain.clientID) heard.set(id, now());
    for (const id of removed) heard.delete(id);
    publish();
  };
  o.plain.on("change", onChange);

  const announce = () => {
    if (destroyed) return;
    if (!enabled() || airplane()) {
      api.destroy();
      return;
    }
    o.plain.setLocalState({ presence: { v: 1, device, note, at: now() } });
  };

  function peers(): PresencePeer[] {
    const out: PresencePeer[] = [];
    const t = now();
    for (const [id, state] of o.plain.getStates()) {
      if (id === o.plain.clientID) continue;
      const at = heard.get(id);
      if (at === undefined || t - at > PRESENCE_TTL_MS) continue;
      const p = (state as { presence?: { v?: number; device?: unknown; note?: unknown } }).presence;
      if (!p || p.v !== 1 || typeof p.device !== "string") continue;
      out.push({ clientID: id, device: cleanDeviceName(p.device), note: typeof p.note === "string" ? p.note : null, heardAt: at });
    }
    return out.sort((a, b) => compareNames(a.device, b.device) || a.clientID - b.clientID);
  }

  const prune = () => {
    const t = now();
    let changed = false;
    for (const [id, at] of heard) if (t - at > PRESENCE_TTL_MS) (heard.delete(id), (changed = true));
    if (changed) publish();
  };

  const timer = every(() => {
    prune();
    announce();
  }, PRESENCE_HEARTBEAT_MS);

  const api: VaultPresence = {
    setNote(path) {
      note = path;
      announce();
    },
    peers,
    prune,
    whenIdle: () => bridge.whenIdle(),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop(timer);
      o.plain.off("change", onChange);
      // Leave cleanly: the others drop this device at once instead of after the TTL.
      try {
        o.plain.setLocalState(null);
      } catch (e) {
        swallowed("collab/vaultPresence: the departure could not be announced; the others drop this device after 30 s", e);
      }
      void bridge.whenIdle().then(() => bridge.destroy());
      sink([]);
    },
  };
  announce();
  return api;
}
