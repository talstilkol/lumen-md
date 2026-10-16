// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { previewClickMessage, resolveWikiNote, splitWikiTarget } from "../src/wikiLinks";

const anchor = (html: string) => {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.querySelector("a")!;
};

describe("wiki links in the VS Code preview", () => {
  it("sends unresolved [[Note]] links to the extension, keeps real in-page anchors", () => {
    const wiki = anchor('<a href="#other-page" class="wiki-link" data-wiki-target="Other Page">x</a>');
    expect(previewClickMessage(wiki, () => false)).toEqual({ type: "openWikiLink", target: "Other Page" });
    expect(previewClickMessage(wiki, (id) => id === "other-page")).toBeNull();
    expect(previewClickMessage(anchor('<a href="#install">i</a>'), () => false)).toBeNull();
    expect(previewClickMessage(anchor('<a href="next.md">n</a>'), () => false)).toEqual({ type: "openLink", href: "next.md" });
    // [[#Heading]] is same-note only.
    const self = anchor('<a href="#top" class="wiki-link" data-wiki-target="#Top">t</a>');
    expect(previewClickMessage(self, () => false)).toBeNull();
  });

  it("resolves note names and fragments like the app", () => {
    expect(splitWikiTarget("Guide#Install")).toEqual({ note: "Guide", heading: "Install" });
    const paths = ["README.md", "docs/Guide.md", "notes/other page.markdown"];
    expect(resolveWikiNote("guide", paths)).toBe("docs/Guide.md");
    expect(resolveWikiNote("Other Page", paths)).toBe("notes/other page.markdown");
    expect(resolveWikiNote("docs/Guide.md", paths)).toBe("docs/Guide.md");
    expect(resolveWikiNote("missing", paths)).toBeNull();
  });
});
