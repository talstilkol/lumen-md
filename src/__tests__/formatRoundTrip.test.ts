/**
 * W12.F1: Markdown → X → Markdown for Org, AsciiDoc, LaTeX, OPML, RST and
 * ipynb, measured on the 652 CommonMark 0.31.2 spec examples (public) and on
 * 50 sections of the repository's own Hebrew docs (Markdown files under docs/ that are mostly Hebrew; real project text).
 *
 * The scores are measurements, not targets: the gate is that no format and no
 * element type drops more than one point below the committed baseline
 * (fixtures/format-roundtrip/baseline.json). Raising a score is fine; update
 * the baseline upward in the same PR. Report: test-results/format-roundtrip/.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  HEBREW_SECTION,
  ROUND_TRIP_FORMATS,
  extractSpecExamples,
  measureFormat,
  normalizedTree,
  regressions,
  reportMarkdown,
  roundTrip,
  splitAtHeadings,
  survives,
  type CorpusItem,
  type FormatReport,
} from "../storage/formatRoundTrip";

const spec = readFileSync("src/__tests__/fixtures/md-spec/commonmark-0.31.2.txt", "utf8");
const baseline = JSON.parse(readFileSync("src/__tests__/fixtures/format-roundtrip/baseline.json", "utf8")) as {
  formats: Record<string, { overall: number; bySection: Record<string, number> }>;
};

/** Every Markdown file under docs/ (recursively, sorted), the project's own docs. */
function docsFiles(): string[] {
  return (readdirSync("docs", { recursive: true }) as string[])
    .filter((n) => n.endsWith(".md"))
    .sort()
    .map((n) => join("docs", n));
}

const isHebrew = (s: string) => (s.match(/[֐-׿]/g)?.length ?? 0) > (s.match(/[A-Za-z]/g)?.length ?? 0);

const examples = extractSpecExamples(spec);
const hebrewNotes: CorpusItem[] = docsFiles()
  .flatMap((f) => splitAtHeadings(readFileSync(f, "utf8")))
  .filter((s) => isHebrew(s) && s.length > 80)
  .slice(0, 50)
  .map((markdown) => ({ section: HEBREW_SECTION, markdown }));
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

  it("takes 50 Hebrew notes from the repo's Hebrew docs", () => {
    expect(hebrewNotes).toHaveLength(50);
    for (const n of hebrewNotes) expect(isHebrew(n.markdown)).toBe(true);
  });
});

describe("normalization", () => {
  it("is blind to positions and inner whitespace, not to structure", () => {
    expect(normalizedTree("# a  b\n")).toBe(normalizedTree("#   a b\n"));
    expect(normalizedTree("# a\n")).not.toBe(normalizedTree("## a\n"));
    expect(normalizedTree("*a*\n")).not.toBe(normalizedTree("**a**\n"));
  });

  it("a heading survives every format but LaTeX and OPML", () => {
    for (const f of ROUND_TRIP_FORMATS.filter((f) => f !== "opml" && f !== "latex")) expect(survives(f, "## כותרת\n"), f).toBe(true);
  });

  it("known loss, recorded: LaTeX export writes # as \\section, the importer reads \\section as ##", () => {
    expect(roundTrip("latex", "# כותרת\n").trim()).toBe("## כותרת");
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
});

describe("round trip per format against the baseline (fails on a drop of more than one point)", () => {
  const reports: Record<string, FormatReport> = {};
  for (const f of ROUND_TRIP_FORMATS) reports[f] = measureFormat(f, corpus);

  it("writes the report", () => {
    mkdirSync("test-results/format-roundtrip", { recursive: true });
    const sources =
      "Sources: CommonMark spec 0.31.2 examples (652, https://spec.commonmark.org/0.31.2/, CC-BY-SA 4.0) " +
      `and ${hebrewNotes.length} Hebrew sections of this repository's docs/. Equality is on the remark-parse tree.`;
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
