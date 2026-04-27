/**
 * Tests for the markdown linter. Each rule has at least one positive +
 * one negative case; rule LUMEN001 also exercises the workspaceTitles
 * option that lets the linter cross-reference wiki-links.
 */

import { describe, it, expect } from "vitest";
import { lintMarkdown } from "../lint/markdownLint";

describe("MD009 — trailing whitespace", () => {
  it("flags a single trailing space", () => {
    const out = lintMarkdown("hello \nworld\n");
    expect(out.some((f) => f.rule === "MD009")).toBe(true);
  });
  it("flags ≥ 3 trailing spaces", () => {
    const out = lintMarkdown("hello   \nworld\n");
    expect(out.some((f) => f.rule === "MD009")).toBe(true);
  });
  it("ignores intentional 2-space line breaks (markdown hard break)", () => {
    const out = lintMarkdown("hello  \nworld\n");
    expect(out.some((f) => f.rule === "MD009")).toBe(false);
  });
  it("doesn't flag inside a fenced code block", () => {
    const out = lintMarkdown("```\nhello   \n```\n");
    expect(out.some((f) => f.rule === "MD009")).toBe(false);
  });
});

describe("MD019 — mixed-indent", () => {
  it("flags lines that mix spaces and tabs at the start", () => {
    const out = lintMarkdown("  \t- mixed indent\n");
    expect(out.some((f) => f.rule === "MD019")).toBe(true);
  });
  it("doesn't flag pure-tabs or pure-spaces", () => {
    const out = lintMarkdown("\t- only tabs\n    - only spaces\n");
    expect(out.some((f) => f.rule === "MD019")).toBe(false);
  });
});

describe("MD001 — heading skips", () => {
  it("flags h1 → h3 skip", () => {
    const out = lintMarkdown("# Top\n\n### Skipped h2\n");
    expect(out.some((f) => f.rule === "MD001")).toBe(true);
  });
  it("does not flag a clean increase by one", () => {
    const out = lintMarkdown("# A\n\n## B\n\n### C\n");
    expect(out.some((f) => f.rule === "MD001")).toBe(false);
  });
  it("does not flag descending headings (h3 after h2 after h1)", () => {
    const out = lintMarkdown("# A\n\n## B\n\n# C\n");
    expect(out.some((f) => f.rule === "MD001")).toBe(false);
  });
});

describe("LUMEN001 — wiki-link target validation", () => {
  it("flags an unknown target when titles are provided", () => {
    const out = lintMarkdown("See [[Missing Note]]", {
      workspaceTitles: new Set(["Existing Note"]),
    });
    expect(out.some((f) => f.rule === "LUMEN001" && f.message.includes("Missing Note"))).toBe(true);
  });
  it("does not flag a known target", () => {
    const out = lintMarkdown("See [[Existing Note]]", {
      workspaceTitles: new Set(["Existing Note"]),
    });
    expect(out.some((f) => f.rule === "LUMEN001")).toBe(false);
  });
  it("strips heading anchors and aliases when matching", () => {
    const out = lintMarkdown("See [[Note#section|alias]]", {
      workspaceTitles: new Set(["Note"]),
    });
    expect(out.some((f) => f.rule === "LUMEN001")).toBe(false);
  });
  it("is silent when no titles are provided (linter doesn't have data)", () => {
    const out = lintMarkdown("See [[Anything]]");
    expect(out.some((f) => f.rule === "LUMEN001")).toBe(false);
  });
});

describe("integration", () => {
  it("returns multiple findings with line numbers", () => {
    const src = "# H1   \n\n### Skip\n\nLine with trailing space \n";
    const out = lintMarkdown(src);
    const ruleIds = new Set(out.map((f) => f.rule));
    expect(ruleIds.has("MD009")).toBe(true);
    expect(ruleIds.has("MD001")).toBe(true);
    for (const f of out) {
      expect(f.line).toBeGreaterThanOrEqual(1);
      expect(["info", "warning", "error"]).toContain(f.severity);
    }
  });
});
