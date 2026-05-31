/**
 * Tests for the *new* import-format converters (LaTeX, RST, AsciiDoc,
 * Org, OPML, MHTML). The DOCX/CSV/JSON/XML/HTML converters were already
 * covered by `fileFormats.test.ts` — this file fills the gap.
 */

import { describe, it, expect } from "vitest";
import {
  latexToMarkdown,
  rstToMarkdown,
  adocToMarkdown,
  orgToMarkdown,
  opmlToMarkdown,
  mhtmlToMarkdown,
  legacyDocToMarkdown,
} from "../storage/fileFormats";

// jsdom's File doesn't implement .arrayBuffer(); mirror fsConvert's stand-in.
function docFile(bytes: Uint8Array | number[]): File {
  const arr = new Uint8Array(bytes);
  return {
    name: "legacy.doc",
    arrayBuffer: async () => arr.buffer,
    text: async () => new TextDecoder().decode(arr),
  } as unknown as File;
}

describe("latexToMarkdown", () => {
  it("strips preamble and document wrappers", () => {
    const tex = `\\documentclass{article}\n\\begin{document}\n\\section{Hi}\nbody\n\\end{document}\n`;
    const md = latexToMarkdown(tex);
    expect(md).not.toContain("\\documentclass");
    expect(md).not.toContain("\\begin{document}");
    expect(md).toContain("## Hi");
    expect(md).toContain("body");
  });
  it("converts \\textbf and \\textit to markdown emphasis", () => {
    const md = latexToMarkdown("\\textbf{bold} \\textit{em}");
    expect(md).toContain("**bold**");
    expect(md).toContain("*em*");
  });
  it("converts \\section/subsection/subsubsection to # / ## / ###", () => {
    const md = latexToMarkdown("\\section{S}\n\\subsection{SS}\n\\subsubsection{SSS}");
    expect(md).toContain("## S");
    expect(md).toContain("### SS");
    expect(md).toContain("#### SSS");
  });
});

describe("rstToMarkdown", () => {
  it("converts underlined headings", () => {
    const rst = "Hello\n=====\n\nbody";
    const md = rstToMarkdown(rst);
    expect(md).toContain("# Hello");
    expect(md).toContain("body");
  });
  it("converts double-backtick inline code", () => {
    expect(rstToMarkdown("see ``npm test``")).toContain("`npm test`");
  });
});

describe("adocToMarkdown", () => {
  it("converts = headings to #", () => {
    expect(adocToMarkdown("= Title")).toContain("# Title");
    expect(adocToMarkdown("== Sub")).toContain("## Sub");
  });
  it("converts ``inline`` to `inline`", () => {
    expect(adocToMarkdown("see ``foo``")).toContain("`foo`");
  });
});

describe("orgToMarkdown", () => {
  it("converts * Heading to # Heading", () => {
    expect(orgToMarkdown("* Top\n** Sub")).toContain("# Top");
    expect(orgToMarkdown("* Top\n** Sub")).toContain("## Sub");
  });
  it("converts =code= to `code`", () => {
    expect(orgToMarkdown("see =foo=")).toContain("`foo`");
  });
  it("converts /italic/ to *italic*", () => {
    expect(orgToMarkdown("be /careful/")).toContain("*careful*");
  });
});

describe("opmlToMarkdown", () => {
  it("renders nested outlines as bullets", () => {
    const opml = `<?xml version="1.0"?><opml><head><title>List</title></head><body>
      <outline text="root">
        <outline text="child"/>
      </outline>
    </body></opml>`;
    const md = opmlToMarkdown(opml);
    expect(md).toContain("# List");
    expect(md).toContain("- root");
    expect(md).toContain("- child");
  });
  it("includes RSS xmlUrl as a markdown link target", () => {
    const opml = `<?xml version="1.0"?><opml><head/><body>
      <outline text="Feed" xmlUrl="https://example.com/rss"/>
    </body></opml>`;
    expect(opmlToMarkdown(opml)).toContain("[Feed](https://example.com/rss)");
  });
});

describe("mhtmlToMarkdown", () => {
  it("falls through to htmlToMarkdown when no boundary header is present", () => {
    expect(mhtmlToMarkdown("<h1>Hi</h1><p>body</p>")).toContain("# Hi");
  });
  it("picks the text/html part out of a multipart envelope", () => {
    const text = `Content-Type: multipart/related; boundary="X"

--X
Content-Type: text/plain

ignore me
--X
Content-Type: text/html

<h1>Hello</h1><p>web archive</p>
--X--`;
    const md = mhtmlToMarkdown(text);
    expect(md).toContain("# Hello");
    expect(md).toContain("web archive");
    expect(md).not.toContain("ignore me");
  });
});

describe("legacyDocToMarkdown (honest, no binary garbage)", () => {
  it("returns an honest notice instead of dumping noise when nothing is readable", async () => {
    const garbage = new Uint8Array(256).fill(0);
    garbage.set([0x01, 0x02, 0x03, 0x7f, 0x80, 0xff], 10);
    const out = await legacyDocToMarkdown(docFile(garbage));
    expect(out).toContain("Legacy .doc");
    expect(out).toContain("No readable text could be recovered");
    // Crucially: the fallback ends with the notice — no binary was appended.
    expect(out.trimEnd().endsWith("legacy .doc file._")).toBe(true);
  });

  it("recovers embedded readable text from surrounding binary", async () => {
    const sentence = "This is a readable paragraph extracted from the document file.";
    const pad = new Uint8Array(24); // zero bytes around the text
    const body = new TextEncoder().encode(sentence);
    const out = await legacyDocToMarkdown(docFile([...pad, ...body, ...pad]));
    expect(out).toContain(sentence);
    expect(out).not.toContain("No readable text could be recovered");
  });

  it("reroutes a .doc that is really RTF to the RTF converter", async () => {
    const rtf = new TextEncoder().encode("{\\rtf1\\ansi Hello from RTF}");
    const out = await legacyDocToMarkdown(docFile(rtf));
    expect(out).toContain("Hello");
    expect(out).not.toContain("Legacy .doc"); // took the RTF path, not the fallback
  });
});
