/**
 * Cursor movement in mixed Hebrew/English text (plan W13.H1) — Word's
 * Options.CursorMovement, for both editors:
 *
 *   visual  (default) an arrow key moves the caret toward the side it points
 *           to on screen, through runs of the other direction as they are
 *           drawn. What Word, Pages and the browser do by default.
 *   logical an arrow key moves to the next or previous character in the
 *           text: the key that points toward the end of the line (Left in an
 *           RTL line) always goes forward, even inside an English word in a
 *           Hebrew line (plan 9.7's behaviour).
 *
 * Shift+arrow selects in the same model. Home/End go to the visual edges of
 * the visual line in both modes.
 *
 * A personal preference of this device, like a keyboard layout: kept in
 * localStorage and never synced or written into a note.
 */

export type CursorMovement = "visual" | "logical";
export const CURSOR_MOVEMENT_KEY = "lumen.cursorMovement";
export const CURSOR_MOVEMENT_DEFAULT: CursorMovement = "visual";

const listeners = new Set<(mode: CursorMovement) => void>();
let current: CursorMovement | null = null;

function read(): CursorMovement {
  try {
    return localStorage.getItem(CURSOR_MOVEMENT_KEY) === "logical" ? "logical" : CURSOR_MOVEMENT_DEFAULT;
  } catch {
    return CURSOR_MOVEMENT_DEFAULT;
  }
}

export function cursorMovement(): CursorMovement {
  return (current ??= read());
}

export function setCursorMovement(mode: CursorMovement): void {
  current = mode === "logical" ? "logical" : "visual";
  try {
    if (current === CURSOR_MOVEMENT_DEFAULT) localStorage.removeItem(CURSOR_MOVEMENT_KEY);
    else localStorage.setItem(CURSOR_MOVEMENT_KEY, current);
  } catch {
    // why: storage is blocked or full (private mode, quota): the setting holds for this session only
  }
  for (const l of listeners) l(current);
}

export function toggleCursorMovement(): CursorMovement {
  setCursorMovement(cursorMovement() === "visual" ? "logical" : "visual");
  return cursorMovement();
}

/** Subscribe to changes; returns the unsubscribe function. */
export function onCursorMovementChange(fn: (mode: CursorMovement) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * The settings screen writes localStorage itself and says so with a
 * `lumen-local-setting` event; another window says so with `storage`.
 * Either way the open editors switch at once.
 */
function reread(): void {
  const before = current;
  current = read();
  if (current !== before) for (const l of listeners) l(current);
}
if (typeof window !== "undefined") {
  window.addEventListener("lumen-local-setting", (e) => {
    if ((e as CustomEvent<{ id?: string }>).detail?.id === CURSOR_MOVEMENT_KEY) reread();
  });
  window.addEventListener("storage", (e) => {
    if (e.key === CURSOR_MOVEMENT_KEY || e.key === null) reread();
  });
}

/** Tests: forget the cached value so the next read goes to storage. */
export function resetCursorMovementCache(): void {
  current = null;
}
