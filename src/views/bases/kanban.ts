/**
 * The Bases kanban view, as Obsidian 1.14's help describes it (plan W12.T5;
 * https://obsidian.md/help/bases/views/kanban). Pure: columns, and what a
 * card dropped on another column changes. BasesBlock.tsx draws it.
 *
 * - Every value of the grouped property is a column; notes with no value are
 *   in the **None** column ("Grouping cards into columns").
 * - With `groupOrder:` the columns are the listed values in that order, an
 *   empty one included, so a card can be dropped on it; `null` is None.
 * - Dropping a card on another column **writes the grouped property** of
 *   that note; only Markdown notes can move ("Moving cards").
 * - Grouped by **`file.folder`**, dropping moves the file to that folder.
 * - Grouped by a **formula**, or by another **file property**, cards and
 *   columns cannot be moved: the view is read-only for drags.
 */
import { setProperty, type PropertyValue } from "../../properties/frontmatter";
import type { BaseResult, BaseRow } from "./base";
import { isEmptyValue, isTagged, toText, type BValue } from "./values";

export type KanbanGrouping = { kind: "property"; key: string } | { kind: "folder" } | { kind: "readOnly"; reason: "formula" | "file" };

/** What a drag may do in a view grouped by `property` (a property id: note.x, file.x, formula.x). */
export function kanbanGrouping(property: string): KanbanGrouping {
  if (property === "file.folder") return { kind: "folder" };
  if (property.startsWith("formula.")) return { kind: "readOnly", reason: "formula" };
  if (property.startsWith("file.") || property.startsWith("relation.") || property.startsWith("rollup.")) return { kind: "readOnly", reason: "file" };
  return { kind: "property", key: property.replace(/^note\./, "") };
}

export interface KanbanColumn {
  /** The column's value as text (null: the None column). */
  key: string | null;
  /** The value as the notes hold it (for writing it back), null for None. */
  value: BValue;
  rows: BaseRow[];
}

const keyText = (v: BValue): string | null => (isEmptyValue(v) ? null : isTagged(v) && v.$ === "link" ? v.path : toText(v));

/**
 * The columns of a kanban result: with `groupOrder`, exactly those values in
 * that order (empty columns too); otherwise every group, None last when the
 * engine put it there.
 */
export function kanbanColumns(result: BaseResult): KanbanColumn[] {
  const groups = result.groups ?? [];
  const order = result.view.groupOrder;
  if (!order) return groups.map((g) => ({ key: keyText(g.key), value: isEmptyValue(g.key) ? null : g.key, rows: g.rows }));
  return order.map((want) => {
    const g = groups.find((x) => keyText(x.key) === want);
    return { key: want, value: g ? (isEmptyValue(g.key) ? null : g.key) : want, rows: g ? g.rows : [] };
  });
}

export type KanbanMove =
  | { kind: "set"; path: string; key: string; value: PropertyValue }
  | { kind: "move"; from: string; to: string }
  | { kind: "refuse"; reason: "formula" | "file" | "notMarkdown" | "same" };

/** The frontmatter value a column stands for: numbers stay numbers, links `[[…]]`, None empty. */
function writeValue(column: KanbanColumn, old: unknown): PropertyValue {
  const v = column.value;
  if (column.key === null || v === null) return null;
  if (typeof v === "number" || typeof v === "boolean") return v;
  // A link column writes the link; any other value (a date, an object) writes the column's text.
  const text = isTagged(v) && v.$ === "link" ? `[[${v.path}]]` : typeof v === "string" ? v : column.key;
  // A list property stays a list (Obsidian writes the column's value as the one item).
  return Array.isArray(old) ? [text] : text;
}

/** What dropping `row` on `to` does, grouped by `property`. */
export function planKanbanMove(row: BaseRow, property: string, to: KanbanColumn): KanbanMove {
  const g = kanbanGrouping(property);
  if (g.kind === "readOnly") return { kind: "refuse", reason: g.reason };
  if (g.kind === "folder") {
    const folder = (to.key ?? "").replace(/^\/+|\/+$/g, "");
    if (folder === row.file.folder) return { kind: "refuse", reason: "same" };
    return { kind: "move", from: row.file.path, to: folder ? `${folder}/${row.file.name}` : row.file.name };
  }
  if (row.file.ext !== "md") return { kind: "refuse", reason: "notMarkdown" };
  const now = keyText(row.cells[property] ?? null);
  if (now === to.key) return { kind: "refuse", reason: "same" };
  return { kind: "set", path: row.file.path, key: g.key, value: writeValue(to, row.file.fm[g.key]) };
}

/** The note's text after a "set" move: only that property changes. */
export function applyKanbanSet(text: string, move: Extract<KanbanMove, { kind: "set" }>): string {
  return setProperty(text, move.key, move.value);
}

/**
 * Keyboard: Alt + ArrowLeft / ArrowRight moves the focused card to the
 * neighbouring column, as the text runs (in RTL, Alt+ArrowLeft is the next
 * column). Returns the target column index, or null.
 */
export function kanbanKeyTarget(key: string, mods: { alt?: boolean; rtl?: boolean }, column: number, columns: number): number | null {
  if (!mods.alt) return null;
  const fwd = mods.rtl ? -1 : 1;
  const step = key === "ArrowRight" ? fwd : key === "ArrowLeft" ? -fwd : 0;
  if (!step) return null;
  const next = column + step;
  return next < 0 || next >= columns ? null : next;
}

/* ─── Cards and kanban cover images (Obsidian: Image property, Image fit, Image aspect ratio) ─── */

export interface CoverStyle {
  /** `cover` fills and crops, `contain` fits without cropping (view key `imageFit`). */
  fit: "cover" | "contain";
  /** Height ÷ width of the cover (view key `imageAspectRatio`); null: the default height. */
  ratio: number | null;
}

export function coverStyle(view: { imageFit?: string; imageAspectRatio?: number }): CoverStyle {
  return { fit: view.imageFit === "contain" ? "contain" : "cover", ratio: typeof view.imageAspectRatio === "number" && view.imageAspectRatio > 0 && view.imageAspectRatio <= 10 ? view.imageAspectRatio : null };
}

/**
 * What a cover value shows (the cards view's Image property): an https
 * image, or a colour (`#rgb`, `#rrggbb`) as a filled box; anything else
 * shows no cover. Vault image links are resolved by the caller.
 */
export function coverOf(v: BValue): { src: string } | { color: string } | { link: string } | null {
  if (v === null) return null;
  if (isTagged(v)) {
    if (v.$ === "image" && /^https:\/\//i.test(v.src)) return { src: v.src };
    if (v.$ === "link") return { link: v.path };
    return null;
  }
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(s)) return { color: s };
  if (/^https:\/\//i.test(s)) return { src: s };
  return null;
}
