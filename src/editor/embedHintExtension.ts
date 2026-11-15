/**
 * CodeMirror extension that highlights bare URLs Lumen knows how to embed and
 * lets the user wrap them in an ```embed fence with a single click.
 *
 * For each line whose entire content is a recognised URL (and is NOT already
 * inside a fenced code block), a small pill is rendered at end-of-line with
 * the platform name. Clicking it dispatches a transaction that:
 *   1. Replaces the URL line with three lines: opening fence, the URL, and
 *      closing fence.
 *   2. Repositions the selection just below the closing fence.
 */

import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import type { ChangeSet, Extension, Range, Text } from "@codemirror/state";
import { detectEmbed } from "../data/embedDetect";

class EmbedHintWidget extends WidgetType {
  constructor(
    private readonly platform: string,
    private readonly lineFrom: number,
    private readonly lineTo: number,
    private readonly url: string,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("button");
    span.type = "button";
    span.className = "lumen-embed-hint";
    span.title = `Wrap as ${this.platform} embed`;
    span.setAttribute(
      "aria-label",
      `Wrap ${this.platform} link in an embed block`,
    );
    span.textContent = `↵ wrap as ${this.platform} embed`;
    span.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const wrapped = `\`\`\`embed\n${this.url}\n\`\`\``;
      view.dispatch({
        changes: { from: this.lineFrom, to: this.lineTo, insert: wrapped },
        selection: { anchor: this.lineFrom + wrapped.length },
      });
      view.focus();
    });
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }

  eq(other: EmbedHintWidget): boolean {
    return (
      other.platform === this.platform &&
      other.url === this.url &&
      other.lineFrom === this.lineFrom &&
      other.lineTo === this.lineTo
    );
  }
}

const isFenceLine = (text: string) => /^```/.test(text.trim());

/**
 * What the last build read, for the scaling test: `fenceLines` is how many
 * lines the fence index rescanned, `hintLines` how many lines were checked
 * for an embed URL. Both follow the changed and the visible lines, not the
 * note's length (W11.Q3 follow-up).
 */
export const embedHintScanStats = { fenceLines: 0, hintLines: 0 };

/**
 * The start offsets of every ``` line, sorted. A line is inside a fence when
 * an odd number of fence lines start before it. Built once per document by a
 * full scan, then kept current per transaction: the offsets are mapped
 * through the change, and only the lines a change touched are rescanned.
 */
export class FenceIndex {
  private starts: number[] = [];

  constructor(doc: Text) {
    this.starts = [];
    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i);
      if (isFenceLine(line.text)) this.starts.push(line.from);
    }
    embedHintScanStats.fenceLines = doc.lines;
  }

  update(changes: ChangeSet, doc: Text): void {
    // Map every fence start into the new document. A start inside a changed
    // range lands on that range and is rescanned below.
    let mapped = this.starts.map((p) => changes.mapPos(p, 1));
    // The changed line spans in the new document, merged.
    const spans: Array<[number, number]> = [];
    changes.iterChangedRanges((_fA: number, _tA: number, fromB: number, toB: number) => {
      const from = doc.lineAt(fromB).from;
      const to = doc.lineAt(toB).to;
      const last = spans[spans.length - 1];
      if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
      else spans.push([from, to]);
    });
    let scanned = 0;
    for (const [from, to] of spans) {
      mapped = mapped.filter((p) => p < from || p > to);
      for (let pos = from; pos <= to; ) {
        const line = doc.lineAt(pos);
        scanned++;
        if (isFenceLine(line.text)) mapped.push(line.from);
        pos = line.to + 1;
      }
    }
    mapped.sort((a, b) => a - b);
    this.starts = mapped.filter((p, i) => i === 0 || p !== mapped[i - 1]);
    embedHintScanStats.fenceLines = scanned;
  }

  /** Fence lines that start before `pos`. */
  private before(pos: number): number {
    let lo = 0;
    let hi = this.starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.starts[mid] < pos) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** True when the line starting at `lineFrom` is a fence line or inside a fence. */
  covers(lineFrom: number, text: string): boolean {
    return isFenceLine(text) || this.before(lineFrom) % 2 === 1;
  }
}

function buildDecorations(view: EditorView, fences: FenceIndex): DecorationSet {
  const widgets: Range<Decoration>[] = [];
  const doc = view.state.doc;
  let checked = 0;
  for (const { from, to } of view.visibleRanges) {
    const start = doc.lineAt(from).number;
    const end = doc.lineAt(to).number;
    for (let i = start; i <= end; i++) {
      const line = doc.line(i);
      checked++;
      if (fences.covers(line.from, line.text)) continue;
      const text = line.text.trim();
      if (!text) continue;
      const platform = detectEmbed(text);
      if (!platform) continue;
      widgets.push(
        Decoration.widget({
          widget: new EmbedHintWidget(platform, line.from, line.to, text),
          side: 1,
        }).range(line.to),
      );
    }
  }
  embedHintScanStats.hintLines = checked;
  return Decoration.set(widgets, true);
}

export function embedHintExtension(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        fences: FenceIndex;
        constructor(view: EditorView) {
          this.fences = new FenceIndex(view.state.doc);
          this.decorations = buildDecorations(view, this.fences);
        }
        update(u: ViewUpdate) {
          // Per keystroke: the changed lines for the fence index, the visible
          // lines for the hints. Never the whole note.
          if (u.docChanged) this.fences.update(u.changes, u.state.doc);
          if (u.docChanged || u.viewportChanged) {
            this.decorations = buildDecorations(u.view, this.fences);
          }
        }
      },
      {
        decorations: (v) => v.decorations,
      },
    ),
    EditorView.baseTheme({
      ".lumen-embed-hint": {
        marginInlineStart: "10px",
        padding: "1px 8px",
        fontSize: "10px",
        fontWeight: "500",
        fontFamily: "Inter, ui-sans-serif, system-ui",
        color: "hsl(var(--accent))",
        background: "hsl(var(--accent) / 0.10)",
        border: "1px solid hsl(var(--accent) / 0.30)",
        borderRadius: "999px",
        cursor: "pointer",
        verticalAlign: "middle",
        transition: "background 120ms ease, color 120ms ease",
      },
      ".lumen-embed-hint:hover": {
        background: "hsl(var(--accent))",
        color: "white",
      },
    }),
  ];
}
