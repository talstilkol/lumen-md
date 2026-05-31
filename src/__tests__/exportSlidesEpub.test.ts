/**
 * Tests for the Reveal.js and EPUB exporters. The EPUB test round-trips the
 * exported bytes back through the real EPUB importer (which reads container.xml
 * → OPF spine), proving a valid, readable package — not just a string blob.
 */
import { describe, it, expect } from "vitest";
import {
  markdownToRevealHtml,
  markdownToEpubBytes,
  markdownToStaticSiteBytes,
} from "../storage/exportFormats";
import { unzip } from "../storage/zip";
import { epubToMarkdown } from "../storage/fileFormats";

function fileFrom(bytes: Uint8Array, name: string): File {
  return {
    name,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as File;
}

describe("markdownToRevealHtml", () => {
  it("splits on --- into Reveal sections and links the runtime", () => {
    const md = "# Slide A\n\ncontent a\n\n---\n\n# Slide B\n\ncontent b";
    const html = markdownToRevealHtml(md, "Deck");
    expect(html).toContain("reveal.js");
    expect(html).toContain("RevealMarkdown");
    expect((html.match(/<section data-markdown>/g) || []).length).toBe(2);
    expect(html).toContain("Slide A");
    expect(html).toContain("Slide B");
  });
});

describe("markdownToEpubBytes", () => {
  it("produces a valid EPUB whose parts a reader (our importer) can read back", async () => {
    const md = "# Chapter One\n\nHello **world**.\n\n# Chapter Two\n\nSecond chapter.";
    const bytes = await markdownToEpubBytes(md, "My Book");

    // Structural: required EPUB parts present, mimetype stored first.
    const files = await unzip(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    expect(new TextDecoder().decode(files.get("mimetype")!)).toBe("application/epub+zip");
    expect(files.has("META-INF/container.xml")).toBe(true);
    expect(files.has("OEBPS/content.opf")).toBe(true);
    expect(files.has("OEBPS/nav.xhtml")).toBe(true);

    // Round-trip: import the EPUB we just exported.
    const md2 = await epubToMarkdown(fileFrom(bytes, "book.epub"));
    expect(md2).toContain("# Chapter One");
    expect(md2).toContain("# Chapter Two");
    expect(md2.indexOf("Chapter One")).toBeLessThan(md2.indexOf("Chapter Two"));
  });
});

describe("markdownToStaticSiteBytes", () => {
  it("builds a multi-page site (index + page per H1 + css + rss) with cross-nav", async () => {
    const md = "# Getting Started\n\nIntro text.\n\n# API Reference\n\n- one\n- two";
    const bytes = await markdownToStaticSiteBytes(md, "Docs");
    const files = await unzip(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    const names = [...files.keys()];
    expect(names).toContain("index.html");
    expect(names).toContain("style.css");
    expect(names).toContain("feed.xml");
    expect(names).toContain("getting-started.html");
    expect(names).toContain("api-reference.html");

    const page = new TextDecoder().decode(files.get("getting-started.html")!);
    // Sidebar links to every page (cross-navigation works).
    expect(page).toContain('href="api-reference.html"');
    expect(page).toContain("Intro text");
    expect(page).toContain('<link rel="stylesheet" href="style.css"');

    const rss = new TextDecoder().decode(files.get("feed.xml")!);
    expect(rss).toContain("<rss");
    expect(rss).toContain("API Reference");
  });
});
