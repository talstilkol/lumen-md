/**
 * Outline mode (plan W2.13): the pure outline (./outlineCore.ts — blocks,
 * folds, moves) and, here, what is kept per note on this device (the fold
 * state and the mode) and the command event. The split keeps the pure part
 * free of storage, so readers such as the structure critic (W13.W7) load
 * only it.
 */
export * from "./outlineCore";
import { type OutlineOp } from "./outlineCore";

/* ─── Fold state per note (kept out of the file) ─────────────────── */

const FOLDS_KEY = "lumen-outline-folds";
const MODE_KEY = "lumen-outline-mode";
const MAX_NOTES = 500;

function readMap(key: string): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === "object" ? (v as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

function writeMap(key: string, map: Record<string, string[]>): void {
  try {
    const keys = Object.keys(map);
    // Keep the newest entries only (insertion order = last written last).
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_NOTES))) delete map[k];
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // why: storage is blocked or full (private mode, quota): the setting holds for this session only
    /* private mode / quota: folds just don't persist */
  }
}

export function loadFolds(note: string): string[] {
  const v = readMap(FOLDS_KEY)[note];
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}

export function saveFolds(note: string, keys: readonly string[]): void {
  const map = readMap(FOLDS_KEY);
  delete map[note];
  if (keys.length) map[note] = [...new Set(keys)];
  writeMap(FOLDS_KEY, map);
}

export function outlineModeOn(note: string): boolean {
  return Boolean(readMap(MODE_KEY)[note]);
}

export function setOutlineMode(note: string, on: boolean): void {
  const map = readMap(MODE_KEY);
  delete map[note];
  if (on) map[note] = ["1"];
  writeMap(MODE_KEY, map);
}

/** The palette / keyboard event both editors listen to. */
export const OUTLINE_EVENT = "lumen-outline";

export type OutlineCommand = OutlineOp | "fold" | "unfold" | "foldAll" | "unfoldAll" | "zoomIn" | "zoomOut" | "toggleMode";

export const OUTLINE_COMMANDS: readonly OutlineCommand[] = [
  "moveUp",
  "moveDown",
  "indent",
  "outdent",
  "duplicate",
  "delete",
  "fold",
  "unfold",
  "foldAll",
  "unfoldAll",
  "zoomIn",
  "zoomOut",
  "toggleMode",
];

export function runOutlineCommand(cmd: OutlineCommand): void {
  window.dispatchEvent(new CustomEvent(OUTLINE_EVENT, { detail: { cmd } }));
}
