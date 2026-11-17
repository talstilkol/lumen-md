/**
 * W13.E5 — multiple cursors and rectangular selection, with right-to-left
 * and mixed lines.
 *
 * Mod+D, Esc and typing with several cursors run on a CodeMirror state. The
 * rectangle (Alt+drag) needs layout: it runs on a real EditorView with real
 * mouse events over a Hebrew Markdown table where a browser lays it out
 * (Chromium), and says so where there is no layout (happy-dom).
 * 15 tests, 6 of them on Hebrew text. Plus the key-map check.
 */
import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState, type Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { multiCursorExtension, rectangleFilter, selectNextOccurrence, singleCursor, wordAt } from "../editor/multiCursor";
import { SHORTCUTS } from "../lib/shortcuts";

function run(doc: string, sel: EditorSelection, cmd: typeof selectNextOccurrence): EditorState {
  let state = EditorState.create({ doc, selection: sel, extensions: [EditorState.allowMultipleSelections.of(true)] });
  cmd({ state, dispatch: (tr: Transaction) => (state = tr.state) });
  return state;
}
const texts = (s: EditorState) => s.selection.ranges.map((r) => s.sliceDoc(r.from, r.to));
const froms = (s: EditorState) => s.selection.ranges.map((r) => r.from);

describe("Mod+D — the next occurrence", () => {
  it("from a cursor: selects the word under it", () => {
    const s = run("foo bar foo", EditorSelection.single(1), selectNextOccurrence);
    expect(texts(s)).toEqual(["foo"]);
  });

  it("then adds the next whole word, skipping a word that only contains it", () => {
    let s = run("foo food foo", EditorSelection.single(1), selectNextOccurrence);
    s = run(s.doc.toString(), s.selection, selectNextOccurrence);
    expect(froms(s)).toEqual([0, 9]);
  });

  it("from a selection: any exact match, wrapping around the end", () => {
    // "ab xx ab ab": the middle "ab" selected; the next is the last one, then the first (wrapped).
    let s = run("ab xx ab ab", EditorSelection.single(6, 8), selectNextOccurrence);
    expect(froms(s)).toEqual([6, 9]);
    s = run(s.doc.toString(), s.selection, selectNextOccurrence);
    expect(froms(s).sort((a, b) => a - b)).toEqual([0, 6, 9]);
  });

  it("stops when every occurrence is selected", () => {
    let s = run("x y x", EditorSelection.single(0), selectNextOccurrence);
    s = run(s.doc.toString(), s.selection, selectNextOccurrence);
    const before = s.selection.ranges.length;
    s = run(s.doc.toString(), s.selection, selectNextOccurrence);
    expect(s.selection.ranges.length).toBe(before);
  });

  it("Hebrew: a pointed word is one word, matched exactly", () => {
    const doc = "שָׁלוֹם וְשָׁלוֹם שָׁלוֹם";
    let s = run(doc, EditorSelection.single(2), selectNextOccurrence);
    expect(texts(s)).toEqual(["שָׁלוֹם"]);
    s = run(doc, s.selection, selectNextOccurrence);
    // "וְשָׁלוֹם" (with the prefix ו) is another word: the next match is the third.
    expect(froms(s)).toEqual([0, doc.lastIndexOf("שָׁלוֹם")]);
  });

  it("Hebrew: gershayim stay inside the word (צה״ל)", () => {
    const s = run("שירות בצה״ל וצה״ל צה״ל", EditorSelection.single("שירות בצה״ל וצה״ל צ".length), selectNextOccurrence);
    expect(texts(s)).toEqual(["צה״ל"]);
    expect(wordAt(s, 1)).toEqual({ from: 0, to: "שירות".length });
  });
});

describe("Esc and typing", () => {
  it("Esc with several cursors keeps the main one", () => {
    const sel = EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(4)], 1);
    const s = run("abc def", sel, singleCursor);
    expect(s.selection.ranges.length).toBe(1);
    expect(s.selection.main.head).toBe(4);
  });

  it("Esc with one cursor is not handled (it goes on to close menus, cancel AI…)", () => {
    const state = EditorState.create({ doc: "abc" });
    expect(singleCursor({ state, dispatch: () => {} })).toBe(false);
  });

  it("typing with a cursor on each Hebrew row inserts on every row", () => {
    const doc = "| שם | עיר |\n| דנה | חיפה |\n| יוסי | אילת |";
    const lines = doc.split("\n");
    const at = (n: number) => lines.slice(0, n).reduce((a, l) => a + l.length + 1, 0) + 2;
    let state = EditorState.create({ doc, selection: EditorSelection.create([0, 1, 2].map((n) => EditorSelection.cursor(at(n)))), extensions: [EditorState.allowMultipleSelections.of(true)] });
    state = state.update(state.replaceSelection("* ")).state;
    expect(state.doc.toString().split("\n").map((l) => l.slice(2, 4))).toEqual(["* ", "* ", "* "]);
  });

  it("Mod+D on a mixed line (Hebrew and English) finds the English word exactly", () => {
    const doc = "הקובץ README וגם README.md";
    let s = run(doc, EditorSelection.single(doc.indexOf("README") + 1), selectNextOccurrence);
    s = run(doc, s.selection, selectNextOccurrence);
    expect(froms(s)).toEqual([doc.indexOf("README"), doc.lastIndexOf("README")]);
  });
});

describe("keys", () => {
  it("Alt alone starts a rectangle; Ctrl/⌘ + Alt (the Hebrew-layout shortcuts) and Shift do not", () => {
    const ev = (o: Partial<MouseEvent>) => ({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...o }) as MouseEvent;
    expect(rectangleFilter(ev({ altKey: true }))).toBe(true);
    expect(rectangleFilter(ev({ altKey: true, ctrlKey: true }))).toBe(false);
    expect(rectangleFilter(ev({ altKey: true, metaKey: true }))).toBe(false);
    expect(rectangleFilter(ev({ altKey: true, shiftKey: true }))).toBe(false);
  });

  it("Mod+D is listed once and collides with no other shortcut", () => {
    const combos = SHORTCUTS.map((s) => s.combo);
    expect(combos.filter((c) => c === "Mod+D")).toHaveLength(1);
    expect(new Set(combos).size).toBe(combos.length);
  });
});

/* ─── The rectangle, on a laid-out editor ───────────────────────────── */

const hasLayout = (() => {
  if (typeof document === "undefined") return false;
  const d = document.createElement("div");
  d.style.cssText = "position:absolute;width:37px;height:11px";
  document.body.appendChild(d);
  const ok = d.getBoundingClientRect().width === 37;
  d.remove();
  return ok;
})();

function editor(doc: string, dir: "rtl" | "ltr"): EditorView {
  const parent = document.createElement("div");
  parent.style.cssText = "width:600px;font:16px monospace;position:absolute;top:0;left:0";
  parent.dir = dir;
  document.body.appendChild(parent);
  return new EditorView({ state: EditorState.create({ doc, extensions: [multiCursorExtension(), EditorView.theme({ ".cm-content": { fontFamily: "monospace" } })] }), parent });
}

/** Alt+drag from the character at `a` to the character at `b` (document offsets), with real mouse events. */
function altDrag(view: EditorView, a: number, b: number): void {
  const ra = view.coordsAtPos(a)!;
  const rb = view.coordsAtPos(b)!;
  const opts = (x: number, y: number) => ({ clientX: x, clientY: y, altKey: true, bubbles: true, cancelable: true, button: 0, buttons: 1, detail: 1 });
  view.contentDOM.dispatchEvent(new MouseEvent("mousedown", opts(ra.left + 1, (ra.top + ra.bottom) / 2)));
  view.contentDOM.dispatchEvent(new MouseEvent("mousemove", opts(rb.left + 1, (rb.top + rb.bottom) / 2)));
  document.dispatchEvent(new MouseEvent("mousemove", opts(rb.left + 1, (rb.top + rb.bottom) / 2)));
  document.dispatchEvent(new MouseEvent("mouseup", opts(rb.left + 1, (rb.top + rb.bottom) / 2)));
}

const TABLE_HE = "| שם   | עיר  |\n| ---- | ---- |\n| דנה  | חיפה |\n| יוסי | אילת |";
const TABLE_EN = "| name | city |\n| ---- | ---- |\n| dana | hifa |\n| yosi | eilt |";

describe("Alt+drag: a rectangle", () => {
  (hasLayout ? it : it.skip)(
    hasLayout ? "in a Hebrew table: one range per row, the same columns on every row" : "in a Hebrew table — skipped here: happy-dom has no layout (runs in Chromium: V4=browser)",
    () => {
      const view = editor(TABLE_HE, "rtl");
      const lines = TABLE_HE.split("\n");
      const start = 2; // the first cell's text, row 1
      const endRow = 3;
      const endOff = lines.slice(0, endRow).reduce((n, l) => n + l.length + 1, 0) + 5;
      altDrag(view, start, endOff);
      const s = view.state;
      expect(s.selection.ranges.length).toBe(4);
      const cols = s.selection.ranges.map((r) => [r.from - s.doc.lineAt(r.from).from, r.to - s.doc.lineAt(r.to).from]);
      expect(new Set(cols.map((c) => c.join(","))).size).toBe(1);
      view.destroy();
    },
  );

  (hasLayout ? it : it.skip)(
    hasLayout ? "in a Hebrew table dragged the other way (bottom to top): the same rectangle" : "in a Hebrew table, dragged bottom to top — skipped here: happy-dom has no layout (runs in Chromium: V4=browser)",
    () => {
      const view = editor(TABLE_HE, "rtl");
      const lines = TABLE_HE.split("\n");
      const endOff = lines.slice(0, 3).reduce((n, l) => n + l.length + 1, 0) + 5;
      altDrag(view, endOff, 2);
      expect(view.state.selection.ranges.length).toBe(4);
      const firstRow = view.state.selection.ranges[0];
      expect(view.state.sliceDoc(firstRow.from, firstRow.to)).toBe("שם ");
      view.destroy();
    },
  );

  (hasLayout ? it : it.skip)(
    hasLayout ? "in an English table the same way (the control)" : "in an English table — skipped here: happy-dom has no layout (runs in Chromium: V4=browser)",
    () => {
      const view = editor(TABLE_EN, "ltr");
      const lines = TABLE_EN.split("\n");
      const endOff = lines.slice(0, 3).reduce((n, l) => n + l.length + 1, 0) + 5;
      altDrag(view, 2, endOff);
      expect(view.state.selection.ranges.length).toBe(4);
      expect(view.state.selection.ranges.map((r) => view.state.sliceDoc(r.from, r.to))).toEqual(["nam", "---", "dan", "yos"]);
      view.destroy();
    },
  );
});
