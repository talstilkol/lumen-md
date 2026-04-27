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
import type { Extension, Range } from "@codemirror/state";
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

function buildDecorations(view: EditorView): DecorationSet {
  const widgets: Range<Decoration>[] = [];
  // Cheap fence-tracking: scan the doc once and remember which lines fall
  // inside ``` fences so we don't decorate a URL that's already wrapped.
  const doc = view.state.doc;
  const fenceLines = new Set<number>();
  let inFence = false;
  for (let i = 1; i <= doc.lines; i++) {
    const text = doc.line(i).text;
    if (/^```/.test(text.trim())) {
      inFence = !inFence;
      fenceLines.add(i);
      continue;
    }
    if (inFence) fenceLines.add(i);
  }

  for (const { from, to } of view.visibleRanges) {
    const start = doc.lineAt(from).number;
    const end = doc.lineAt(to).number;
    for (let i = start; i <= end; i++) {
      if (fenceLines.has(i)) continue;
      const line = doc.line(i);
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

  return Decoration.set(widgets, true);
}

export function embedHintExtension(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = buildDecorations(view);
        }
        update(u: ViewUpdate) {
          if (u.docChanged || u.viewportChanged) {
            this.decorations = buildDecorations(u.view);
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
