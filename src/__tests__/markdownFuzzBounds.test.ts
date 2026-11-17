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
 * list hiding a 40-level line (#21240). Replaying all 59 of its findings
 * then found: a lone CR read as part of a line (#555134 #196813), a backtick
 * fence with a backtick in its info string and `$$` with text after it
 * taken as fences (#618854 #747704), and lists nested in footnote
 * definitions (#158774 #694468). The final run: a directive container's
 * label of thousands of brackets (#21616 #33882 #38881), and a stray
 * backtick in a table row hiding deep HTML (#970703). The fourth: a
 * container line full of open <div> (#48699), code spans paired the wrong
 * way (#428652), thousands of "- " in one run (GFM autolink literal:
 * #10898 #193112 #150847 #401308), and parse5 throwing on an end tag split
 * across raw nodes (#511908: rehypeRawSafe shows that HTML as text).
 */
import { describe, it, expect } from "vitest";
import { generate } from "../../scripts/fuzz/generators";
import { asRawText, boundMarkdown, MAX_BRACKETS, MAX_CONTAINER_DEPTH, MAX_DELIMITERS, MAX_HTML_DEPTH, needsBounding } from "../renderer/boundMarkdown";
import { renderMarkdown } from "../renderer/pipeline";

const FOUND = [655, 17957, 93, 185, 17976, 19495, 9178, 2101, 3877, 12929, 16139, 11087, 1459, 4812, 17461, 21240, 25369, 29767, 72864, 76842, 93948, 555134, 196813, 618854, 747704, 158774, 694468, 21616, 33882, 38881, 970703, 48699, 428652, 511908, 10898, 193112, 150847, 401308];

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
    // Elements the parser closes itself do not count.
    const cells = "<table>" + "<tr><td>a".repeat(400) + "</table>";
    expect(boundMarkdown(cells)).toBe(cells);
    const row = "| a ` b | " + "<div>".repeat(MAX_HTML_DEPTH + 1) + " |\n| c ` d |";
    expect(needsBounding(row)).toBe(true);
    // Tags in code spans count too (where a span ends depends on the whole
    // paragraph); within the bound such a note is unchanged.
    const code = Array.from({ length: 200 }, () => "Write `<div>` to open a block.").join("\n");
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
    const label = `:::note${bad}`;
    expect(boundMarkdown(`${label}\ntext\n:::`)).toBe(`${asRawText(label)}\ntext\n:::`);
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

  it("a lone CR is a line ending: `$$\\r` closes the math block", () => {
    const bad = "[".repeat(1100);
    const md = `$$\nx\n$$\r${bad}`;
    expect(boundMarkdown(md)).toBe(`$$\nx\n$$\r${asRawText(bad)}`);
    const crlf = "# A\r\n\r\ntext\r\n\r\n";
    expect(boundMarkdown(crlf + bad)).toBe(crlf + asRawText(bad));
  });

  it("reads fence openers as CommonMark does", () => {
    const bad = "[".repeat(1100);
    // A backtick in a backtick fence's info string: a paragraph, not a fence.
    expect(boundMarkdown("```a`b\n" + bad)).toBe(asRawText("```a`b\n" + bad));
    // `$$` with text after it opens math; the next `$$` closes it.
    expect(boundMarkdown(`$$ meta\nx\n$$\n\n${bad}`)).toBe(`$$ meta\nx\n$$\n\n${asRawText(bad)}`);
  });

  it("counts lists nested in a footnote definition, in a quote too", () => {
    const deep = "> [^a]: " + "- ".repeat(MAX_CONTAINER_DEPTH + 2) + "x";
    expect(needsBounding(deep)).toBe(true);
    expect(needsBounding("[^a]: a footnote with - dashes - in it")).toBe(false);
  });

  it("raw HTML with a style that is not CSS renders (the attribute is dropped)", async () => {
    await expect(renderMarkdown('a <b style=x>bold</b> <svg style="color:">x</svg>', () => false)).resolves.toBeTruthy();
  });

  // Review 10 M2: an element opened in a paragraph closes with it, unless
  // the parser keeps it open past the paragraph (block, formatting, scoping
  // elements) or it is in an HTML block.
  it("generics in code spans and prose do not carry over to later blocks (review 10 M2)", () => {
    const code = Array.from({ length: 300 }, (_, i) => `Step ${i}: call \`load<T>()\` and return \`Promise<void>\`.`).join("\n\n");
    expect(boundMarkdown(code)).toBe(code);
    const prose = Array.from({ length: 300 }, (_, i) => `A List<String> ${i} or a Map<K, V> here.`).join("\n\n");
    expect(boundMarkdown(prose)).toBe(prose);
  });

  it("elements that stay open past their paragraph still carry (review 10 M2)", () => {
    // Formatting elements are reopened in every later paragraph.
    const bold = Array.from({ length: MAX_HTML_DEPTH + 1 }, (_, i) => `a <b title=${i}>`).join("\n\n");
    expect(needsBounding(bold)).toBe(true);
    // A line that is one tag is an HTML block: nothing closes it.
    const blocks = Array.from({ length: MAX_HTML_DEPTH + 1 }, () => "<x>").join("\n\n");
    expect(needsBounding(blocks)).toBe(true);
    // A <pre> block goes on past blank lines; the paragraphs in it are HTML.
    const pre = "<pre>\n\n" + Array.from({ length: MAX_HTML_DEPTH + 1 }, () => "a<x>").join("\n\n");
    expect(needsBounding(pre)).toBe(true);
    expect(boundMarkdown(pre)).not.toBe(pre);
  });

  it("an end tag closes only an element of its name; <x/> opens x outside svg (review 10)", () => {
    const mismatched = "<x></y>".repeat(MAX_HTML_DEPTH + 1);
    expect(needsBounding(mismatched)).toBe(true);
    const slash = "<div/>".repeat(MAX_HTML_DEPTH + 1);
    expect(needsBounding(slash)).toBe(true);
    const icon = "<svg>" + '<path d="M0 0"/>'.repeat(MAX_HTML_DEPTH + 1) + "</svg>";
    expect(boundMarkdown(icon)).toBe(icon);
  });

  // Review 10 M3: a row of a GFM table is an inline run of its own.
  it("a table without leading pipes is one run per row (review 10 M3)", () => {
    const rows = ["date | from | to | note", "--- | --- | --- | ---", ...Array.from({ length: 200 }, (_, i) => `2024-01-${(i % 28) + 1} | 2024-02-01 | 2024-03-01 | re-run`)];
    expect(boundMarkdown(rows.join("\n"))).toBe(rows.join("\n"));
    const after = "Some text\n" + rows.join("\n");
    expect(boundMarkdown(after)).toBe(after);
  });

  it("a line starting with | outside a table is paragraph text (review 10)", () => {
    const md = "|[\n".repeat(MAX_BRACKETS + 1);
    expect(needsBounding(md)).toBe(true);
  });

  it("a header the parser does not read as one starts no table (review 10 M3)", () => {
    const rest = "\n" + "[c\n".repeat(MAX_BRACKETS + 1);
    // Lazy ends of a list item, a footnote and a quote paragraph: one paragraph to the parser.
    for (const head of ["- x\na | b\n--- | ---", "[^1]: a | b\n--- | ---", "> a | b\n--- | ---", "a | b | c\n--- | ---", "a \\| b\n--- | ---"]) {
      expect(needsBounding(head + rest), head).toBe(true);
    }
    // The same with the lines after them indented into the item, or quoted: still that one paragraph.
    expect(needsBounding("- x\na | b\n--- | ---\n" + "  [c\n".repeat(MAX_BRACKETS + 1))).toBe(true);
    expect(needsBounding("> a | b\n--- | ---\n" + "> [c\n".repeat(MAX_BRACKETS + 1))).toBe(true);
    // A table inside a list item, and a row that starts another block ends the table.
    expect(needsBounding("- x\n  a | b\n  --- | ---\n  c\nd" + rest)).toBe(true);
    expect(needsBounding("a | b\n--- | ---\n<div>" + rest)).toBe(true);
  });
});
