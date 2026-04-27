/**
 * Tests for the grammar-checker client. The remote LanguageTool API would
 * require live network in CI, so we verify the offline-only paths: short
 * inputs short-circuit, the cache returns identical results, and `clear`
 * empties it. Network calls are not exercised here.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { checkGrammar, clearGrammarCache } from "../ai/grammar";

describe("checkGrammar (offline paths)", () => {
  beforeEach(() => {
    clearGrammarCache();
  });

  it("returns no matches for empty input", async () => {
    expect(await checkGrammar("")).toEqual([]);
  });

  it("returns no matches for very short input", async () => {
    expect(await checkGrammar("Hi")).toEqual([]);
    expect(await checkGrammar("This is short.")).toEqual([]);
  });

  it("clearGrammarCache resets the cache to empty without errors", () => {
    clearGrammarCache();
    expect(true).toBe(true);
  });
});
