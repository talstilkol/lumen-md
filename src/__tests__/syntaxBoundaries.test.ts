/**
 * W1.2: where a Markdown extension may start (renderer/syntaxBoundaries.ts),
 * through the preview's own pipeline.
 */
import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { renderHastFast } from "../renderer/renderCore";
import { markdownSyntax } from "../renderer/syntax";

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

  // Review 10, L10.
  it("a label stays Markdown when its directive is text: foo:x[**bold**] keeps the bold", () => {
    const h = render("foo:x[**bold** and _em_]{.c}");
    expect(text(h)).toBe("foo:x[bold and em]{.c}");
    expect(find(h, (x) => x.tagName === "strong").map(text)).toEqual(["bold"]);
    expect(find(h, (x) => x.tagName === "em").map(text)).toEqual(["em"]);
  });

  it("a directive name the preview does not render stays text after punctuation and a space too", () => {
    const h = render("(:x) and a :b[c] and :smile");
    expect(text(h)).toBe("(:x) and a :b[c] and :smile");
    expect(find(h, (x) => x.tagName === "div")).toEqual([]);
  });

  it("without the source (runSync on a parsed tree) the attributes are written back", () => {
    const proc = unified().use(remarkParse).use(markdownSyntax);
    const tree = proc.runSync(proc.parse("Re:x[**y**]{#d .c k=v} and (:z{.q})")) as unknown as H;
    const mdText = (n: H): string => (n.type === "text" ? (n.value ?? "") : (n.children ?? []).map(mdText).join(""));
    expect(mdText(tree)).toBe('Re:x[y]{#d .c k="v"} and (:z{.q})');
    expect(find(tree, (x) => x.type === "strong").length).toBe(1);
    expect(find(tree, (x) => x.type === "textDirective")).toEqual([]);
  });
});
