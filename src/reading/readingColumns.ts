/**
 * The reading columns (plan W13.R7): source, preview and outline side by
 * side, scroll linked, and the keyboard between them.
 *
 * Ctrl+Alt+Shift+→ / ← moves the focus to the column on the right / left — in a
 * right-to-left layout the first column (the source) is on the right, so
 * the keys follow what is on screen, not the DOM order. The column that
 * got the focus is announced.
 */
import "./readingViewsStrings";
import { t } from "../i18n";
import { announce } from "../a11y/announce";
import { useAppStore } from "../store/useStore";
import { nextColumn } from "./scrollSync";

type Column = { kind: "editor" | "preview" | "outline"; el: HTMLElement; focus: HTMLElement };

const visible = (el: Element | null): el is HTMLElement => !!el && (el as HTMLElement).offsetParent !== null && el.getClientRects().length > 0;

/** The columns on screen, in DOM order. */
export function readingColumns(doc: Document = document): Column[] {
  const out: Column[] = [];
  const editor = doc.querySelector<HTMLElement>(".cm-editor");
  const content = editor?.querySelector<HTMLElement>(".cm-content");
  if (visible(editor) && content) out.push({ kind: "editor", el: editor, focus: content });
  const preview = doc.querySelector<HTMLElement>("[data-preview-root]");
  if (visible(preview)) out.push({ kind: "preview", el: preview, focus: preview });
  const outline = doc.querySelector<HTMLElement>(".outline-aside");
  if (visible(outline)) out.push({ kind: "outline", el: outline, focus: outline.querySelector<HTMLElement>("[aria-current], a, button") ?? outline });
  return out.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

function layoutDir(el: Element): "rtl" | "ltr" {
  return getComputedStyle(el).direction === "rtl" ? "rtl" : "ltr";
}

/** Move the focus one column right or left of the one that has it. Returns the column focused, or null. */
export function moveColumn(key: "ArrowLeft" | "ArrowRight", doc: Document = document): Column | null {
  const cols = readingColumns(doc);
  if (cols.length < 2) return null;
  const active = doc.activeElement;
  const cur = cols.findIndex((c) => c.el.contains(active));
  const dir = layoutDir(cols[0].el.parentElement ?? cols[0].el);
  // Nothing focused in a column: start at the first (the source).
  const next = cur < 0 ? 0 : nextColumn(cols.length, cur, key, dir);
  if (next === cur) return null;
  const col = cols[next];
  // A scroll container takes the focus without joining the Tab order: the arrow keys then scroll it.
  if (!col.focus.hasAttribute("tabindex") && col.focus.tabIndex < 0) col.focus.tabIndex = -1;
  col.focus.focus({ preventScroll: true });
  announce(t(`readingViews.column.${col.kind}`));
  return col;
}

/** The three-column preset: split view, the outline shown, scrolling linked. */
let before: { mode: ReturnType<typeof useAppStore.getState>["mode"]; showOutline: boolean; syncScroll: ReturnType<typeof useAppStore.getState>["syncScroll"] } | null = null;

/** The linked three-column view (W13.R7); the same command again goes back to the view it was opened from. */
export function openTripleView(): void {
  const s = useAppStore.getState();
  if (s.mode === "split" && s.showOutline && s.syncScroll === "all") {
    const b = before ?? { mode: "source", showOutline: false, syncScroll: s.syncScroll };
    before = null;
    s.setMode(b.mode === "split" ? "source" : b.mode);
    useAppStore.setState({ showOutline: b.showOutline, syncScroll: b.syncScroll });
    return;
  }
  before = { mode: s.mode, showOutline: s.showOutline, syncScroll: s.syncScroll };
  s.setMode("split");
  useAppStore.setState({ showOutline: true, syncScroll: "all" });
  announce(t("readingViews.triple.on"));
}
