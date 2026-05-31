/**
 * Tests for the zero-dep ZIP reader/writer and the real DOCX/ODT/EPUB
 * importers built on top of it. We build genuine *compressed* archives with
 * the writer and feed them back through the reader + converters — so this
 * exercises the actual DecompressionStream code path, not a regex over bytes.
 */
import { describe, it, expect } from "vitest";
import { zip, unzip, unzipText } from "../storage/zip";
import {
  docxToMarkdown,
  odtToMarkdown,
  epubToMarkdown,
  pptxToMarkdown,
  xlsxToMarkdown,
  archiveToMarkdown,
} from "../storage/fileFormats";

function fileFrom(bytes: Uint8Array, name: string): File {
  return {
    name,
    text: async () => new TextDecoder().decode(bytes),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as File;
}

// Force a long body so the writer deflates it (exercises inflate on read).
const padding = " lorem ipsum dolor sit amet".repeat(10);

describe("zip reader/writer round-trip", () => {
  it("deflates and inflates a multi-entry archive", async () => {
    const archive = await zip([
      { name: "a.txt", data: "hello " + padding },
      { name: "dir/b.txt", data: "world " + padding },
    ]);
    const files = await unzip(archive.buffer);
    expect(new TextDecoder().decode(files.get("a.txt")!)).toContain("hello");
    expect(new TextDecoder().decode(files.get("dir/b.txt")!)).toContain("world");
  });

  it("stores tiny entries verbatim", async () => {
    const archive = await zip([{ name: "small", data: "hi", store: true }]);
    expect(await unzipText(archive.buffer, "small")).toBe("hi");
  });
});

describe("docxToMarkdown (real DOCX)", () => {
  it("extracts headings, bold/italic, lists and tables from a compressed DOCX", async () => {
    const documentXml = `<?xml version="1.0"?>
<w:document xmlns:w="x">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Title Here</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r><w:r><w:t> and </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>italic</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>list item</w:t></w:r></w:p>
    <w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>H1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>H2</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
  </w:body>
</w:document>${padding.replace(/\S/g, " ")}`;
    const archive = await zip([
      { name: "[Content_Types].xml", data: "<types/>", store: true },
      { name: "word/document.xml", data: documentXml },
    ]);
    const md = await docxToMarkdown(fileFrom(archive, "doc.docx"));
    expect(md).toContain("# Title Here");
    expect(md).toContain("**Bold**");
    expect(md).toContain("*italic*");
    expect(md).toContain("- list item");
    expect(md).toContain("| H1 | H2 |");
    expect(md).toContain("| a | b |");
  });

  it("returns a clear message when document.xml is missing", async () => {
    const archive = await zip([{ name: "junk", data: "x" }]);
    const md = await docxToMarkdown(fileFrom(archive, "x.docx"));
    expect(md).toContain("⚠️");
  });
});

describe("odtToMarkdown (real ODT)", () => {
  it("extracts headings and paragraphs from a compressed ODT", async () => {
    const contentXml = `<?xml version="1.0"?>
<office:document-content xmlns:office="o" xmlns:text="t">
  <office:body><office:text>
    <text:h text:outline-level="2">Section</text:h>
    <text:p>Some paragraph text ${padding}</text:p>
    <text:list><text:list-item><text:p>point one</text:p></text:list-item></text:list>
  </office:text></office:body>
</office:document-content>`;
    const archive = await zip([{ name: "content.xml", data: contentXml }]);
    const md = await odtToMarkdown(fileFrom(archive, "x.odt"));
    expect(md).toContain("## Section");
    expect(md).toContain("Some paragraph text");
    expect(md).toContain("- point one");
  });
});

describe("epubToMarkdown (real EPUB)", () => {
  it("follows the OPF spine in reading order", async () => {
    const ch1 = `<html><body><h1>Chapter One</h1><p>First ${padding}</p></body></html>`;
    const ch2 = `<html><body><h1>Chapter Two</h1><p>Second ${padding}</p></body></html>`;
    const container = `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>`;
    const opf = `<?xml version="1.0"?><package>
      <manifest>
        <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
        <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
    </package>`;
    const archive = await zip([
      { name: "mimetype", data: "application/epub+zip", store: true },
      { name: "META-INF/container.xml", data: container },
      { name: "OEBPS/book.opf", data: opf },
      { name: "OEBPS/ch1.xhtml", data: ch1 },
      { name: "OEBPS/ch2.xhtml", data: ch2 },
    ]);
    const md = await epubToMarkdown(fileFrom(archive, "book.epub"));
    expect(md).toContain("# Chapter One");
    expect(md).toContain("# Chapter Two");
    expect(md.indexOf("Chapter One")).toBeLessThan(md.indexOf("Chapter Two"));
  });
});

describe("pptxToMarkdown (real PPTX)", () => {
  it("converts slides in order to headings + bullets", async () => {
    const slide = (title: string, ...bullets: string[]) =>
      `<?xml version="1.0"?><p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>` +
      `<p:sp><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p>` +
      bullets.map((b) => `<a:p><a:r><a:t>${b}</a:t></a:r></a:p>`).join("") +
      `</p:txBody></p:sp></p:spTree></p:cSld></p:sld>${padding.replace(/\S/g, " ")}`;
    const archive = await zip([
      { name: "ppt/slides/slide1.xml", data: slide("First Slide", "alpha", "beta") },
      { name: "ppt/slides/slide2.xml", data: slide("Second Slide", "gamma") },
    ]);
    const md = await pptxToMarkdown(fileFrom(archive, "deck.pptx"));
    expect(md).toContain("## First Slide");
    expect(md).toContain("- alpha");
    expect(md).toContain("- beta");
    expect(md).toContain("## Second Slide");
    expect(md).toContain("- gamma");
    expect(md.indexOf("First Slide")).toBeLessThan(md.indexOf("Second Slide"));
  });
});

describe("xlsxToMarkdown (real XLSX)", () => {
  it("resolves shared strings and renders a worksheet as a table", async () => {
    const sharedStrings =
      `<?xml version="1.0"?><sst xmlns="s"><si><t>Name</t></si><si><t>Qty</t></si>` +
      `<si><t>apple</t></si><si><t>pear</t></si></sst>`;
    const workbook = `<?xml version="1.0"?><workbook><sheets><sheet name="Inventory"/></sheets></workbook>`;
    const sheet =
      `<?xml version="1.0"?><worksheet><sheetData>` +
      `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>` +
      `<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>5</v></c></row>` +
      `<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>2</v></c></row>` +
      `</sheetData></worksheet>${padding.replace(/\S/g, " ")}`;
    const archive = await zip([
      { name: "xl/sharedStrings.xml", data: sharedStrings },
      { name: "xl/workbook.xml", data: workbook },
      { name: "xl/worksheets/sheet1.xml", data: sheet },
    ]);
    const md = await xlsxToMarkdown(fileFrom(archive, "book.xlsx"));
    expect(md).toContain("## Inventory");
    expect(md).toContain("| Name | Qty |");
    expect(md).toContain("| apple | 5 |");
    expect(md).toContain("| pear | 2 |");
  });
});

describe("archiveToMarkdown (Notion / Obsidian zip)", () => {
  it("merges markdown files, cleans Notion hash names, adds H1 when missing, renders CSV", async () => {
    const archive = await zip([
      // Notion-style filename with a 32-hex id and no leading H1.
      {
        name: "Export/My Page 0123456789abcdef0123456789abcdef.md",
        data: "Body text with an [[Obsidian wikilink]].\n" + padding,
      },
      // Obsidian-style note that already has its own H1.
      { name: "Export/notes/Topic.md", data: "# Topic\n\nAlready has a heading." },
      // A database export.
      { name: "Export/Table.csv", data: "a,b\n1,2\n3,4" },
    ]);
    const md = await archiveToMarkdown(fileFrom(archive, "export.zip"));
    expect(md).toContain("# My Page"); // hash stripped, H1 synthesized
    expect(md).not.toContain("0123456789abcdef");
    expect(md).toContain("[[Obsidian wikilink]]"); // wikilinks preserved
    expect(md).toContain("# Topic"); // existing H1 kept (not doubled)
    expect(md).toContain("## Table");
    expect(md).toContain("| a | b |");
  });
});
