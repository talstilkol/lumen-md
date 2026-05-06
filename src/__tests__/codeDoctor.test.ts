/**
 * Code Doctor — engine tests. Covers:
 *   - tokenize() edge cases (smart quotes, unicode, comments, errors)
 *   - diagnoseJson() against every Diagnostic code
 *   - repairJson() round-trips: broken in → JSON.parse-able out
 *   - JSONL line-boundary handling
 *   - detectRawJsonRegions() against markdown with mixed fenced/unfenced content
 *   - wrapInFence() text edits
 */

import { describe, it, expect } from "vitest";
import {
  tokenize,
  diagnoseJson,
  repairJson,
  diagnoseJsonl,
  detectRawJsonRegions,
  wrapInFence,
} from "../data/codeDoctor";

describe("tokenize", () => {
  it("handles a clean JSON object", () => {
    const t = tokenize('{"a": 1}').filter(
      (x) => x.kind !== "ws" && x.kind !== "newline",
    );
    expect(t.map((x) => x.kind)).toEqual([
      "lbrace",
      "string",
      "colon",
      "number",
      "rbrace",
    ]);
  });

  it("classifies smart-quoted strings with quote='smart'", () => {
    const t = tokenize('{“a”: 1}').filter((x) => x.kind === "string");
    expect(t).toHaveLength(1);
    expect(t[0].quote).toBe("smart");
  });

  it("classifies single-quoted strings with quote=single", () => {
    const t = tokenize("{'a': 1}").filter((x) => x.kind === "string");
    expect(t[0].quote).toBe("'");
  });

  it("flags unterminated strings", () => {
    const t = tokenize('"oops').filter((x) => x.kind === "string");
    expect(t[0].terminated).toBe(false);
  });

  it("emits 'error' tokens for stray characters but never throws", () => {
    expect(() => tokenize("{@@@}")).not.toThrow();
    const errs = tokenize("{@@@}").filter((x) => x.kind === "error");
    expect(errs.length).toBe(3);
  });

  it("recognizes // and /* */ comments", () => {
    const t1 = tokenize("// hi\n{}").filter((x) => x.kind === "comment");
    expect(t1).toHaveLength(1);
    const t2 = tokenize("/* hi */ {}").filter((x) => x.kind === "comment");
    expect(t2).toHaveLength(1);
  });

  it("preserves Hebrew/Arabic content inside strings", () => {
    const src = '{"שם": "שלום"}';
    const t = tokenize(src).filter((x) => x.kind === "string");
    expect(t).toHaveLength(2);
    expect(t[0].raw).toBe('"שם"');
    expect(t[1].raw).toBe('"שלום"');
  });
});

describe("diagnoseJson", () => {
  it("returns empty-input for whitespace-only", () => {
    const d = diagnoseJson("   \n\n  ");
    expect(d).toHaveLength(1);
    expect(d[0].code).toBe("empty-input");
  });

  it("flags smart quotes", () => {
    const d = diagnoseJson('{“a”: 1}');
    expect(d.some((x) => x.code === "smart-quote")).toBe(true);
  });

  it("flags single-quoted strings", () => {
    const d = diagnoseJson("{'a': 1}");
    expect(d.some((x) => x.code === "single-quote-string")).toBe(true);
  });

  it("flags trailing commas in objects", () => {
    const d = diagnoseJson('{"a": 1,}');
    expect(d.some((x) => x.code === "trailing-comma")).toBe(true);
  });

  it("flags trailing commas in arrays", () => {
    const d = diagnoseJson("[1, 2,]");
    expect(d.some((x) => x.code === "trailing-comma")).toBe(true);
  });

  it("flags unquoted keys", () => {
    const d = diagnoseJson("{a: 1}");
    expect(d.some((x) => x.code === "unquoted-key")).toBe(true);
  });

  it("flags unclosed brace", () => {
    const d = diagnoseJson('{"a": 1');
    expect(d.some((x) => x.code === "unclosed-brace")).toBe(true);
  });

  it("flags unclosed bracket", () => {
    const d = diagnoseJson("[1, 2, 3");
    expect(d.some((x) => x.code === "unclosed-bracket")).toBe(true);
  });

  it("flags missing comma between values in array", () => {
    const d = diagnoseJson('[1 2 3]');
    expect(d.filter((x) => x.code === "missing-comma").length).toBeGreaterThan(0);
  });

  it("returns no diagnostics for clean JSON (objects, arrays, primitives)", () => {
    expect(diagnoseJson('{"a": 1, "b": [true, null, "x"]}')).toEqual([]);
    expect(diagnoseJson("[1, 2, 3]")).toEqual([]);
  });
});

describe("repairJson", () => {
  it("repairs smart quotes to straight", () => {
    const r = repairJson('{“a”: 1}');
    expect(r.parses).toBe(true);
    expect(JSON.parse(r.output)).toEqual({ a: 1 });
    expect(r.patches.some((p) => p.reason === "smart-quote")).toBe(true);
  });

  it("repairs single quotes to double", () => {
    const r = repairJson("{'a': 'hello'}");
    expect(r.parses).toBe(true);
    expect(JSON.parse(r.output)).toEqual({ a: "hello" });
  });

  it("repairs trailing commas", () => {
    const r = repairJson('{"a": 1, "b": 2,}');
    expect(r.parses).toBe(true);
    expect(JSON.parse(r.output)).toEqual({ a: 1, b: 2 });
  });

  it("repairs unquoted keys", () => {
    const r = repairJson("{a: 1, b: 2}");
    expect(r.parses).toBe(true);
    expect(JSON.parse(r.output)).toEqual({ a: 1, b: 2 });
  });

  it("inserts missing commas in arrays", () => {
    const r = repairJson('[1 2 3]');
    expect(r.parses).toBe(true);
    expect(JSON.parse(r.output)).toEqual([1, 2, 3]);
  });

  it("appends missing closing braces", () => {
    const r = repairJson('{"a": 1');
    expect(r.parses).toBe(true);
    expect(JSON.parse(r.output)).toEqual({ a: 1 });
  });

  it("appends missing closing brackets", () => {
    const r = repairJson("[1, 2, 3");
    expect(r.parses).toBe(true);
    expect(JSON.parse(r.output)).toEqual([1, 2, 3]);
  });

  it("combines multiple repairs in one pass", () => {
    // smart quotes + trailing comma + unquoted key + missing close
    const r = repairJson("{a: “hello”, b: 'x',");
    expect(r.parses).toBe(true);
    expect(JSON.parse(r.output)).toEqual({ a: "hello", b: "x" });
    const reasons = new Set(r.patches.map((p) => p.reason));
    expect(reasons.has("smart-quote")).toBe(true);
    expect(reasons.has("unquoted-key")).toBe(true);
    expect(reasons.has("trailing-comma")).toBe(true);
    expect(reasons.has("unclosed-brace")).toBe(true);
  });

  it("preserves Hebrew content inside repaired strings", () => {
    const r = repairJson("{name: 'שלום עולם'}");
    expect(r.parses).toBe(true);
    expect(JSON.parse(r.output)).toEqual({ name: "שלום עולם" });
  });

  it("is a no-op for clean JSON", () => {
    const clean = '{"a": 1, "b": [1, 2, 3]}';
    const r = repairJson(clean);
    expect(r.output).toBe(clean);
    expect(r.patches).toHaveLength(0);
    expect(r.parses).toBe(true);
  });

  it("does not over-aggressively patch already-valid input", () => {
    // Tricky: array with strings that contain commas inside
    const clean = '["a, b", "c, d"]';
    const r = repairJson(clean);
    expect(r.output).toBe(clean);
    expect(r.parses).toBe(true);
  });

  it("repairs JS-style escapes in single-quoted strings", () => {
    const r = repairJson("{key: 'a\\nb'}");
    expect(r.parses).toBe(true);
    expect(JSON.parse(r.output)).toEqual({ key: "a\nb" });
  });

  it("returns parses=false when the input is unrepairable", () => {
    // Random garbage that no strategy can reasonably fix.
    const r = repairJson("@@@ totally not json @@@");
    expect(r.parses).toBe(false);
    expect(r.remaining.length).toBeGreaterThan(0);
  });
});

describe("diagnoseJsonl", () => {
  it("returns one entry per non-blank line", () => {
    const lines = diagnoseJsonl(
      '{"a":1}\n{"a":2}\n\n{"a":3}\n',
    );
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.parses)).toBe(true);
  });

  it("flags only the broken lines", () => {
    const text = '{"a":1}\n{a: 2}\n{"a":3}\n';
    const lines = diagnoseJsonl(text);
    expect(lines).toHaveLength(3);
    expect(lines[0].parses).toBe(true);
    expect(lines[1].parses).toBe(false);
    expect(lines[2].parses).toBe(true);
    expect(
      lines[1].diagnostics.some((d) => d.code === "unquoted-key"),
    ).toBe(true);
  });

  it("attaches absolute offsets in diagnostics", () => {
    const text = '{"a":1}\n{a: 2}\n';
    const lines = diagnoseJsonl(text);
    const broken = lines[1];
    // The unquoted-key span should fall within the second line.
    const span = broken.diagnostics.find((d) => d.code === "unquoted-key")!.span;
    expect(span.start).toBeGreaterThanOrEqual(broken.span.start);
    expect(span.end).toBeLessThanOrEqual(broken.span.end);
  });
});

describe("detectRawJsonRegions", () => {
  it("returns empty for plain prose", () => {
    expect(detectRawJsonRegions("# Hello\n\nNo JSON here.\n")).toEqual([]);
  });

  it("flags a JSON object that sits in a paragraph", () => {
    const md = '# Title\n\n{"a": 1, "b": [1, 2, 3]}\n';
    const regions = detectRawJsonRegions(md);
    expect(regions.length).toBe(1);
    expect(regions[0].kind).toBe("json");
  });

  it("flags a JSONL block (multiple object lines)", () => {
    const md = '# Title\n\n{"a":1}\n{"a":2}\n{"a":3}\n';
    const regions = detectRawJsonRegions(md);
    expect(regions.length).toBe(1);
    expect(regions[0].kind).toBe("jsonl");
  });

  it("does NOT flag content already inside a code fence", () => {
    const md = '# Title\n\n```\n{"a":1}\n{"a":2}\n```\n';
    expect(detectRawJsonRegions(md)).toEqual([]);
  });

  it("flags JSONL outside a fence even when another fence exists in the same doc", () => {
    const md =
      '# Title\n\n```\nx = 1\n```\n\n{"a":1}\n{"a":2}\n{"a":3}\n';
    const regions = detectRawJsonRegions(md);
    expect(regions.length).toBe(1);
    expect(regions[0].kind).toBe("jsonl");
    // Region must point at the JSONL block, not the fenced one.
    const text = md.slice(regions[0].span.start, regions[0].span.end);
    expect(text).toContain('{"a":1}');
    expect(text).not.toContain("x = 1");
  });
});

describe("wrapInFence", () => {
  it("wraps a region in a ```jsonl fence", () => {
    const md = '# Title\n\n{"a":1}\n{"a":2}\n';
    const regions = detectRawJsonRegions(md);
    const wrapped = wrapInFence(md, regions[0].span, "jsonl");
    expect(wrapped).toContain("```jsonl\n");
    expect(wrapped).toContain('{"a":1}\n{"a":2}');
    expect(wrapped).toContain("\n```");
    // Content of the original region is preserved verbatim.
    expect(wrapped.indexOf("# Title")).toBe(0);
  });

  it("does not corrupt surrounding markdown", () => {
    const md =
      'before\n\n{"a":1}\n{"a":2}\n\nafter\n';
    const regions = detectRawJsonRegions(md);
    const wrapped = wrapInFence(md, regions[0].span, "jsonl");
    expect(wrapped).toMatch(/before\n/);
    expect(wrapped).toMatch(/after\n/);
  });
});
