/**
 * Smoke test for the editor's compartment-based extension stack.
 *
 * Editor.tsx wires several extensions through CodeMirror Compartments so
 * each can swap independently:
 *   - vimCompartment      — Vim keymap (lazy)
 *   - spellCheckCompartment — browser-native spellcheck contentAttributes
 *   - collabCompartment   — peer cursors (Y.Awareness)
 *   - typewriterCompartment — active-line centering
 *   - commentsCompartment — Y-comment decorations
 *
 * Driving the full Editor in jsdom is too heavy (CodeMirror needs a real
 * layout). This file pins the contracts that must hold for the stack to
 * coexist:
 *
 *   1. Each extension factory accepts the documented options and returns
 *      a CodeMirror Extension (an array or ViewPlugin).
 *   2. With `null` / disabled inputs, the factory returns a true no-op
 *      (`[]`) so the compartment stays empty without errors.
 */

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { typewriterModeExtension } from "../editor/typewriterMode";
import { commentDecorations } from "../editor/commentDecorations";
import { searchHighlightExtension } from "../editor/searchHighlight";
import { markdownLintExtension } from "../editor/lintExtension";

describe("editor extension factories — contract", () => {
  it("typewriterModeExtension returns a non-empty Extension", () => {
    const ext = typewriterModeExtension();
    // ViewPlugins are not arrays.
    const isEmpty = Array.isArray(ext) && (ext as unknown[]).length === 0;
    expect(isEmpty).toBe(false);
  });

  it("commentDecorations returns [] with no Y.Doc, real Extension with one", () => {
    const empty = commentDecorations({ doc: null });
    expect(Array.isArray(empty) && (empty as unknown[]).length === 0).toBe(true);

    const ydoc = new Y.Doc();
    const real = commentDecorations({ doc: ydoc });
    expect(Array.isArray(real) && (real as unknown[]).length === 0).toBe(false);
  });

  it("searchHighlightExtension returns the field + bridge pair", () => {
    const ext = searchHighlightExtension();
    expect(Array.isArray(ext)).toBe(true);
    expect((ext as unknown[]).length).toBeGreaterThanOrEqual(2);
  });

  it("markdownLintExtension accepts an optional options bag", () => {
    const ext1 = markdownLintExtension();
    const ext2 = markdownLintExtension({ getWorkspaceTitles: () => new Set() });
    // Both produce a real ViewPlugin (non-empty contract).
    for (const ext of [ext1, ext2]) {
      const isEmpty = Array.isArray(ext) && (ext as unknown[]).length === 0;
      expect(isEmpty).toBe(false);
    }
  });

  it("multiple extension factories can be invoked in the same render cycle", () => {
    // Sanity: stacking the factories together — the way Editor.tsx does —
    // doesn't blow up. We're pinning the no-throw contract here.
    const ydoc = new Y.Doc();
    expect(() => {
      typewriterModeExtension();
      commentDecorations({ doc: ydoc });
      searchHighlightExtension();
      markdownLintExtension();
    }).not.toThrow();
  });
});
