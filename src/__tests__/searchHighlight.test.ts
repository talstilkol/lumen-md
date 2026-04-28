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
