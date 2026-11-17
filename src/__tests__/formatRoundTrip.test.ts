/**
 * W12.F1: Markdown → X → Markdown for Org, AsciiDoc, LaTeX, OPML, RST and
 * ipynb, measured on the 652 CommonMark 0.31.2 spec examples (public) and on
 * 50 sections of the repository's own Hebrew docs, frozen in
 * fixtures/format-roundtrip/hebrew-notes.json (scripts/format-roundtrip-corpus.mjs)
 * so that a docs edit cannot move the gate: it measures converters only.
 *
 * The scores are measurements, not targets: the gate is that no format and no
 * element type drops more than one point below the committed baseline
 * (fixtures/format-roundtrip/baseline.json). Raising a score is fine; update
 * the baseline upward in the same PR. Report: test-results/format-roundtrip/.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { markdownToOpml } from "../storage/exportFormats";
// @ts-expect-error -- plain .mjs script without type declarations
import { validate as validateCorpus } from "../../scripts/format-roundtrip-corpus.mjs";
import { opmlToMarkdown } from "../storage/markupFormats";
import {
  HEBREW_SECTION,
  ROUND_TRIP_FORMATS,
  extractSpecExamples,
  measureFormat,
  normalizedTree,
  regressions,
  reportMarkdown,
  roundTrip,
  survives,
  type CorpusItem,
  type FormatReport,
} from "../storage/formatRoundTrip";

const spec = readFileSync("src/__tests__/fixtures/md-spec/commonmark-0.31.2.txt", "utf8");
const baseline = JSON.parse(readFileSync("src/__tests__/fixtures/format-roundtrip/baseline.json", "utf8")) as {
  formats: Record<string, { overall: number; bySection: Record<string, number> }>;
};

const isHebrew = (s: string) => (s.match(/[֐-׿]/g)?.length ?? 0) > (s.match(/[A-Za-z]/g)?.length ?? 0);

/** The frozen Hebrew notes: what the gate measures does not change when docs/ does. */
const frozen = JSON.parse(readFileSync("src/__tests__/fixtures/format-roundtrip/hebrew-notes.json", "utf8")) as {
  licence: string;
  frozenAt: string;
  notes: { file: string; markdown: string }[];
};

const examples = extractSpecExamples(spec);
const hebrewNotes: CorpusItem[] = frozen.notes.map((n) => ({ section: HEBREW_SECTION, markdown: n.markdown }));
const corpus: CorpusItem[] = [
  ...examples.map((e) => ({ section: e.section, markdown: e.markdown, number: e.number })),
  ...hebrewNotes,
];

describe("spec example extraction", () => {
  it("finds all 652 CommonMark 0.31.2 examples with their sections", () => {
    expect(examples).toHaveLength(652);
    expect(examples[0].section).toBe("Tabs");
    expect(examples[0].markdown).toBe("\tfoo\tbaz\t\tbim\n");
    expect(examples.at(-1)!.section).toBe("Textual content");
    expect(new Set(examples.map((e) => e.section)).size).toBeGreaterThan(20);
  });

  it("takes 50 Hebrew notes from the repo's Hebrew docs, frozen with their source files", () => {
    expect(hebrewNotes).toHaveLength(50);
    for (const n of hebrewNotes) expect(isHebrew(n.markdown)).toBe(true);
    for (const n of frozen.notes) expect(n.file).toMatch(/^docs\/.+\.md$/);
    expect(new Set(frozen.notes.map((n) => n.markdown)).size).toBe(50);
    expect(frozen.licence).toMatch(/MIT/);
  });

  it("the Hebrew corpus does not follow docs/: an edited docs page leaves the measured notes as they were", () => {
    // The fixture passes the same check its script runs (50 notes, each over 80 characters, mostly Hebrew, from docs/, no duplicates).
    expect(validateCorpus(frozen)).toEqual([]);
    expect(validateCorpus({ ...frozen, notes: frozen.notes.slice(1) })).toContain("49 notes, want 50");
    // Nothing here reads docs/ at run time.
    expect(readFileSync(__filename, "utf8")).not.toMatch(/readdirSync\(\s*"docs"/);
  });
});

describe("normalization", () => {
  it("is blind to positions and inner whitespace, not to structure", () => {
    expect(normalizedTree("# a  b\n")).toBe(normalizedTree("#   a b\n"));
    expect(normalizedTree("# a\n")).not.toBe(normalizedTree("## a\n"));
    expect(normalizedTree("*a*\n")).not.toBe(normalizedTree("**a**\n"));
  });

  it("a heading survives every format", () => {
    for (const f of ROUND_TRIP_FORMATS) expect(survives(f, "## כותרת\n"), f).toBe(true);
  });

  it("LaTeX keeps every heading level (fixed here: \\section came back as ##, so every heading moved down one level)", () => {
    const md = "# א\n\n## ב\n\n### ג\n\n#### ד\n\n##### ה\n";
    expect(roundTrip("latex", md).trim()).toBe(md.trim());
    expect(survives("latex", "# Title\n\ntext\n\n## Sub\n")).toBe(true);
  });

  it("LaTeX keeps numbered and nested lists, list starts and code languages", () => {
    for (const md of [
      "1. אחד\n2. שתיים\n",
      "3. c\n4. d\n",
      "- a\n  - b\n    1. c\n- d\n",
      "- a\n\n  more\n- b\n",
      "```js\nlet x = 1;\n```\n",
      "- foo\n- bar\n+ baz\n",
      "a \\ b {c} 50% #1 x_y\n",
    ])
      expect(survives("latex", md), `${md} → ${roundTrip("latex", md)}`).toBe(true);
  });

  it("bold and italic survive Org and AsciiDoc (fixed here: bold came back as italic)", () => {
    const md = "האפשרות **כבויה** ו-*נטוי* במאגר.\n";
    for (const f of ["org", "adoc"] as const) {
      expect(survives(f, md), `${f}: ${roundTrip(f, md)}`).toBe(true);
      expect(survives(f, "**למי:** טל. **זמן:** 15 דקות.\n"), f).toBe(true);
    }
  });

  it("an Org heading is not joined to a later bold (fixed here: ** spanned lines)", () => {
    expect(survives("org", "## הצעדים\n\nטקסט **מודגש** כאן.\n")).toBe(true);
  });

  it("OPML keeps a list outline; the envelope title is not content", () => {
    expect(roundTrip("opml", "- a\n  - b\n")).toBe("- a\n  - b");
    expect(survives("opml", "- a\n  - b\n")).toBe(true);
  });

  it("OPML keeps headings as outline levels, with lists as child outlines (fixed here: only lists survived)", () => {
    const md = "## פרק\n\n- א\n  - ב\n\n### סעיף\n\nטקסט **מודגש**.\n\n# Top\n";
    const opml = markdownToOpml(md, "Outline");
    expect(opml).toContain('<outline text="פרק" _heading="2">');
    expect(opml).toMatch(/<outline text="פרק" _heading="2">\n\s+<outline text="א">\n\s+<outline text="ב">/);
    expect(opml).toContain('<outline text="סעיף" _heading="3">');
    expect(opml).toContain('_note="טקסט **מודגש**."');
    expect(roundTrip("opml", md).trim()).toBe(md.trim());
    for (const s of ["# a\n\n## b\n\n#### c\n", "intro\n\n# a\n\ntext\nmore\n"]) expect(survives("opml", s), s).toBe(true);
  });

  it("OPML from an outliner: an outline with _note (pandoc, OmniOutliner) is a heading", () => {
    const opml = `<?xml version="1.0"?><opml version="2.0"><head><title>T</title></head><body>
      <outline text="Chapter" _note="Body text."><outline text="Section" _note=""><outline text="item"/></outline></outline>
    </body></opml>`;
    expect(opmlToMarkdown(opml)).toBe("# T\n\n# Chapter\n\nBody text.\n\n## Section\n\n- item");
  });

  it("Org keeps bold inside a Hebrew word, code with markup characters, code languages and rules", () => {
    for (const md of [
      "ב**קובץ** ו-*נטוי* ב`קוד`.\n",
      "`a*b*c` and `=x=`\n",
      "```python\nx = *y*\n```\n",
      "~~~\n```\n~~~\n",
      "para\n\n***\n\nnext\n",
      "** not a heading\n",
      "snake_case and _italic_\n",
    ])
      expect(survives("org", md), `${JSON.stringify(md)} → ${JSON.stringify(roundTrip("org", md))}`).toBe(true);
  });

  it("AsciiDoc keeps intraword bold and italic (unconstrained marks), code blocks and rules", () => {
    for (const md of [
      "ב**קובץ** and foo*bar*baz\n",
      "__strong__ and _em_ and snake_case\n",
      "```js\nlet a = *b*;\n```\n",
      "a ` `` ` b\n",
      "para\n\n---\n\nnext\n",
    ])
      expect(survives("adoc", md), `${JSON.stringify(md)} → ${JSON.stringify(roundTrip("adoc", md))}`).toBe(true);
  });
});

describe("round trip per format against the baseline (fails on a drop of more than one point)", () => {
  const reports: Record<string, FormatReport> = {};
  for (const f of ROUND_TRIP_FORMATS) reports[f] = measureFormat(f, corpus);

  it("writes the report", () => {
    mkdirSync("test-results/format-roundtrip", { recursive: true });
    const sources =
      "Sources: CommonMark spec 0.31.2 examples (652, https://spec.commonmark.org/0.31.2/, CC-BY-SA 4.0) " +
      `and ${hebrewNotes.length} Hebrew sections of this repository's docs/ (MIT), frozen at ${frozen.frozenAt}. Equality is on the remark-parse tree.`;
    writeFileSync("test-results/format-roundtrip/report.md", reportMarkdown(Object.values(reports), sources));
    writeFileSync("test-results/format-roundtrip/report.json", JSON.stringify(reports, null, 1));
    if (process.env.FORMAT_RT_BASELINE) {
      const out = {
        note: "Measured by src/__tests__/formatRoundTrip.test.ts. A drop of more than 1 point fails; raise only.",
        formats: Object.fromEntries(
          Object.values(reports).map((r) => [
            r.format,
            { overall: r.overall.pct, bySection: Object.fromEntries(Object.entries(r.bySection).map(([k, v]) => [k, v.pct])) },
          ]),
        ),
      };
      writeFileSync("src/__tests__/fixtures/format-roundtrip/baseline.json", JSON.stringify(out, null, 1) + "\n");
    }
    for (const r of Object.values(reports)) expect(r.overall.total).toBe(702);
  });

  it("every format and element type is at or above its baseline (−1 point)", () => {
    expect(Object.keys(baseline.formats).sort()).toEqual([...ROUND_TRIP_FORMATS].sort());
    expect(regressions(reports, baseline.formats)).toEqual([]);
  });

  it("the gate catches a drop", () => {
    const broken = { ...reports, org: { ...reports.org, overall: { ...reports.org.overall, pct: reports.org.overall.pct - 1.5 } } };
    expect(regressions(broken, baseline.formats)).toContain(
      `org overall: ${broken.org.overall.pct}% < baseline ${baseline.formats.org.overall}%`,
    );
  });
});
