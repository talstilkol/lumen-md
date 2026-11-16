/**
 * Tests for the code-block snippets. (The old built-in template list,
 * storage/templates.ts, was deleted in audit r3 / W10.E27: the gallery reads
 * public/templates, covered by templateMeta.test.ts and hebrewContent.test.ts.)
 */

import { describe, it, expect } from "vitest";
import { BLOCK_SNIPPETS } from "../snippets";

describe("BLOCK_SNIPPETS", () => {
  it("exposes a non-empty snippet for every documented block type", () => {
    for (const [key, value] of Object.entries(BLOCK_SNIPPETS)) {
      expect(value, `snippet ${key} is missing or empty`).toBeTruthy();
      expect(typeof value).toBe("string");
    }
  });

  it("fenced snippets carry an opening AND closing fence", () => {
    // wikilink + math + note are not triple-backtick fences:
    //   wikilink → `[[...]]`
    //   math     → `$$ ... $$`
    //   note     → `:::note{...} ... :::` (directive)
    const fenced = Object.entries(BLOCK_SNIPPETS).filter(
      ([k]) => k !== "wikilink" && k !== "math" && k !== "note",
    );
    for (const [k, v] of fenced) {
      const opens = (v.match(/^```/gm) ?? []).length;
      expect(opens, `snippet ${k} should have ≥2 fence lines`).toBeGreaterThanOrEqual(2);
    }
  });

  it("the note snippet uses the :::note directive syntax", () => {
    expect(BLOCK_SNIPPETS.note).toMatch(/:::note/);
    expect(BLOCK_SNIPPETS.note.trim().endsWith(":::")).toBe(true);
  });

  it("the math snippet uses $$ block delimiters", () => {
    const m = BLOCK_SNIPPETS.math;
    expect(m).toContain("$$");
  });

  it("the embed snippet contains a recognisable embeddable URL", () => {
    expect(BLOCK_SNIPPETS.embed).toMatch(/https?:\/\//);
  });

  it("the wikilink snippet uses [[…]] syntax", () => {
    expect(BLOCK_SNIPPETS.wikilink.startsWith("[[")).toBe(true);
    expect(BLOCK_SNIPPETS.wikilink.endsWith("]]")).toBe(true);
  });

  it("the htmlpreview snippet declares a height attribute", () => {
    expect(BLOCK_SNIPPETS.htmlpreview).toMatch(/height=/);
  });
});
