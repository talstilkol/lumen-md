/**
 * Who has which note open in a shared vault (plan W13.S6), for the file tree
 * and the tabs. Tiny on purpose — no crypto, no Yjs — so the tree can read it
 * at start-up; ./vaultPresence.ts (loaded only when presence is switched on)
 * fills it.
 */

export interface PresencePeer {
  clientID: number;
  /** The name the other device chose to show. */
  device: string;
  /** The vault path it has open, or null. */
  note: string | null;
  /** When this device last heard from it (this device's clock). */
  heardAt: number;
}

let peers: readonly PresencePeer[] = [];
let byNote = new Map<string, string[]>();
const listeners = new Set<() => void>();

export function setPresence(next: readonly PresencePeer[]): void {
  peers = next;
  const m = new Map<string, string[]>();
  for (const p of next) if (p.note) m.set(p.note, [...(m.get(p.note) ?? []), p.device]);
  byNote = m;
  for (const l of listeners) l();
}

export const presencePeers = (): readonly PresencePeer[] => peers;

/** The device names that have `path` open (sorted, as set). */
export function devicesOn(path: string): readonly string[] {
  return byNote.get(path) ?? EMPTY;
}
const EMPTY: readonly string[] = [];

export function subscribePresence(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
