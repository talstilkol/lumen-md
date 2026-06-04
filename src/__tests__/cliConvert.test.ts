import { describe, it, expect } from "vitest";
import { convert, listFormats, handleConvert, convertBinary, isBinaryTarget } from "../cli/convert";
import { unzip } from "../storage/zip";

describe("CLI convert (headless, DOM-free)", () => {
  const md = "# Title\n\nSome **bold** text.\n\n```python\nprint(1)\n```";

  it("exports Markdown to LaTeX / RST / RTF / ipynb", () => {
    const tex = convert("doc.md", md, "tex");
    expect(tex.outName).toBe("doc.tex");
    expect(tex.outText).toContain("\\section");

    expect(convert("doc.md", md, "rst").outText.length).toBeGreaterThan(5);
    expect(convert("doc.md", md, "rtf").outText).toContain("\\rtf");

    const nb = JSON.parse(convert("doc.md", md, "ipynb").outText);
    expect(nb.nbformat).toBe(4);
    expect(nb.cells.some((c: { cell_type: string }) => c.cell_type === "code")).toBe(true);
  });

  it("imports LaTeX / CSV / ipynb to Markdown", () => {
    const tex = convert("a.tex", "\\section{Hi}\nbody");
    expect(tex.outName).toBe("a.md");
    expect(tex.outText).toContain("Hi");

    expect(convert("data.csv", "x,y\n1,2").outText).toContain("|");

    const nb = JSON.stringify({
      nbformat: 4,
      cells: [{ cell_type: "markdown", source: ["# Hello"] }],
    });
    expect(convert("nb.ipynb", nb).outText).toContain("# Hello");
  });

  it("throws on unsupported formats", () => {
    expect(() => convert("a.xyz", "x")).toThrow(/Unknown source/);
    expect(() => convert("a.md", "x", "xyz")).toThrow(/Unknown export/);
  });

  it("lists the supported import/export formats", () => {
    const f = listFormats();
    expect(f.export).toContain("tex");
    expect(f.export).toContain("ipynb");
    expect(f.import).toContain("csv");
    expect(f.import).toContain("latex");
  });
});

describe("handleConvert (HTTP API handler)", () => {
  it("converts a valid payload", () => {
    const out = handleConvert({ name: "doc.md", text: "# Hi\n\nbody", to: "tex" });
    expect(out.name).toBe("doc.tex");
    expect(out.text).toContain("\\section");
  });
  it("rejects payloads missing name/text", () => {
    expect(() => handleConvert({ text: "x" })).toThrow(/required/);
    expect(() => handleConvert({ name: "a.md" })).toThrow(/required/);
  });
});

describe("convertBinary (md → docx/epub)", () => {
  const unzipBytes = (b: Uint8Array) =>
    unzip(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

  it("flags binary targets", () => {
    expect(isBinaryTarget("docx")).toBe(true);
    expect(isBinaryTarget("epub")).toBe(true);
    expect(isBinaryTarget("tex")).toBe(false);
  });

  it("produces a valid .docx (zip with word/document.xml)", async () => {
    const { outName, bytes } = await convertBinary("doc.md", "# Title\n\n- one\n- two", "docx");
    expect(outName).toBe("doc.docx");
    const files = await unzipBytes(bytes);
    expect(files.has("word/document.xml")).toBe(true);
    expect(new TextDecoder().decode(files.get("word/document.xml")!)).toContain("Title");
  });

  it("produces a multi-part .epub", async () => {
    const { outName, bytes } = await convertBinary("doc.md", "# Chapter\n\nbody", "epub");
    expect(outName).toBe("doc.epub");
    const files = await unzipBytes(bytes);
    expect(files.size).toBeGreaterThan(1);
  });

  it("rejects non-markdown input and unknown targets", async () => {
    await expect(convertBinary("a.tex", "x", "docx")).rejects.toThrow(/Markdown input/);
    await expect(convertBinary("a.md", "x", "xyz")).rejects.toThrow(/Unknown binary/);
  });
});
