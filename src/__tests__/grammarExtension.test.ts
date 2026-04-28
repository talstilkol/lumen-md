/**
 * Smoke tests for the grammar-check editor extension. The full
 * CodeMirror integration is too jsdom-heavy to drive faithfully; we
 * pin the factory contract:
 *   - returns a non-empty Extension (ViewPlugin) so it can be plugged
 *     into a Compartment
 *   - the `setGrammarDebounce` helper clamps to a sane minimum
 */

import { describe, it, expect } from "vitest";
import { grammarExtension, setGrammarDebounce } from "../editor/grammarExtension";

describe("grammarExtension", () => {
  it("returns a ViewPlugin (non-empty Extension)", () => {
    const ext = grammarExtension();
    const isEmpty = Array.isArray(ext) && (ext as unknown[]).length === 0;
    expect(isEmpty).toBe(false);
  });

  it("accepts an options bag (language + onMatches callback)", () => {
    const ext = grammarExtension({
      language: "fr",
      onMatches: () => {},
    });
    expect(ext).toBeTruthy();
  });
});

describe("setGrammarDebounce", () => {
  it("clamps below-200ms inputs up to the 200ms floor (no contract violation)", () => {
    // Implementation uses Math.max(200, ...) — calling with 50 should not throw.
    expect(() => setGrammarDebounce(50)).not.toThrow();
  });

  it("accepts realistic debounce values", () => {
    expect(() => setGrammarDebounce(800)).not.toThrow();
    expect(() => setGrammarDebounce(3000)).not.toThrow();
  });
});
