/**
 * Multi-select for the "Deleted and renamed files" screen (plan W13.S1):
 * click toggles one row, Shift+click selects the range from the last
 * clicked row (the anchor) to this one — the way Finder, Explorer and
 * Obsidian's deleted-files list do it. Pure, so it is tested without a DOM.
 */

/** Diacritics (Hebrew niqqud and cantillation, Latin accents) don't change what a search matches. */
export function searchKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-֑ͯ-ׇ]/g, "")
    .toLocaleLowerCase();
}

export function matches(path: string, query: string): boolean {
  const q = searchKey(query.trim());
  return !q || searchKey(path).includes(q);
}

export interface Selection {
  selected: ReadonlySet<string>;
  anchor: string | null;
  /** Where the last Shift+click / Shift+arrow range ended: the next one replaces that range (it grows and shrinks). */
  end?: string | null;
}

export const emptySelection: Selection = { selected: new Set(), anchor: null, end: null };

/**
 * The selection after a click on `id` among `visible` (the ids in screen
 * order). With `shift` and an anchor that is still visible, every row
 * between them takes the clicked row's new state; otherwise only `id`
 * toggles, and becomes the anchor.
 */
export function clickSelect(sel: Selection, visible: readonly string[], id: string, shift: boolean): Selection {
  const next = new Set(sel.selected);
  const on = !sel.selected.has(id);
  const a = sel.anchor === null ? -1 : visible.indexOf(sel.anchor);
  const b = visible.indexOf(id);
  if (shift && a >= 0 && b >= 0) {
    // The range takes the anchor's state (the anchor is what the user meant to repeat).
    const value = sel.selected.has(sel.anchor!);
    // The previous range from this anchor is undone first, so Shift+click (or Shift+↑) back towards the anchor shrinks it.
    const e = sel.end == null ? -1 : visible.indexOf(sel.end);
    if (e >= 0) {
      const [plo, phi] = a < e ? [a, e] : [e, a];
      for (let i = plo; i <= phi; i++) if (i !== a) (value ? next.delete(visible[i]) : next.add(visible[i]));
    }
    const [lo, hi] = a < b ? [a, b] : [b, a];
    for (let i = lo; i <= hi; i++) {
      if (value) next.add(visible[i]);
      else next.delete(visible[i]);
    }
    return { selected: next, anchor: sel.anchor, end: id };
  }
  if (on) next.add(id);
  else next.delete(id);
  return { selected: next, anchor: id, end: null };
}

/** Every visible row selected, or (when all already are) none. */
export function toggleAll(sel: Selection, visible: readonly string[]): Selection {
  const all = visible.length > 0 && visible.every((id) => sel.selected.has(id));
  const next = new Set(sel.selected);
  for (const id of visible) {
    if (all) next.delete(id);
    else next.add(id);
  }
  return { selected: next, anchor: sel.anchor, end: sel.end };
}

/** Only the ids that still exist (after a restore, a delete, a reload). */
export function prune(sel: Selection, existing: readonly string[]): Selection {
  const has = new Set(existing);
  return { selected: new Set([...sel.selected].filter((id) => has.has(id))), anchor: sel.anchor !== null && has.has(sel.anchor) ? sel.anchor : null, end: sel.end != null && has.has(sel.end) ? sel.end : null };
}
