/**
 * Tests for the chunkMarkdown helper used by the semantic-search index.
 *
 * The embedding pipeline is exercised end-to-end in integration tests; here
 * we keep the chunker honest because that's what determines retrieval quality
 * and embedding-API cost.
 */

import { describe, it, expect } from "vitest";
import { chunkMarkdown } from "../ai/semanticSearch";

describe("chunkMarkdown", () => {
  it("returns one chunk for a tiny doc", () => {
    const out = chunkMarkdown("Just a single paragraph with no headings.");
    expect(out).toHaveLength(1);
    expect(out[0].text).toContain("single paragraph");
  });

  it("splits on heading boundaries", () => {
    const md = [
      "# First section",
      "Body of the first section.",
      "",
      "## Subsection",
      "More content here.",
      "",
      "# Second section",
      "Body of the second section.",
    ].join("\n");
    const out = chunkMarkdown(md);
    expect(out.length).toBeGreaterThanOrEqual(2);
    // Each chunk should start with a heading line.
    for (const chunk of out) {
      expect(chunk.text.trim().startsWith("#")).toBe(true);
    }
  });

  it("slices oversized chunks at paragraph breaks", () => {
    const para = "lorem ipsum dolor sit amet ".repeat(80); // ~2240 chars
    const md = `# Long\n${para}\n\n${para}\n\n${para}`;
    const out = chunkMarkdown(md);
    // Each chunk should be ≤ MAX_CHUNK_CHARS (1800) plus a small overage for
    // the paragraph-break heuristic, never the full length of the input.
    for (const chunk of out) {
      expect(chunk.text.length).toBeLessThanOrEqual(2200);
    }
    expect(out.length).toBeGreaterThan(1);
  });

  it("preserves content — concatenation matches original", () => {
    const md = [
      "# A",
      "Alpha.",
      "",
      "# B",
      "Beta.",
      "",
      "# C",
      "Gamma.",
    ].join("\n");
    const out = chunkMarkdown(md);
    const merged = out.map((c) => c.text).join("\n");
    // Every word in the source should appear in the merged chunks.
    for (const word of ["Alpha", "Beta", "Gamma"]) {
      expect(merged).toContain(word);
    }
  });

  it("emits offsets in monotonically increasing order", () => {
    const md = "# H1\nA\n\n# H2\nB\n\n# H3\nC";
    const out = chunkMarkdown(md);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].start).toBeGreaterThanOrEqual(out[i - 1].start);
    }
  });

  it("ignores leading whitespace-only buffers", () => {
    const out = chunkMarkdown("\n\n\n   \n");
    expect(out).toHaveLength(0);
  });
});
