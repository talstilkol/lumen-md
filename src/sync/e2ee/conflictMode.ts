/**
 * Plan W11.S6: what this device does when both devices changed a note —
 * `sync.conflictMode`:
 *   merge (default) — merge first, then ask about what overlaps (plan W1.9);
 *   file            — no merge: keep a Syncthing-style conflict file (./conflict.ts).
 *
 * Per device, like the sync rules (./rules.ts): saved in this browser's
 * localStorage only, never in the vault and never synced, so a phone can
 * keep conflict files while the laptop merges.
 */

export type ConflictMode = "merge" | "file";

export const CONFLICT_MODE_KEY = "lumen.sync.conflictMode.v1";

/** This device's mode; "merge" when none was saved or storage can't be read. */
export function loadConflictMode(storage: Pick<Storage, "getItem"> | null = safeStorage()): ConflictMode {
  try {
    return storage?.getItem(CONFLICT_MODE_KEY) === "file" ? "file" : "merge";
  } catch {
    return "merge";
  }
}

/** Save this device's mode; throws when storage refuses (the form shows it). */
export function saveConflictMode(mode: ConflictMode, storage: Pick<Storage, "setItem" | "removeItem"> | null = safeStorage()): ConflictMode {
  if (mode === "file") storage?.setItem(CONFLICT_MODE_KEY, "file");
  else storage?.removeItem(CONFLICT_MODE_KEY);
  return mode;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
