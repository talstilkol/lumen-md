/**
 * Tests for the built-in document templates and code-block snippets.
 * Templates are user-visible starting points; we lock down their shape so
 * a careless edit can't ship a broken template.
 */

import { describe, it, expect } from "vitest";
import { getTemplates } from "../storage/templates";
import { BLOCK_SNIPPETS } from "../snippets";

describe("getTemplates", () => {
  it("returns all six built-in templates", () => {
    const t = getTemplates();
    const ids = t.map((x) => x.id);
    expect(ids).toEqual(
      expect.arrayContaining(["blank", "meeting", "journal", "blog", "readme", "letter"]),
    );
  });

  it("every template has a non-empty name, description, emoji, and content", () => {
    for (const t of getTemplates()) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.emoji).toBeTruthy();
      expect(t.content.length).toBeGreaterThan(0);
    }
  });

  it("every template starts with markdown content (header or bold name)", () => {
    for (const t of getTemplates()) {
      const trimmed = t.content.trimStart();
      // Headers start with #, the letter template leads with a bolded name.
      expect(trimmed.startsWith("#") || trimmed.startsWith("**")).toBe(true);
    }
  });

  it("the meeting template stamps today's date", () => {
    const today = new Date().toISOString().slice(0, 10);
    const meeting = getTemplates().find((t) => t.id === "meeting")!;
    expect(meeting.content).toContain(today);
  });

  it("the journal template includes a gratitude section", () => {
    const j = getTemplates().find((t) => t.id === "journal")!;
    expect(j.content).toMatch(/Gratitude/);
  });

  it("the readme template includes Installation, Usage, Contributing, and License headings", () => {
    const r = getTemplates().find((t) => t.id === "readme")!;
    for (const heading of ["Installation", "Usage", "Contributing", "License"]) {
      expect(r.content).toContain(heading);
    }
  });
});

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
