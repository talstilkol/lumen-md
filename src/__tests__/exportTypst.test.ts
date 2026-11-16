/**
 * W12.F2: Markdown → Typst source. Unit tests for each construct, plus the
 * first 10 Hebrew docs pages of this repository (real text) through the
 * writer. When pandoc (which has a Typst reader) is on PATH, every output
 * is also parsed by it, and the Hebrew text must come back in order.
 */
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { escapeTypst, inlineTypst, markdownToTypst, texToTypstMath, typstBaseDirection } from "../storage/exportTypst";

describe("markdownToTypst", () => {
  it("a Hebrew note is lang he (right to left), an English one lang en", () => {
    expect(markdownToTypst("# שלום\n\nעולם\n")).toContain('#set text(lang: "he"');
    expect(markdownToTypst("# Hello\n\nworld\n")).toContain('#set text(lang: "en"');
  });

  it("a Hebrew note that opens with an English name is still a Hebrew document; dir: in frontmatter wins", () => {
    expect(typstBaseDirection("Lumen תומכת בכניסה יחידה דרך ספק הזהויות של הארגון.\n")).toBe("rtl");
    expect(typstBaseDirection("---\ndir: ltr\n---\nשלום עולם\n")).toBe("ltr");
    expect(typstBaseDirection("Hello world, שלום\n")).toBe("ltr");
  });

  it("a paragraph in the other direction is scoped to its own dir", () => {
    const typ = markdownToTypst("פסקה ארוכה בעברית עם כמה מילים.\n\nAn English one.\n");
    expect(typ).toContain('lang: "he"');
    expect(typ).toContain("\nפסקה ארוכה בעברית עם כמה מילים.\n");
    expect(typ).toContain("#[#set text(dir: ltr)\nAn English one.]");
    expect(markdownToTypst("English first.\n\nשורה בעברית.\n")).toContain("#[#set text(dir: rtl)\nשורה בעברית.]");
  });

  it("headings, emphasis, code, links and footnotes", () => {
    const typ = markdownToTypst("## כותרת\n\nטקסט **מודגש** ו*נטוי* עם `x = 1` ו[קישור](https://example.org/a_b)[^n].\n\n[^n]: הערה.\n");
    expect(typ).toContain("== כותרת");
    expect(typ).toContain("#strong[מודגש]");
    expect(typ).toContain("#emph[נטוי]");
    expect(typ).toContain('#raw("x = 1")');
    expect(typ).toContain('#link("https://example.org/a_b")[קישור]');
    expect(typ).toContain("#footnote[הערה.]");
    expect(typ).not.toContain("[^n]");
  });

  it("lists nest, numbered lists use +, task boxes are kept", () => {
    const typ = markdownToTypst("- פרי\n  - תפוח\n- [x] נעשה\n\n1. אחד\n2. שתיים\n");
    expect(typ).toContain("- פרי\n  - תפוח\n- ☑ נעשה");
    expect(typ).toContain("+ אחד\n+ שתיים");
  });

  it("a pipe table becomes #table with a header and start/end alignment (start is the right edge in Hebrew)", () => {
    const typ = markdownToTypst("| שם | ציון |\n| --- | ---: |\n| דנה | 95 |\n");
    expect(typ).toContain("columns: 2");
    expect(typ).toContain("align: (start, end,)");
    expect(typ).toContain("table.header([שם], [ציון])");
    expect(typ).toContain("[דנה], [95],");
  });

  it("fenced code keeps its language and its lines; raw stays left to right", () => {
    const typ = markdownToTypst("```python\nprint('שלום')\nx = 2\n```\n");
    expect(typ).toContain(`#raw("print('שלום')\\nx = 2", block: true, lang: "python")`);
    expect(typ).toContain("#show raw: set text(dir: ltr)");
  });

  it("frontmatter becomes the document title and is not printed", () => {
    const typ = markdownToTypst('---\ntitle: "סיכום"\ntags: [a]\n---\n\nגוף\n');
    expect(typ).toContain('#set document(title: "סיכום")');
    expect(typ).not.toContain("tags");
  });

  it("markup characters in text are escaped, so a URL's // is not a comment", () => {
    expect(escapeTypst("a // b #c $d *e* _f_ @g <h>")).toBe("a \\/\\/ b \\#c \\$d \\*e\\* \\_f\\_ \\@g \\<h\\>");
    expect(inlineTypst("ראו https://x.org/y")).toBe("ראו https:\\/\\/x.org\\/y");
  });

  it("math: the common TeX subset is translated, anything else stays raw", () => {
    expect(texToTypstMath("\\frac{a}{b}")).toBe("(a)/(b)");
    expect(texToTypstMath("x^2 + y_{i}")).toBe("x^(2) + y_(i)");
    expect(texToTypstMath("\\sqrt{\\alpha \\cdot \\beta}")).toBe("sqrt(alpha dot beta)");
    expect(texToTypstMath("\\sum_{i=1}^{n} i \\le \\infty")).toBe("sum_(i=1)^(n) i <= infinity");
    expect(texToTypstMath("\\begin{pmatrix}a\\end{pmatrix}")).toBeNull();
    expect(markdownToTypst("$$\n\\frac{1}{2}\n$$\n")).toContain("$ (1)/(2) $");
    expect(markdownToTypst("$\\mathbb{R}$\n")).toContain('#raw("\\\\mathbb{R}")');
  });
});

const isHebrew = (s: string) => (s.match(/[\u0590-\u05FF]/g)?.length ?? 0) > (s.match(/[A-Za-z]/g)?.length ?? 0);
const heDir = "docs/src/content/docs/he";
const notes = (readdirSync(heDir, { recursive: true }) as string[])
  .filter((n) => n.endsWith(".md"))
  .sort()
  .map((n) => ({ name: n, md: readFileSync(join(heDir, n), "utf8") }))
  .filter((n) => isHebrew(n.md))
  .slice(0, 10);

const hasPandoc = spawnSync("pandoc", ["--version"]).status === 0;
/** pandoc 3.1's Typst reader predates table.header and quote (Typst 0.11 / 0.9); those are swapped for older equivalents only for this check. */
const forOldPandoc = (typ: string) => typ.replace(/table\.header\((.*)\),$/gm, "$1,").replace(/#quote\(block: true\)\[/g, "#block[");

describe("10 Hebrew docs pages", () => {
  it("convert without leaving Markdown syntax behind", () => {
    expect(notes).toHaveLength(10);
    for (const n of notes) {
      const typ = markdownToTypst(n.md);
      expect(typ, n.name).toContain('lang: "he"');
      expect(typ, n.name).not.toMatch(/^#{1,6} /m);
      expect(typ, n.name).not.toMatch(/\*\*[^*\n]+\*\*/);
    }
  });

  // skip-reason: pandoc is an outside program, not an npm dependency; the check runs where pandoc is on PATH (the Mac run) | task: W12.F2 | until: 2027-05-16
  it.skipIf(!hasPandoc)("pandoc's Typst reader parses every one, and the Hebrew words come back in order", () => {
    for (const n of notes) {
      const typ = forOldPandoc(markdownToTypst(n.md));
      const text = execFileSync("pandoc", ["-f", "typst", "-t", "plain", "--wrap=none"], { input: typ, encoding: "utf8" });
      const words = (s: string) => s.match(/[\u05D0-\u05EA]{3,}/g) ?? [];
      // Emphasis markers go first: in `ו*מקומי*` the letters join into one word once rendered.
      const src = words(n.md.replace(/^---[\s\S]*?\n---\n/, "").replace(/```[\s\S]*?```/g, "").replace(/[*_`]/g, ""));
      const back = words(text);
      // Same Hebrew words in the same order (the reader may drop table borders, not words).
      expect(back.slice(0, 40), n.name).toEqual(src.slice(0, 40));
    }
  });
});
