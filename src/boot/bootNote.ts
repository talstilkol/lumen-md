/**
 * What was typed in the boot shell's note before the app loaded (plan W2.21,
 * W10.E20). public/boot.js puts the last note in a plain <textarea> before
 * the bundle has loaded; just before React replaces the shell, main.tsx
 * takes what was typed there and puts it in the open note, so no keystroke
 * is lost on the way to the editor.
 *
 * - The textarea is made read-only at the hand-off, so nothing typed between
 *   then and React's first commit can be dropped.
 * - The edit goes into the open note only when that is still the note the
 *   shell showed, with the same text. Otherwise (the vault opened another
 *   note, or the file changed) it is not written over anything: it is kept
 *   in localStorage under BOOT_EDIT_KEY for recovery, and reported.
 */
import { log } from "../lib/logger";

/** Set by public/boot.js. */
export interface BootNote {
  el: HTMLTextAreaElement;
  /** The note's name as persisted. */
  name: string;
  /** The note's whole text when the shell painted it. */
  base: string;
  /** The part of a long note the textarea does not show; it follows the textarea's text. */
  tail: string;
}

export interface BootEdit {
  name: string;
  base: string;
  content: string;
  /** The caret in the note, when the textarea had focus. */
  selection: [number, number] | null;
}

/** Where an edit that could not be applied is kept (with its note's name and time). */
export const BOOT_EDIT_KEY = "lumen-boot-edit";

type BootWindow = { __lumenBootNote?: BootNote; __lumenBootEdit?: BootEdit | null };

/** Take the boot note's edit, if there is one: the textarea becomes read-only. Null when nothing was typed. */
export function takeBootEdit(win: BootWindow = window as unknown as BootWindow): BootEdit | null {
  const note = win.__lumenBootNote;
  if (!note || !note.el) return null;
  const el = note.el;
  el.readOnly = true;
  const content = el.value + note.tail;
  if (content === note.base) return null;
  const focused = typeof document !== "undefined" && document.activeElement === el;
  const edit: BootEdit = { name: note.name, base: note.base, content, selection: focused ? [el.selectionStart, el.selectionEnd] : null };
  win.__lumenBootEdit = edit;
  return edit;
}

interface NoteStore {
  getState(): { doc: { name: string; content: string }; setContent(s: string): void };
}

/** Put `edit` in the open note when it is still the shell's note; else keep it aside. True when applied. */
export function applyBootEdit(edit: BootEdit, store: NoteStore): boolean {
  const state = store.getState();
  if (state.doc.name === edit.name && state.doc.content === edit.base) {
    state.setContent(edit.content);
    return true;
  }
  try {
    localStorage.setItem(BOOT_EDIT_KEY, JSON.stringify({ name: edit.name, content: edit.content, at: Date.now() }));
  } catch {
    /* why: storage full or denied: the edit is still on window.__lumenBootEdit for this session */
  }
  log.warn("[boot] the note typed in before the app loaded is not the open note any more; kept under " + BOOT_EDIT_KEY);
  return false;
}
