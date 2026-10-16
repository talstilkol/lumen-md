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

  it("handles formatted headings, reference links, same-note headings and ambiguous suggestions", () => {
    const notes: DoctorNote[] = [
      { path: "index.md", text: "[[Guide#Setup and run]] [[Guide#Missing]] [[Overview]]\n\n## Overview\n\n[ref]: ./gone.md\n[ok]: ./Guide.md \"Guide\"\n" },
      { path: "Guide.md", text: "## **Setup** and `run`\n\n[[Notez]]\n" },
      { path: "Overview.md", text: "x" },
      { path: "a/Notes.md", text: "x" },
      { path: "b/Notes.md", text: "x" },
    ];
    const f = runVaultDoctor(notes);
    // `## **Setup** and \`run\`` renders as "Setup and run".
    expect(f.filter((x) => x.kind === "missing-heading").map((x) => x.detail)).toEqual(["Guide#Missing"]);
    expect(f.filter((x) => x.kind === "broken-md-link").map((x) => x.detail)).toEqual(["./gone.md"]);
    // [[Overview]] is the heading in index itself: Overview.md gets no link from it.
    expect(f.some((x) => x.kind === "orphan" && x.path === "Overview.md")).toBe(true);
    // "Notez" is close to "Notes", but two notes are named Notes: no suggestion.
    const broken = f.find((x) => x.kind === "broken-wiki-link")!;
    expect([broken.detail, broken.suggestion]).toEqual(["Notez", undefined]);
  });

  it("longer closing fences, spaced angle-bracket links and case-insensitive names", () => {
    const notes: DoctorNote[] = [
      { path: "index.md", text: "```\n[[Inside Code]]\n````\n\n[[After Fence]] [plan](<Project Plan.md>) [x](<Missing Note.md>)\n\n[d]: <Other Plan.md>\n" },
      { path: "Project Plan.md", text: "x" },
      { path: "Other Plan.md", text: "x" },
      { path: "Notes.md", text: "x" },
      { path: "archive/notes.md", text: "x" },
    ];
    const f = runVaultDoctor(notes);
    expect(f.filter((x) => x.kind === "broken-wiki-link").map((x) => x.detail)).toEqual(["After Fence"]);
    expect(f.filter((x) => x.kind === "broken-md-link").map((x) => x.detail)).toEqual(["Missing Note.md"]);
    expect(f.some((x) => x.kind === "orphan" && /Plan/.test(x.path))).toBe(false);
    expect(f.filter((x) => x.kind === "ambiguous-name").map((x) => x.path).sort()).toEqual(["Notes.md", "archive/notes.md"]);
  });

  it("setext headings, multi-line / multi-backtick code spans and links above the root", () => {
    const notes: DoctorNote[] = [
      { path: "index.md", text: "Overview\n========\n\n[[Overview]] [[Guide#Usage]]\n\nA span `` a ` b\n[[Missing]] `` ends.\n\n[up](../Guide.md)\n" },
      { path: "Guide.md", text: "Usage\n-----\n" },
    ];
    const f = runVaultDoctor(notes);
    expect(f.filter((x) => x.kind === "broken-wiki-link" || x.kind === "missing-heading")).toEqual([]);
    expect(f.filter((x) => x.kind === "broken-md-link").map((x) => x.detail)).toEqual(["../Guide.md"]);
  });

  it("indented code, HTML comments, single-quoted titles and unquoted alt", () => {
    const notes: DoctorNote[] = [
      {
        path: "index.md",
        text:
          "Intro\n\n    [[In Indented Code]]\n\n- item\n\n    [[List Continuation]]\n\n<!-- [[Commented Out]] -->\n\n[g](Guide.md 'Guide') <img src=a.png alt=diagram>\n",
      },
      { path: "Guide.md", text: "x" },
    ];
    const f = runVaultDoctor(notes);
    expect(f.filter((x) => x.kind === "broken-wiki-link").map((x) => x.detail)).toEqual(["List Continuation"]);
    expect(f.some((x) => x.kind === "orphan" && x.path === "Guide.md")).toBe(false);
    expect(f.filter((x) => x.kind === "missing-alt")).toEqual([]);
  });

  it("fences in quotes and lists, duplicate heading ids, reference images", () => {
    const notes: DoctorNote[] = [
      { path: "index.md", text: "> ```\n> [[Quoted Code]]\n> ```\n\n- item\n  ```\n  [[List Code]]\n  ```\n\n[[Guide#setup-1]] [[Guide#setup-2]]\n\n![][logo]\n\n[logo]: chart.png\n" },
      { path: "Guide.md", text: "## Setup\n\n## Setup\n" },
    ];
    const f = runVaultDoctor(notes);
    expect(f.filter((x) => x.kind === "broken-wiki-link")).toEqual([]);
    expect(f.filter((x) => x.kind === "missing-heading").map((x) => x.detail)).toEqual(["Guide#setup-2"]);
    expect(f.filter((x) => x.kind === "missing-alt").map((x) => x.detail)).toEqual(["[logo]"]);
  });
});
