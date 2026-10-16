// @vitest-environment node
import { describe, it, expect } from "vitest";
import { renderHtmlDocument } from "../storage/exportHtml";

describe("static HTML export of Lumen blocks", () => {
  it("serializes interactive blocks as their source, not a never-hydrated placeholder", async () => {
    const md = "# Doc\n\n```mermaid\ngraph TD; Alpha-->Beta\n```\n\n```chart\ntype: bar\ndata: [1, 2, 3]\n```\n";
    const html = await renderHtmlDocument(md, { title: "Doc" });
    expect(html).toContain("Alpha--&gt;Beta");
    expect(html).toContain("type: bar");
    expect(html).toContain("lumen-static-block");
    expect(html).not.toMatch(/data-lumen-block-pending|Loading /);
  });
});
