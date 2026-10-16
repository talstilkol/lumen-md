/**
 * PPTX export — structural validation. Unzips the generated package and
 * checks every required OOXML part exists, every XML part is well-formed
 * (parsed with the DOM parser), and all relationship targets resolve.
 */
import { describe, it, expect } from "vitest";
import { markdownToPptxBytes, markdownToSlides, stripInlineMarkdown } from "../storage/exportPptx";
import { splitSlides } from "../storage/exportFormats";
import { unzip } from "../storage/zip";

async function unpack(bytes: Uint8Array): Promise<Map<string, string>> {
  const files = await unzip(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  const out = new Map<string, string>();
  for (const [k, v] of files) out.set(k, new TextDecoder().decode(v));
  return out;
}

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const err = doc.getElementsByTagName("parsererror");
  if (err.length) throw new Error(err[0].textContent || "parsererror");
  return doc;
}

const DECK = [
  "# Welcome",
  "",
  "Intro with **bold**, *italic*, `code` and a [link](https://x.y).",
  "",
  "## Agenda",
  "",
  "- First point",
  "- Second point",
  "  - Nested & a < b > c",
  "1. Ordered",
  "",
  "## Code",
  "",
  "```js",
  "const a = 1; // # not a heading",
  "```",
  "",
  "## שלום",
  "",
  "- פריט בעברית",
].join("\n");

describe("splitSlides", () => {
  it("splits on --- when present", () => {
    expect(splitSlides("# A\n\nx\n\n---\n\n## B\n\n# C")).toEqual(["# A\n\nx", "## B\n\n# C"]);
  });
  it("splits on H1/H2 when no --- is present", () => {
    expect(splitSlides("# A\nx\n## B\ny\n### C\nz")).toEqual(["# A\nx", "## B\ny\n### C\nz"]);
  });
  it("ignores headings and rules inside code fences", () => {
    expect(splitSlides("# A\n```\n# no\n---\n```\n## B")).toEqual(["# A\n```\n# no\n---\n```", "## B"]);
  });
});

describe("stripInlineMarkdown", () => {
  it("removes emphasis, code, links and html", () => {
    expect(stripInlineMarkdown("**b** _i_ `c` [l](u) ![a](i.png) <br> ~~s~~")).toBe("b i c l a  s");
  });
});

describe("markdownToSlides", () => {
  it("builds titled slides with bullets and code", () => {
    const slides = markdownToSlides(DECK, "Deck");
    expect(slides.map((s) => s.title)).toEqual(["Welcome", "Agenda", "Code", "שלום"]);
    expect(slides[0].body[0]).toEqual({ kind: "text", text: "Intro with bold, italic, code and a link." });
    expect(slides[1].body).toEqual([
      { kind: "bullet", text: "First point", level: 0, ordered: false },
      { kind: "bullet", text: "Second point", level: 0, ordered: false },
      { kind: "bullet", text: "Nested & a < b > c", level: 1, ordered: false },
      { kind: "bullet", text: "Ordered", level: 0, ordered: true },
    ]);
    expect(slides[2].body).toEqual([{ kind: "code", text: "const a = 1; // # not a heading" }]);
  });

  it("falls back to the deck title for an untitled first slide and strips frontmatter", () => {
    const slides = markdownToSlides("---\ntitle: x\n---\nJust text", "My Deck");
    expect(slides).toHaveLength(1);
    expect(slides[0].title).toBe("My Deck");
  });
});

describe("markdownToPptxBytes", () => {
  it("produces a complete, well-formed OOXML presentation", async () => {
    const files = await unpack(await markdownToPptxBytes(DECK, "Deck & Co"));
    const required = [
      "[Content_Types].xml",
      "_rels/.rels",
      "docProps/core.xml",
      "docProps/app.xml",
      "ppt/presentation.xml",
      "ppt/_rels/presentation.xml.rels",
      "ppt/slideMasters/slideMaster1.xml",
      "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      "ppt/slideLayouts/slideLayout1.xml",
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      "ppt/theme/theme1.xml",
      ...[1, 2, 3, 4].flatMap((i) => [`ppt/slides/slide${i}.xml`, `ppt/slides/_rels/slide${i}.xml.rels`]),
    ];
    for (const p of required) expect(files.has(p), p).toBe(true);
    expect(files.has("ppt/slides/slide5.xml")).toBe(false);

    // Every XML part parses.
    for (const [name, xml] of files) {
      if (/\.(xml|rels)$/.test(name)) expect(() => parseXml(xml), name).not.toThrow();
    }

    // Every slide has a content-type override and a presentation sldId.
    const ct = files.get("[Content_Types].xml")!;
    const pres = parseXml(files.get("ppt/presentation.xml")!);
    expect(pres.getElementsByTagName("p:sldId")).toHaveLength(4);
    for (let i = 1; i <= 4; i++) expect(ct).toContain(`/ppt/slides/slide${i}.xml`);

    // Every relationship target resolves to a part in the package.
    for (const [name, xml] of files) {
      if (!name.endsWith(".rels")) continue;
      const base = name.replace(/_rels\/[^/]*\.rels$/, "");
      for (const rel of Array.from(parseXml(xml).getElementsByTagName("Relationship"))) {
        const target = rel.getAttribute("Target")!;
        const parts = (base + target).split("/");
        const resolved: string[] = [];
        for (const seg of parts) {
          if (seg === "..") resolved.pop();
          else if (seg && seg !== ".") resolved.push(seg);
        }
        expect(files.has(resolved.join("/")), `${name} → ${target}`).toBe(true);
      }
    }

    // Text is escaped and present; code uses a monospace font; Hebrew is RTL.
    expect(files.get("docProps/core.xml")).toContain("Deck &amp; Co");
    expect(files.get("ppt/slides/slide2.xml")).toContain("Nested &amp; a &lt; b &gt; c");
    expect(files.get("ppt/slides/slide2.xml")).toContain('lvl="1"');
    expect(files.get("ppt/slides/slide2.xml")).toContain("buAutoNum");
    expect(files.get("ppt/slides/slide3.xml")).toContain('typeface="Courier New"');
    expect(files.get("ppt/slides/slide4.xml")).toContain('rtl="1"');
  });

  it("emits at least one slide for an empty document", async () => {
    const files = await unpack(await markdownToPptxBytes("", "Empty"));
    expect(files.has("ppt/slides/slide1.xml")).toBe(true);
    expect(files.get("ppt/slides/slide1.xml")).toContain("Empty");
  });
});

describe("splitSlides fence tracking (CommonMark)", () => {
  it("doesn't split on --- or headings inside a longer fence that shows a ``` block", async () => {
    const { splitSlides } = await import("../storage/exportFormats");
    const md = [
      "# One",
      "````md",
      "```js",
      "---",
      "# not a slide",
      "````",
      "---",
      "# Two",
    ].join("\n");
    const slides = splitSlides(md);
    expect(slides).toHaveLength(2);
    expect(slides[0]).toContain("# not a slide");
    expect(slides[1]).toBe("# Two");
  });

  it("doesn't close a ``` fence on ~~~ or a shorter run", async () => {
    const { createFenceTracker } = await import("../storage/exportFormats");
    const at = createFenceTracker();
    expect(at("````").inCode).toBe(true);
    expect(at("```")).toEqual({ fence: false, inCode: true });
    expect(at("~~~~")).toEqual({ fence: false, inCode: true });
    expect(at("`````")).toEqual({ fence: true, inCode: false });
  });
});

describe("markdownToSlides code fences", () => {
  it("keeps a line that merely starts with the fence marker inside the code block", async () => {
    const { markdownToSlides } = await import("../storage/exportPptx");
    const md = ["# Slide", "```js", "```not-a-close", "# still code", "- still code", "```", "- bullet"].join("\n");
    const [slide] = markdownToSlides(md);
    const code = slide.body.filter((p) => p.kind === "code").map((p) => p.text);
    expect(code).toEqual(["```not-a-close", "# still code", "- still code"]);
    expect(slide.body.some((p) => p.kind !== "code" && p.text.includes("bullet"))).toBe(true);
  });
});
