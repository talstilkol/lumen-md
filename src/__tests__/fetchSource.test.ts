/**
 * Tests for parseSrcFromMeta — the bit of P3-11 (live data URLs) that needs
 * to read fence meta strings like `csv src="https://x.com/y.csv" refresh="30s"`.
 *
 * The hook itself relies on `fetch` and `setInterval`, which integration tests
 * exercise; this file pins the meta-parsing edge cases.
 */

import { describe, it, expect } from "vitest";
import { parseSrcFromMeta } from "../plugins/useFetchSource";

describe("parseSrcFromMeta", () => {
  it("returns null url when meta is missing", () => {
    expect(parseSrcFromMeta(undefined)).toEqual({ url: null, refreshMs: null });
  });

  it("returns null url when meta has no src=", () => {
    expect(parseSrcFromMeta('title="hello"')).toEqual({ url: null, refreshMs: null });
  });

  it("extracts src from double-quoted form", () => {
    const r = parseSrcFromMeta('src="https://example.com/a.csv"');
    expect(r.url).toBe("https://example.com/a.csv");
    expect(r.refreshMs).toBeNull();
  });

  it("extracts src from single-quoted form", () => {
    const r = parseSrcFromMeta("src='https://example.com/a.json'");
    expect(r.url).toBe("https://example.com/a.json");
  });

  it("parses refresh in seconds (default unit)", () => {
    const r = parseSrcFromMeta('src="x" refresh="30"');
    expect(r.refreshMs).toBe(30_000);
  });

  it("parses refresh with explicit unit", () => {
    expect(parseSrcFromMeta('src="x" refresh="2m"').refreshMs).toBe(120_000);
    expect(parseSrcFromMeta('src="x" refresh="1h"').refreshMs).toBe(3_600_000);
    expect(parseSrcFromMeta('src="x" refresh="500s"').refreshMs).toBe(500_000);
  });

  it("clamps absurdly small refresh to 1s", () => {
    // Before clamp: 1 ms — would hammer the server.
    expect(parseSrcFromMeta('src="x" refresh="1"').refreshMs).toBe(1_000);
  });

  it("ignores garbage refresh values", () => {
    expect(parseSrcFromMeta('src="x" refresh="banana"').refreshMs).toBeNull();
  });

  it("handles src+title+height in one meta", () => {
    const r = parseSrcFromMeta('src="https://api/x.csv" title="Sales" height=400');
    expect(r.url).toBe("https://api/x.csv");
  });
});
