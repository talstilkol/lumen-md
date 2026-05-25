/**
 * Regression: `getEditorYForLine` in EditorLayout used to call
 * `view.state.doc.line(n)` directly with a stale anchor line number,
 * which threw "Invalid line number N in M-line document" once the doc
 * shrank below the anchor. Round-25 introduced `clampLineNumber` as
 * the safe wrapper.
 */

import { describe, it, expect } from "vitest";
import { clampLineNumber } from "../editor/lineClamp";

describe("clampLineNumber", () => {
  it("clamps an out-of-range upper line to totalLines", () => {
    expect(clampLineNumber(8, 4)).toBe(4);
  });

  it("clamps a zero or negative line to 1 when the doc is non-empty", () => {
    expect(clampLineNumber(0, 5)).toBe(1);
    expect(clampLineNumber(-3, 5)).toBe(1);
  });

  it("returns 0 when the document has no lines", () => {
    expect(clampLineNumber(1, 0)).toBe(0);
    expect(clampLineNumber(50, 0)).toBe(0);
  });

  it("returns the input unchanged when already in range", () => {
    expect(clampLineNumber(3, 10)).toBe(3);
    expect(clampLineNumber(1, 1)).toBe(1);
    expect(clampLineNumber(10, 10)).toBe(10);
  });

  it("floors fractional inputs so doc.line never receives a non-integer", () => {
    expect(clampLineNumber(3.7, 10)).toBe(3);
  });

  it("handles NaN / Infinity defensively", () => {
    expect(clampLineNumber(Number.NaN, 5)).toBe(1);
    expect(clampLineNumber(Number.POSITIVE_INFINITY, 5)).toBe(5);
    expect(clampLineNumber(Number.NEGATIVE_INFINITY, 5)).toBe(1);
  });
});
