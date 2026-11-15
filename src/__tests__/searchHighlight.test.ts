/**
 * Tests for the search-highlight bridge — the helper that fires a
 * `lumen-search-target` window event to the in-editor extension after the
 * SearchDialog opens a hit. We exercise the dispatch + listener contract;
 * the CodeMirror integration itself is too jsdom-heavy to assert here, but
 * is wired into the editor by `searchHighlightExtension()`.
 */

import { describe, it, expect, vi } from "vitest";
import {
  flashSearchHighlight,
  searchHighlightExtension,
} from "../editor/searchHighlight";

describe("flashSearchHighlight", () => {
  it("dispatches a `lumen-search-target` event with the supplied query", () => {
    const handler = vi.fn();
    window.addEventListener("lumen-search-target", handler);
    flashSearchHighlight("deep learning");
    window.removeEventListener("lumen-search-target", handler);

    expect(handler).toHaveBeenCalledTimes(1);
    const evt = handler.mock.calls[0][0] as CustomEvent<{ query: string }>;
    expect(evt.detail.query).toBe("deep learning");
  });

  it("is safe to call without any listeners attached", () => {
    expect(() => flashSearchHighlight("hello")).not.toThrow();
  });

  it("trims whitespace-only queries through the normal path (the editor extension will skip them)", () => {
    const handler = vi.fn();
    window.addEventListener("lumen-search-target", handler);
    flashSearchHighlight("   ");
    window.removeEventListener("lumen-search-target", handler);

    expect(handler).toHaveBeenCalledTimes(1);
    const evt = handler.mock.calls[0][0] as CustomEvent<{ query: string }>;
    expect(evt.detail.query).toBe("   ");
  });
});

describe("searchHighlightExtension", () => {
  it("returns a non-empty Extension array (field + bridge)", () => {
    const ext = searchHighlightExtension();
    expect(Array.isArray(ext)).toBe(true);
    expect((ext as unknown[]).length).toBeGreaterThanOrEqual(2);
  });
});

describe("searchHighlightExtension in an editor (W11.Q3)", () => {
  it("marks the matches on screen, case-insensitively, and clears with an empty query", async () => {
    const { EditorState } = await import("@codemirror/state");
    const { EditorView } = await import("@codemirror/view");
    const { searchHighlights } = await import("../editor/searchHighlight");
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({ state: EditorState.create({ doc: "a Needle b\nneedle\nnone", extensions: searchHighlightExtension() }), parent });
    try {
      flashSearchHighlight("NEEDLE");
      const hits: string[] = [];
      searchHighlights(view).between(0, view.state.doc.length, (from, to) => {
        hits.push(view.state.sliceDoc(from, to));
      });
      expect(hits).toEqual(["Needle", "needle"]);
      // An edit before the hits keeps them on the text they cover.
      view.dispatch({ changes: { from: 0, insert: "xx " } });
      const after: string[] = [];
      searchHighlights(view).between(0, view.state.doc.length, (from, to) => {
        after.push(view.state.sliceDoc(from, to));
      });
      expect(after).toEqual(["Needle", "needle"]);
      flashSearchHighlight("  ");
      expect(searchHighlights(view).size).toBe(0);
    } finally {
      view.destroy();
      parent.remove();
    }
  });
});
