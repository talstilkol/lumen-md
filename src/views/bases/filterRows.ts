/**
 * The filter rows of a `.base` for the filter editor (plan W12.T5, Obsidian
 * 1.15: "Filters can be dragged to reorder. Each filter row also has a menu
 * for adding filters or moving them between All views and This view").
 * A row is one statement of a top-level `and:` list, or the whole filter
 * when it is a single statement or another kind of group; `moveFilter`
 * (base.ts) writes the move into the file.
 */
import type { BaseModel, BasesFilter, FilterScope } from "./base";

export interface FilterRow {
  scope: FilterScope;
  index: number;
  /** As shown: the statement, or a group in short form. */
  text: string;
}

export function filterText(f: BasesFilter): string {
  if (typeof f === "string") return f;
  if ("and" in f) return `and(${f.and.map(filterText).join(", ")})`;
  if ("or" in f) return `or(${f.or.map(filterText).join(", ")})`;
  return `not(${f.not.map(filterText).join(", ")})`;
}

function rowsOf(f: BasesFilter | undefined, scope: FilterScope): FilterRow[] {
  if (f === undefined) return [];
  if (typeof f !== "string" && "and" in f) return f.and.map((x, index) => ({ scope, index, text: filterText(x) }));
  return [{ scope, index: 0, text: filterText(f) }];
}

/** The rows of All views (`filters:`) and of one view (`views[i].filters:`). */
export function filterRows(base: BaseModel, view: number): { all: FilterRow[]; view: FilterRow[] } {
  return { all: rowsOf(base.filters, { view: null }), view: rowsOf(base.views[view]?.filters, { view }) };
}

/** Keyboard (Alt+ArrowUp / Alt+ArrowDown) and drop targets: where a row goes, or null. */
export function filterKeyTarget(key: string, alt: boolean, row: FilterRow, count: number): FilterRow["index"] | null {
  if (!alt) return null;
  const to = key === "ArrowUp" ? row.index - 1 : key === "ArrowDown" ? row.index + 1 : null;
  return to === null || to < 0 || to >= count ? null : to;
}
