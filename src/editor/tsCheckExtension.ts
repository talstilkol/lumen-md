/**
 * TypeScript checks inside ```ts / ```tsx code blocks of the source editor:
 * type errors as wavy underlines (hover for the message) and completions
 * while typing. Opt-in ("Enable TypeScript checks in code blocks") because
 * the compiler is a multi-MB download, loaded in a worker on first use.
 */
import { StateEffect, StateField } from "@codemirror/state";
import type { Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { autocompletion } from "@codemirror/autocomplete";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { blockAt, findTsBlocks, type TsBlock } from "../lsp/tsBlocks";
import type { TsClient } from "../lsp/tsClient";
import type { TsDiagnostic } from "../lsp/tsService";

const setTsDiagnostics = StateEffect.define<DecorationSet>();

const tsDiagnosticsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const e of tr.effects) if (e.is(setTsDiagnostics)) value = e.value;
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Map diagnostics (block-relative) to document decorations. */
export function diagnosticDecorations(
  blocks: readonly TsBlock[],
  diags: readonly TsDiagnostic[],
  docLength: number,
): DecorationSet {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const ranges: Range<Decoration>[] = [];
  for (const d of diags) {
    const b = byId.get(d.id);
    if (!b) continue;
    const from = Math.min(b.from + d.start, docLength);
    const to = Math.min(Math.max(from + Math.max(d.length, 1), from + 1), Math.max(b.to, from + 1), docLength);
    if (to <= from) continue;
    ranges.push(
      Decoration.mark({
        class: `cm-ts-${d.severity}`,
        attributes: { title: `TS${d.code}: ${d.message}` },
      }).range(from, to),
    );
  }
  ranges.sort((a, b) => a.from - b.from);
  return Decoration.set(ranges, true);
}

const toInput = (blocks: readonly TsBlock[]) => blocks.map(({ id, tsx, code }) => ({ id, tsx, code }));

const theme = EditorView.baseTheme({
  ".cm-ts-error": { textDecoration: "underline wavy hsl(0 80% 60%)", textDecorationSkipInk: "none" },
  ".cm-ts-warning": { textDecoration: "underline wavy hsl(40 90% 55%)", textDecorationSkipInk: "none" },
  ".cm-ts-info": { textDecoration: "underline dotted hsl(220 14% 60%)" },
});

/** The extension; `client` is injectable for tests. */
export function tsCheckExtension(client: TsClient, opts: { debounceMs?: number } = {}): Extension {
  const debounceMs = opts.debounceMs ?? 600;
  const checker = ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | null = null;
      private run = 0;
      constructor(private view: EditorView) {
        this.schedule();
      }
      update(u: ViewUpdate) {
        if (u.docChanged) this.schedule();
      }
      schedule() {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.check(), debounceMs);
      }
      async check() {
        this.timer = null;
        const run = ++this.run;
        const doc = this.view.state.doc.toString();
        const blocks = findTsBlocks(doc);
        let deco = Decoration.none;
        if (blocks.length > 0) {
          try {
            const diags = await client.check(toInput(blocks));
            deco = diagnosticDecorations(blocks, diags, doc.length);
          } catch {
            return; // worker failed to load — leave the editor untouched
          }
        }
        // Drop stale results (the doc changed while the worker was busy).
        if (run !== this.run || this.view.state.doc.toString() !== doc) return;
        this.view.dispatch({ effects: setTsDiagnostics.of(deco) });
      }
      destroy() {
        if (this.timer) clearTimeout(this.timer);
        this.run++;
      }
    },
  );

  const source = async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const doc = ctx.state.doc.toString();
    const block = blockAt(findTsBlocks(doc), ctx.pos);
    if (!block) return null;
    const word = ctx.matchBefore(/[\w$]*/);
    const afterDot = /\.\s*$/.test(doc.slice(Math.max(block.from, ctx.pos - 2), ctx.pos - (word?.text.length ?? 0)));
    if (!ctx.explicit && !afterDot && (!word || word.text.length === 0)) return null;
    const blocks = findTsBlocks(doc);
    let items;
    try {
      items = await client.complete(toInput(blocks), block.id, ctx.pos - block.from);
    } catch {
      return null;
    }
    if (ctx.aborted) return null;
    return {
      from: word ? word.from : ctx.pos,
      options: items.map((i, n) => ({ label: i.label, type: completionType(i.kind), boost: -n / 1000 })),
      validFor: /^[\w$]*$/,
    };
  };

  return [tsDiagnosticsField, checker, theme, autocompletion({ override: [source] })];
}

function completionType(kind: string): string {
  switch (kind) {
    case "method":
    case "function":
    case "local function":
      return "function";
    case "property":
    case "getter":
    case "setter":
      return "property";
    case "class":
      return "class";
    case "interface":
    case "type":
      return "type";
    case "enum":
      return "enum";
    case "keyword":
      return "keyword";
    case "const":
      return "constant";
    default:
      return "variable";
  }
}

export { tsDiagnosticsField };
