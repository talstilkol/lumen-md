import { describe, it, expect } from "vitest";
import { convert, listFormats, handleConvert } from "../cli/convert";

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
