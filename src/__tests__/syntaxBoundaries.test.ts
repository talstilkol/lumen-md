/**
 * W1.2: where a Markdown extension may start (renderer/syntaxBoundaries.ts),
 * through the preview's own pipeline.
 */
import { describe, it, expect } from "vitest";
import { renderHastFast } from "../renderer/renderCore";

type H = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: H[] };

const text = (n: H): string => (n.type === "text" ? (n.value ?? "") : (n.children ?? []).map(text).join(""));
const find = (n: H, pred: (x: H) => boolean): H[] => [...(pred(n) ? [n] : []), ...(n.children ?? []).flatMap((c) => find(c, pred))];
const render = (md: string) => renderHastFast(md) as unknown as H;

describe("syntax boundaries", () => {
  it("keeps a word after a colon inside prose (no text directive mid-word)", () => {
    const h = render("Re:subject and Note:important, ratio 3:abc");
    expect(text(h)).toContain("Re:subject and Note:important, ratio 3:abc");
    expect(find(h, (x) => x.tagName === "div")).toEqual([]);
  });

  it("still reads a directive after a space or at the start", () => {
    const h = render("time 10:30 and :note[hi] here\n\n:tip");
    const boxes = find(h, (x) => Array.isArray(x.properties?.className) && (x.properties!.className as string[]).includes("admonition"));
    expect(boxes.length).toBe(2);
    expect(text(h)).toContain("time 10:30 and ");
  });

  it("does not form an autolink literal across a backslash escape", () => {
    const escaped = render("<foo\\+@bar.example.com>");
    expect(find(escaped, (x) => x.tagName === "a")).toEqual([]);
    expect(text(escaped)).toBe("<foo+@bar.example.com>");
    const plain = render("write to foo+x@bar.example.com or www.example.com");
    expect(find(plain, (x) => x.tagName === "a").map((a) => a.properties?.href)).toEqual(["mailto:foo+x@bar.example.com", "http://www.example.com"]);
  });
});
