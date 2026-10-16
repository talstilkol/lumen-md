/**
 * The editor side of TypeScript checks: requests go to the (injected)
 * client, results become decorations at document offsets, stale results
 * are dropped, and completions only trigger inside ts blocks.
 */
import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tsCheckExtension, tsDiagnosticsField, diagnosticDecorations } from "../editor/tsCheckExtension";
import { findTsBlocks } from "../lsp/tsBlocks";
import type { TsClient } from "../lsp/tsClient";
import type { TsDiagnostic } from "../lsp/tsService";

const DOC = "Intro\n\n```ts\nconst n: number = 'x';\n```\n";

function fakeClient(over: Partial<TsClient> = {}): TsClient {
  return {
    check: vi.fn(async () => [
      { id: "block-0", start: 6, length: 1, message: "Type 'string' is not assignable to type 'number'.", severity: "error" as const, code: 2322 },
    ]),
    complete: vi.fn(async () => [{ label: "toFixed", kind: "method", sort: "11" }]),
    dispose: vi.fn(),
    ...over,
  };
}

const titlesOf = (view: EditorView) => {
  const out: Array<[string, string]> = [];
  view.state.field(tsDiagnosticsField).between(0, view.state.doc.length, (from, to, d) => {
    out.push([view.state.doc.sliceString(from, to), String((d.spec as { attributes: { title: string } }).attributes.title)]);
  });
  return out;
};

describe("tsCheckExtension", () => {
  it("underlines diagnostics at the right document position", async () => {
    const client = fakeClient();
    const view = new EditorView({
      state: EditorState.create({ doc: DOC, extensions: [tsCheckExtension(client, { debounceMs: 0 })] }),
      parent: document.body,
    });
    await vi.waitFor(() => expect(titlesOf(view)).toEqual([["n", "TS2322: Type 'string' is not assignable to type 'number'."]]));
    expect(client.check).toHaveBeenCalledWith([{ id: "block-0", tsx: false, code: "const n: number = 'x';" }]);
    view.destroy();
  });

  it("drops results that arrive after the document changed", async () => {
    let release: (() => void) | null = null;
    const client = fakeClient({
      check: vi.fn(
        () =>
          new Promise<TsDiagnostic[]>((resolve) => {
            release = () =>
              resolve([{ id: "block-0", start: 0, length: 5, message: "stale", severity: "error" as const, code: 1 }]);
          }),
      ),
    });
    const view = new EditorView({
      state: EditorState.create({ doc: DOC, extensions: [tsCheckExtension(client, { debounceMs: 0 })] }),
      parent: document.body,
    });
    await vi.waitFor(() => expect(release).not.toBeNull());
    view.dispatch({ changes: { from: 0, insert: "X" } });
    release!();
    await new Promise((r) => setTimeout(r, 10));
    expect(titlesOf(view).some(([, t]) => t.includes("stale"))).toBe(false);
    view.destroy();
  });

  it("does not call the worker for documents without ts blocks", async () => {
    const client = fakeClient();
    const view = new EditorView({
      state: EditorState.create({ doc: "no code here", extensions: [tsCheckExtension(client, { debounceMs: 0 })] }),
      parent: document.body,
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(client.check).not.toHaveBeenCalled();
    view.destroy();
  });

  it("maps block-relative ranges and clamps them to the block", () => {
    const blocks = findTsBlocks(DOC);
    const set = diagnosticDecorations(
      blocks,
      [{ id: "block-0", start: 18, length: 999, message: "m", severity: "warning", code: 9 }],
      DOC.length,
    );
    const ranges: Array<[number, number]> = [];
    set.between(0, DOC.length, (f, t) => {
      ranges.push([f, t]);
    });
    expect(ranges).toEqual([[blocks[0].from + 18, blocks[0].to]]);
  });
});
