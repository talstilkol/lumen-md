/**
 * Review 11, L6 (#1071): an HTML comment's text is not elements. A long
 * comment with tag-like text in it is left as it is; tags nested past the
 * bound after a comment (also after the empty forms `<!-->` and `<!--->`)
 * are still bounded.
 */
import { describe, expect, it } from "vitest";
import { boundMarkdown, MAX_HTML_DEPTH, needsBounding } from "../renderer/boundMarkdown";

const tags = (n: number) => Array.from({ length: n }, (_, i) => `<x${i}>`);
const deep = "<div>".repeat(MAX_HTML_DEPTH + 20);

describe("HTML comments and the HTML depth bound (review 11, L6)", () => {
  it("a long comment holding tag-like text is not fenced", () => {
    const md = ["<!--", ...tags(1000), "-->", "", "after"].join("\n");
    expect(needsBounding(md)).toBe(false);
    expect(boundMarkdown(md)).toBe(md);
  });

  it("the same across blank lines, and an inline comment in a paragraph", () => {
    const md = ["<!--", ...tags(300), "", ...tags(300), "", ...tags(300), "-->", "", "after"].join("\n");
    expect(boundMarkdown(md)).toBe(md);
    const inline = `text <!-- ${tags(600).join(" ")} --> more`;
    expect(boundMarkdown(inline)).toBe(inline);
  });

  it("tags past the bound after a comment are still bounded", () => {
    for (const before of ["<!-- note -->", "<!-->", "<!--->"]) {
      const md = `${before}\n${deep}\n`;
      expect(needsBounding(md), before).toBe(true);
      expect(boundMarkdown(md), before).not.toBe(md);
    }
  });

  it("deep tags outside the comment, after it closes across blank lines, are bounded", () => {
    const md = ["<!--", "", ...tags(10), "", "-->", "", deep].join("\n");
    expect(needsBounding(md)).toBe(true);
  });
});
