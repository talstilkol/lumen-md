/**
 * Plan W10.D21: the Markdown inputs a 20,000-input run of the fuzzer
 * (scripts/fuzz/run.mjs, seed 1, real remark/rehype packages) still found
 * on verify/train-7 after W4.16, and the bounds that fix them
 * (src/renderer/boundMarkdown.ts):
 *
 *  - #655 #17957 …: a lone surrogate in an HTML comment made parse5 throw
 *    ("Invalid code point 1114112"), and the preview failed;
 *  - #93 #185 #17976 #19495 #9178: raw HTML nested ~2,200+ levels overflowed
 *    the stack (#9178 hid it after a "~~~" line inside an HTML block);
 *  - #2101 #3877 #12929 #16139: thousands of `*` in one run, 0.8–1.4 s or a
 *    stack overflow (emphasis, GFM autolink literal after a URL);
 *  - #11087: a U+00A0 line was taken as blank, so a bracket bound fenced
 *    half of an HTML block;
 *  - #1459 #4812: block quotes nested by `>>` or after a lone CR were not
 *    counted, and overflowed the stack;
 *  - #17461: the nesting bound itself was a regular expression that
 *    backtracked for minutes on 32 list markers with long space runs.
 *
 * The 1,000,000-input run then found (on the bounds above): a quote
 * paragraph counted line by line (#72864); a fence inside a directive
 * container, which ends with it (#25369 #76842 #93948 #11087); a raw-text
 * fence opened inside the front matter (#29767 #72864); and `$$` inside a
 * list hiding a 40-level line (#21240).
 */
import { describe, it, expect } from "vitest";
import { generate } from "../../scripts/fuzz/generators";
import { asRawText, boundMarkdown, MAX_CONTAINER_DEPTH, MAX_DELIMITERS, MAX_HTML_DEPTH, needsBounding } from "../renderer/boundMarkdown";
import { renderMarkdown } from "../renderer/pipeline";

const FOUND = [655, 17957, 93, 185, 17976, 19495, 9178, 2101, 3877, 12929, 16139, 11087, 1459, 4812, 17461, 21240, 25369, 29767, 72864, 76842, 93948];

describe("fuzz findings of W10.D21", () => {
  it.each(FOUND)("#%i renders, in under 100 ms", async (i) => {
    const input = generate("markdown", 1, i);
    await renderMarkdown(input, () => false); // warm
    const t0 = performance.now();
    await renderMarkdown(input, () => false);
    const ms = performance.now() - t0;
    expect(ms, `#${i}: ${ms.toFixed(1)} ms`).toBeLessThan(100);
  }, 30_000);
});

describe("the bounds", () => {
  it("counts nesting in linear time", () => {
    const line = "    " + "2)      ".repeat(MAX_CONTAINER_DEPTH) + "@x";
    const t0 = performance.now();
    expect(needsBounding(`${line}\n${line}`)).toBe(false);
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it("counts `>>` block quotes and lines after a lone CR", () => {
    expect(needsBounding(">".repeat(MAX_CONTAINER_DEPTH + 5) + " x")).toBe(true);
    expect(needsBounding("a\r" + "> ".repeat(MAX_CONTAINER_DEPTH + 5) + "x")).toBe(true);
    expect(needsBounding(">".repeat(MAX_CONTAINER_DEPTH - 2) + " x")).toBe(false);
  });

  it("bounds emphasis delimiters per inline run", () => {
    const bad = "https://example.co" + "*".repeat(MAX_DELIMITERS + 1);
    expect(boundMarkdown(bad)).toBe(asRawText(bad));
    const many = Array.from({ length: 300 }, (_, k) => `- **item ${k}** and _more_`).join("\n");
    expect(boundMarkdown(many)).toBe(many);
  });

  it("bounds raw HTML left open over the whole note", () => {
    const deep = "<div>".repeat(MAX_HTML_DEPTH + 1) + "x";
    expect(boundMarkdown(deep)).toBe(asRawText(deep));
    const part = "<div>".repeat(100) + "x";
    const out = boundMarkdown([part, part, part].join("\n\n")).split("\n\n");
    expect(out.slice(0, 2)).toEqual([part, part]);
    expect(out[2]).toBe(asRawText(part));
    // Elements the parser closes itself, and HTML in code spans, do not count.
    const cells = "<table>" + "<tr><td>a".repeat(400) + "</table>";
    expect(boundMarkdown(cells)).toBe(cells);
    const code = Array.from({ length: 400 }, () => "Write `<div>` to open a block.").join("\n");
    expect(boundMarkdown(code)).toBe(code);
  });

  it("a fence line inside an HTML block is HTML, not a fence", () => {
    const md = "<div>\n~~~\n\n" + "<div>".repeat(MAX_HTML_DEPTH + 1);
    expect(needsBounding(md)).toBe(true);
    expect(boundMarkdown(md)).toBe("<div>\n~~~\n\n" + asRawText("<div>".repeat(MAX_HTML_DEPTH + 1)));
  });

  it("a line of U+00A0 does not end a block", () => {
    const bad = "[".repeat(1100);
    const md = `<div>\n \n${bad}`;
    expect(boundMarkdown(md)).toBe(asRawText(md));
  });

  it("lone surrogates become U+FFFD; a note without them is unchanged", () => {
    const out = boundMarkdown("<!-- \udc00\udc00 -->");
    expect(out).toBe("<!-- �� -->");
    const fine = "שלום 👩‍👩‍👧 <!-- ok -->";
    expect(boundMarkdown(fine)).toBe(fine);
  });

  it("a block quote paragraph is one inline run", () => {
    const quote = Array.from({ length: 1100 }, () => "> [").join("\n");
    expect(boundMarkdown(quote)).toBe(asRawText(quote));
    const items = Array.from({ length: 2000 }, (_, k) => `> - [link ${k}](x)`).join("\n");
    expect(boundMarkdown(items)).toBe(items);
  });

  it("a fence inside a directive container ends with it; container lines stay outside raw text", () => {
    const bad = "[".repeat(1100);
    const md = `:::note\n~~~\n:::\n${bad}`;
    expect(boundMarkdown(md)).toBe(`:::note\n~~~\n:::\n${asRawText(bad)}`);
    const inside = `:::note\n${bad}\n:::`;
    expect(boundMarkdown(inside)).toBe(`:::note\n${asRawText(bad)}\n:::`);
  });

  it("front matter passes through; nothing raw starts inside it", () => {
    const bad = "[".repeat(1100);
    const md = `---\ntitle: x\ntags: [a]\n---\n${bad}`;
    expect(boundMarkdown(md)).toBe(`---\ntitle: x\ntags: [a]\n---\n${asRawText(bad)}`);
  });

  it("a fence or $$ region with a line nested past the bound is raw text as a whole", () => {
    const deep = "- ".repeat(MAX_CONTAINER_DEPTH + 5) + "x";
    const md = `$$\n${deep}\n$$`;
    expect(boundMarkdown(md)).toBe(asRawText(md));
    const code = "```js\nconst a = [[[1]]];\n```";
    expect(boundMarkdown(`${code}\n\n${deep}`)).toBe(`${code}\n\n${asRawText(deep)}`);
  });
});
