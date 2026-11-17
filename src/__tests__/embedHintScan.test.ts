/**
 * W11.Q3 follow-up (#817): the embed-hint plugin rescanned every line of the
 * note for ``` fences on every keystroke. Now the fence index is kept per
 * transaction (only the changed lines are rescanned) and the hints are built
 * for the visible lines only.
 *
 * 1. A real 50,000-line editor: typing one character reads a handful of lines
 *    for the fences and only the visible lines for the hints.
 * 2. The incremental index agrees with a full rescan after every one of 400
 *    seeded random edits (synthetic documents, generated here).
 * 3. Opening a fence far above the viewport still hides the visible hints.
 */
import { afterEach, describe, expect, it } from "vitest";
import { EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { embedHintExtension, embedHintScanStats, FenceIndex } from "../editor/embedHintExtension";

const LINES = 50_000;
const views: EditorView[] = [];
afterEach(() => {
  for (const v of views.splice(0)) {
    v.destroy();
    v.dom.parentElement?.remove();
  }
});

const url = (i: number) => `https://youtu.be/${String(i).padStart(11, "a")}`;

function open(doc: string): EditorView {
  const host = document.createElement("div");
  host.style.cssText = "height: 600px; width: 800px; overflow: auto; position: absolute; top: 0; left: 0";
  document.body.appendChild(host);
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [EditorView.theme({ "&": { height: "600px" }, ".cm-scroller": { overflow: "auto" } }), embedHintExtension()] }),
    parent: host,
  });
  views.push(view);
  return view;
}

function visibleLines(view: EditorView): number {
  let n = 0;
  for (const { from, to } of view.visibleRanges) n += view.state.doc.lineAt(to).number - view.state.doc.lineAt(from).number + 1;
  return n;
}

const hints = (view: EditorView) => view.dom.querySelectorAll(".lumen-embed-hint").length;

/** The old plugin's rule, over the whole document: fence lines and the lines between them. */
function reference(doc: Text): boolean[] {
  const out: boolean[] = [];
  let inFence = false;
  for (let i = 1; i <= doc.lines; i++) {
    const t = doc.line(i).text;
    if (/^```/.test(t.trim())) {
      inFence = !inFence;
      out.push(true);
      continue;
    }
    out.push(inFence);
  }
  return out;
}

const covered = (idx: FenceIndex, doc: Text) => Array.from({ length: doc.lines }, (_, k) => idx.covers(doc.line(k + 1).from, doc.line(k + 1).text));

describe("embed hints read the changed and the visible lines only", () => {
  it("typing in a 50,000-line note rescans a few lines, not the note", () => {
    const view = open(Array.from({ length: LINES }, (_, i) => url(i)).join("\n"));
    expect(hints(view)).toBeGreaterThan(0);
    const visible = visibleLines(view);
    expect(visible).toBeLessThan(LINES / 10);

    const at = view.state.doc.line(5).to;
    view.dispatch({ changes: { from: at, insert: "x" } });
    expect(embedHintScanStats.fenceLines).toBeLessThanOrEqual(2);
    expect(embedHintScanStats.hintLines).toBeLessThanOrEqual(visible + 2);

    // A paste of three lines: three or four lines rescanned.
    view.dispatch({ changes: { from: view.state.doc.line(10).from, insert: "a\nb\nc\n" } });
    expect(embedHintScanStats.fenceLines).toBeLessThanOrEqual(5);
    expect(embedHintScanStats.hintLines).toBeLessThan(LINES / 10);
  });

  it("opening a fence far above the viewport hides the visible hints; closing it brings them back", () => {
    const lines = Array.from({ length: LINES }, (_, i) => url(i));
    const view = open(lines.join("\n"));
    const before = hints(view);
    expect(before).toBeLessThan(LINES / 10);
    expect(before).toBeGreaterThan(0);

    view.dispatch({ changes: { from: 0, insert: "```\n" } });
    expect(embedHintScanStats.fenceLines).toBeLessThanOrEqual(2);
    expect(hints(view)).toBe(0);

    view.dispatch({ changes: { from: view.state.doc.length, insert: "\n```" } });
    // Line 1 opens, the last line closes: everything between is fenced.
    expect(hints(view)).toBe(0);

    view.dispatch({ changes: { from: 0, to: 4 } });
    // The opening fence is gone; the last line now opens a fence that nothing follows.
    expect(hints(view)).toBe(before);
  });

  it("the incremental fence index equals a full rescan after 400 seeded random edits (synthetic)", () => {
    let seed = 0x5eed;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const pieces = ["```", "```js", "  ```", url(1), "text", "", "\n", "\n```\n", "a\nb", "``", "x```"];
    let state = EditorState.create({ doc: Array.from({ length: 300 }, (_, i) => pieces[i % pieces.length]).join("\n") });
    const idx = new FenceIndex(state.doc);
    for (let step = 0; step < 400; step++) {
      const len = state.doc.length;
      const from = rnd(len + 1);
      const to = Math.min(len, from + (rnd(3) === 0 ? rnd(40) : 0));
      const insert = rnd(4) === 0 ? "" : pieces[rnd(pieces.length)] + (rnd(2) ? "\n" : "");
      const tr = state.update({ changes: { from, to, insert } });
      state = tr.state;
      idx.update(tr.changes, state.doc);
      const got = covered(idx, state.doc);
      const want = reference(state.doc);
      if (got.join() !== want.join()) {
        const k = got.findIndex((g, i) => g !== want[i]);
        throw new Error(`step ${step}: line ${k + 1} ${JSON.stringify(state.doc.line(k + 1).text)} got ${got[k]} want ${want[k]}`);
      }
    }
    expect(idx).toBeInstanceOf(FenceIndex);
  });
});
