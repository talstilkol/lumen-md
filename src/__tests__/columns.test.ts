/**
 * Tests for the `:::columns{cols=N}` directive (γ.1.c).
 *
 * The renderer transforms a `containerDirective` named `columns` into
 * a CSS-grid div with `grid-template-columns: repeat(N, 1fr)`. We
 * render markdown through `renderMarkdown` (returns a React element)
 * and serialise to HTML via renderToString.
 */

import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { renderMarkdown } from "../renderer/pipeline";

async function md2html(src: string): Promise<string> {
  const node = await renderMarkdown(src, () => true);
  return renderToString(node);
}

describe(":::columns directive", () => {
  it("renders a 2-column grid when `cols=2` is supplied", async () => {
    const html = await md2html(
      ":::columns{cols=2}\nLeft body.\n:::\nRight body.\n:::\n",
    );
    expect(html).toContain("lumen-columns");
    expect(html).toMatch(/grid-template-columns:\s*repeat\(2,\s*1fr\)/);
    const columnHits = html.match(/lumen-column/g) ?? [];
    expect(columnHits.length).toBeGreaterThanOrEqual(2);
  });

  it("clamps cols above 6 down to 6", async () => {
    const html = await md2html(":::columns{cols=99}\na\n:::\n");
    expect(html).toMatch(/repeat\(6,\s*1fr\)/);
  });

  it("ignores non-`columns` directives (`:::note` still becomes admonition)", async () => {
    const html = await md2html(":::note\nhello\n:::\n");
    expect(html).toContain("admonition");
    expect(html).not.toContain("lumen-columns");
  });
});
