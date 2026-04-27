/**
 * Tests for the markdown → other-format exporters.
 * Each one is a pure string transform — no DOM, no fetch.
 */

import { describe, it, expect } from "vitest";
import {
  markdownToRtf,
  markdownToLatex,
  markdownToRst,
  markdownToAdoc,
  markdownToOrg,
  markdownToOpml,
} from "../storage/exportFormats";

const SAMPLE = `# Title

Some **bold** and *italic* and \`code\`.

- one
- two
- three

\`\`\`js
const x = 1;
\`\`\`
`;

describe("markdownToRtf", () => {
  it("starts with the RTF magic header", () => {
    const rtf = markdownToRtf(SAMPLE);
    expect(rtf.startsWith("{\\rtf1")).toBe(true);
    expect(rtf).toContain("Title");
    expect(rtf).toContain("\\b "); // bold
  });
  it("ends with the closing brace", () => {
    expect(markdownToRtf("hi").trim().endsWith("}")).toBe(true);
  });
});

describe("markdownToLatex", () => {
  it("emits a documentclass + begin/end document", () => {
    const tex = markdownToLatex(SAMPLE);
    expect(tex).toContain("\\documentclass{article}");
    expect(tex).toContain("\\begin{document}");
    expect(tex).toContain("\\end{document}");
  });
  it("converts headings to \\section{}", () => {
    expect(markdownToLatex("# Hi")).toContain("\\section{Hi}");
    expect(markdownToLatex("## Hi")).toContain("\\subsection{Hi}");
  });
  it("converts bullets to itemize", () => {
    const tex = markdownToLatex("- one\n- two");
    expect(tex).toContain("\\begin{itemize}");
    expect(tex).toContain("\\item one");
    expect(tex).toContain("\\end{itemize}");
  });
  it("escapes LaTeX special chars in text", () => {
    expect(markdownToLatex("100% off & free")).toContain("100\\% off \\& free");
  });
});

describe("markdownToRst", () => {
  it("renders heading as text + underline of equal length", () => {
    const rst = markdownToRst("# Hello");
    const lines = rst.split("\n");
    expect(lines[0]).toBe("Hello");
    expect(lines[1]).toBe("=====");
  });
  it("uses '-' for h2 and '~' for h3", () => {
    expect(markdownToRst("## Foo").split("\n")[1]).toBe("---");
    expect(markdownToRst("### Foo").split("\n")[1]).toBe("~~~");
  });
  it("converts inline code to double backticks", () => {
    expect(markdownToRst("Try `npm test`")).toContain("``npm test``");
  });
});

describe("markdownToAdoc", () => {
  it("uses '=' instead of '#' for headings", () => {
    expect(markdownToAdoc("# Hi")).toContain("= Hi");
    expect(markdownToAdoc("## Hi")).toContain("== Hi");
  });
  it("converts bullets to '*'", () => {
    expect(markdownToAdoc("- one\n- two")).toContain("* one");
  });
});

describe("markdownToOrg", () => {
  it("uses '*' instead of '#' for headings", () => {
    expect(markdownToOrg("# Hi")).toContain("* Hi");
    expect(markdownToOrg("## Hi")).toContain("** Hi");
  });
  it("uses '/italic/' and '=code='", () => {
    const org = markdownToOrg("Some *italic* and `code`");
    expect(org).toContain("/italic/");
    expect(org).toContain("=code=");
  });
  it("wraps code blocks with #+BEGIN_SRC / #+END_SRC", () => {
    const org = markdownToOrg("```js\nconst x = 1\n```");
    expect(org).toContain("#+BEGIN_SRC js");
    expect(org).toContain("#+END_SRC");
  });
});

describe("markdownToOpml", () => {
  it("emits an OPML envelope with body + outline tags", () => {
    const opml = markdownToOpml("- one\n- two\n  - nested\n", "List");
    expect(opml).toContain('<?xml version="1.0"');
    expect(opml).toContain("<opml");
    expect(opml).toContain('<title>List</title>');
    expect(opml).toContain('<outline text="one">');
    expect(opml).toContain('<outline text="nested">');
  });
});
