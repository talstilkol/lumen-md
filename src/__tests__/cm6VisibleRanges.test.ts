/**
 * W11.Q3 (research R5.6): editor ceilings, part 1. Every CodeMirror plugin
 * that derives decorations from the document's text must build them for
 * `view.visibleRanges` only, not for the whole document: decorating the whole
 * document is what makes typing slow in a long note
 * (https://codemirror.net/examples/million/).
 *
 * For each plugin, a 50,000-line note where every line triggers the plugin
 * once is opened in a 600 px editor. The plugin may decorate at most twice
 * as many ranges as there are visible lines, and none far outside the
 * viewport. A control plugin that decorates every line of the document
 * must fail the same check.
 *
 * The audit (src/editor, src/related, src/canvas, every `Decoration.` user):
 *
 * | Plugin | Source of its ranges | Visible only |
 * |---|---|---|
 * | bidi.ts (line `dir`) | document text | yes — tested |
 * | bidiMarks.ts (control-character tags) | document text | yes — tested |
 * | tashkeelView.ts (hide marks) | document text | yes — tested |
 * | mathBidi.ts (`$…$` isolates) | document text | yes — tested |
 * | obsidianSource.ts (`%%`, `==`, callouts) | document text | whole note under 20,000 chars, else visible — tested |
 * | embedHintExtension.ts (embed hints) | document text | yes — tested; its fence index rescans only the changed lines (embedHintScan.test.ts) |
 * | searchHighlight.ts (search hits) | document text | **was the whole document (up to 200 hits); now visible — tested** |
 * | outlineExtension.ts (zoom) | the zoomed section: 2 ranges | constant |
 * | speechHighlight.ts, suggestingExtension.ts, aiAuthorship.ts, commentDecorations.ts | a range per spoken word / suggestion / AI span / comment | data, not text |
 * | lintExtension.ts, grammarExtension.ts, tsCheckExtension.ts | a range per diagnostic | data, not text |
 * | collabAwareness.ts, ghostText.ts, inlineSuggestion.ts, related/editorPlugin.ts | a cursor or a suggestion at the cursor | constant |
 *
 * "Data, not text" plugins draw what another engine returned; their count
 * follows that engine's result, not the note's length.
 */
import { afterEach, describe, expect, it } from "vitest";
import { EditorState, type Extension, RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { bidiExtension } from "../editor/bidi";
import { bidiMarksExtension } from "../editor/bidiMarks";
import { toggleTashkeel } from "../editor/tashkeelView";
import { mathBidiExtension } from "../editor/mathBidi";
import { obsidianSourceExtension } from "../editor/obsidianSource";
import { embedHintExtension } from "../editor/embedHintExtension";
import { flashSearchHighlight, searchHighlightExtension } from "../editor/searchHighlight";

const LINES = 50_000;

/**
 * bidi.ts and obsidianSource.ts read the syntax tree. Where @codemirror/language
 * is not installed (the offline shim stubs it), those two cases are skipped
 * with this reason; with the real package (vitest on the Mac) they run.
 */
const NO_LANGUAGE = (() => {
  try {
    syntaxTree(EditorState.create({ doc: "" }));
    return null;
  } catch (e) {
    return `@codemirror/language is not installed here (${(e as Error).message.slice(0, 60)})`;
  }
})();
const views: EditorView[] = [];

afterEach(() => {
  for (const v of views.splice(0)) {
    v.destroy();
    v.dom.parentElement?.remove();
  }
});

function open(line: (i: number) => string, extensions: Extension): EditorView {
  const host = document.createElement("div");
  host.style.cssText = "height: 600px; width: 800px; overflow: auto; position: absolute; top: 0; left: 0";
  document.body.appendChild(host);
  const doc = Array.from({ length: LINES }, (_, i) => line(i)).join("\n");
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [EditorView.theme({ "&": { height: "600px" }, ".cm-scroller": { overflow: "auto" } }), extensions] }),
    parent: host,
  });
  views.push(view);
  return view;
}

/** Every range of every decoration source in the view, with its position. */
function ranges(view: EditorView): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  for (const src of view.state.facet(EditorView.decorations)) {
    const set: DecorationSet = typeof src === "function" ? src(view) : src;
    set.between(0, view.state.doc.length, (from, to) => {
      out.push({ from, to });
    });
  }
  return out;
}

/** The visible lines (CodeMirror renders a margin around the viewport; those count as visible). */
function visibleLines(view: EditorView): number {
  let n = 0;
  for (const { from, to } of view.visibleRanges) n += view.state.doc.lineAt(to).number - view.state.doc.lineAt(from).number + 1;
  return n;
}

/** The check of W11.Q3: ≤ 2× the visible lines, and nothing more than one viewport away. */
function check(view: EditorView, plugin: string) {
  const all = ranges(view);
  const visible = visibleLines(view);
  const { from, to } = view.viewport;
  const span = to - from;
  const far = all.filter((r) => r.to < from - span || r.from > to + span);
  return { plugin, ranges: all.length, visible, far: far.length, ok: all.length <= 2 * visible && far.length === 0 };
}

/** A control: decorates every line of the document (the pattern Q3 forbids). */
const wholeDocument = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      const b = new RangeSetBuilder<Decoration>();
      const line = Decoration.line({ class: "cm-every-line" });
      for (let n = 1; n <= view.state.doc.lines; n++) b.add(view.state.doc.line(n).from, view.state.doc.line(n).from, line);
      this.decorations = b.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

describe("CodeMirror plugins decorate the visible ranges only (W11.Q3)", () => {
  it("the editor shows a small part of a 50,000-line note", () => {
    const view = open((i) => `line ${i}`, []);
    expect(view.state.doc.lines).toBe(LINES);
    expect(visibleLines(view)).toBeGreaterThan(0);
    expect(visibleLines(view)).toBeLessThan(LINES / 10);
  });

  it("the check fails on a plugin that decorates the whole document", () => {
    const r = check(open((i) => `line ${i}`, wholeDocument), "control");
    expect(r.ranges).toBe(LINES);
    expect(r.ok).toBe(false);
  });

  const cases: Array<[string, (i: number) => string, Extension, ((v: EditorView) => void)?]> = [
    ["bidiMarks (control tags)", (i) => `a\u202e${i}`, bidiMarksExtension()],
    ["tashkeel (hidden marks)", (i) => `مرحبًا ${i}`, [], (v) => toggleTashkeel(v)],
    ["mathBidi (inline math)", (i) => `x $a_${i}$ y`, mathBidiExtension()],
    ["embedHint (embed lines)", (i) => `https://youtu.be/${String(i).padStart(11, "a")}`, embedHintExtension()],
    ["searchHighlight (search hits)", (i) => `needle ${i}`, searchHighlightExtension(), () => flashSearchHighlight("needle")],
  ];

  const needsTree: typeof cases = [
    ["bidi (line direction)", (i) => (i % 2 ? `שורה ${i} with English` : `line ${i} עם עברית`), bidiExtension()],
    ["obsidianSource (comments)", (i) => `t %%c${i}%%`, obsidianSourceExtension],
  ];

  const run = (name: string, line: (i: number) => string, ext: Extension, after?: (v: EditorView) => void) => {
    const view = open(line, ext);
    after?.(view);
    const r = check(view, name);
    expect(r.ranges, `${name}: no decorations at all means the trigger line is wrong`).toBeGreaterThan(0);
    expect(r, `${name}: ${r.ranges} ranges for ${r.visible} visible lines, ${r.far} far outside`).toMatchObject({ ok: true });
  };

  it.each(cases)("%s", run);
  // skip-reason: the syntax-tree cases need @codemirror/language, which a partial install may lack; the reason is printed in the title | task: W11.Q3 | until: 2027-05-16
  describe.skipIf(NO_LANGUAGE !== null)(`with the syntax tree${NO_LANGUAGE ? ` — skipped: ${NO_LANGUAGE}` : ""}`, () => {
    it.each(needsTree)("%s", run);
  });
});
