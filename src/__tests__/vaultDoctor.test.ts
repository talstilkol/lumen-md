import { describe, it, expect } from "vitest";
import { applyLinkFixes, formatDoctorReport, runVaultDoctor, stripCode, type DoctorNote } from "../lint/vaultDoctor";

const para = (seed: string) =>
  Array.from({ length: 60 }, (_, i) => `${seed}${i % 7} word${i} alpha beta gamma`).join(" ");

const NOTES: DoctorNote[] = [
  { path: "index.md", text: "# Home\n\nSee [[Project Plan]], [[projects/alpha#Goals]] and [[Meeting Notes]].\n" },
  { path: "Project Plan.md", text: "# Plan\n\n## Steps\n\nBack to [[index]]. Broken: [[Projct Plan]] and [[Nowhere At All]].\n\n[[#Steps]] [[#Missing]]\n" },
  { path: "projects/alpha.md", text: "# Alpha\n\n## Scope\n\n[Plan](../Project%20Plan.md) and [gone](./beta.md).\n\n![](diagram.png)\n<img src=\"x.png\">\n<img src=\"y.png\" alt=\"ok\">\n" },
  { path: "Meeting Notes.md", text: "```md\n[[Not A Link]]\n```\nInline `[[Also Not]]`.\n" + para("m") },
  { path: "archive/Meeting Notes copy.md", text: para("m") + " extra" },
  { path: "lonely.md", text: "---\ntags: [x]\n---\n" },
  { path: "dup/alpha.md", text: "# Other alpha\n" },
];

describe("vault doctor", () => {
  const findings = runVaultDoctor(NOTES);
  const of = (kind: string) => findings.filter((f) => f.kind === kind);

  it("finds broken wiki links with a suggestion when one note is close", () => {
    expect(of("broken-wiki-link").map((f) => [f.path, f.detail, f.suggestion ?? null])).toEqual([
      ["Project Plan.md", "Projct Plan", "Project Plan"],
      ["Project Plan.md", "Nowhere At All", null],
    ]);
    expect(of("broken-wiki-link")[0].line).toBe(5);
  });

  it("checks headings of the target and of the note itself", () => {
    expect(of("missing-heading").map((f) => f.detail).sort()).toEqual(["#Missing", "projects/alpha#Goals"]);
  });

  it("checks relative Markdown links, decoding and resolving ..", () => {
    expect(of("broken-md-link").map((f) => [f.path, f.detail])).toEqual([["projects/alpha.md", "./beta.md"]]);
  });

  it("ignores links inside code", () => {
    expect(findings.some((f) => /Not A Link|Also Not/.test(f.detail ?? ""))).toBe(false);
    expect(stripCode("a `b` c")).toBe("a     c");
  });

  it("reports images without alt, empty notes, ambiguous names and orphans", () => {
    expect(of("missing-alt").map((f) => f.detail)).toEqual(["diagram.png", '<img src="x.png">']);
    expect(of("empty-note").map((f) => f.path)).toEqual(["lonely.md"]);
    expect(of("ambiguous-name").map((f) => f.path).sort()).toEqual(["dup/alpha.md", "projects/alpha.md"]);
    // index is an entry point; Meeting Notes / Project Plan / alpha are linked.
    expect(of("orphan").map((f) => f.path).sort()).toEqual(["archive/Meeting Notes copy.md", "dup/alpha.md", "lonely.md"]);
  });

  it("finds near-duplicates with MinHash", () => {
    const d = of("near-duplicate");
    expect(d).toHaveLength(1);
    expect([d[0].path, d[0].detail].sort()).toEqual(["Meeting Notes.md", "archive/Meeting Notes copy.md"]);
    expect(d[0].similarity).toBeGreaterThanOrEqual(0.8);
  });

  it("applies link fixes, keeping headings and labels", () => {
    const text = "[[Projct Plan]] and [[Projct Plan#Steps|the steps]] but `[[Projct Plan]]` in code";
    expect(applyLinkFixes(text, [{ from: "Projct Plan", to: "Project Plan" }])).toBe(
      "[[Project Plan]] and [[Project Plan#Steps|the steps]] but `[[Projct Plan]]` in code",
    );
  });

  it("formats a report with links and the fix hint", () => {
    const md = formatDoctorReport(findings, NOTES.length, new Date("2026-10-16T12:00:00Z"));
    expect(md).toContain("Checked 7 notes on 2026-10-16");
    expect(md).toContain("## Broken wiki links (2)");
    expect(md).toContain("did you mean [[Project Plan]]?");
    expect(md).toContain("Apply Suggested Link Fixes");
  });
});
