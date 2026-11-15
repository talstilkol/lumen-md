/**
 * W11.I14: heading-aware chunks (200-400 tokens, overlap) with a context
 * prefix (title › headings · tags), embedded as prefix + overlap + text.
 * The retrieval gain (≥ +3 nDCG@10 on HeQ / MLDR) is measured in W11.M5;
 * here: the chunking rules, and that indexing does no more embedding work
 * than today's chunker (the cost that dominates indexing time).
 */
import { describe, it, expect } from "vitest";
import { contextualText, frontmatterTags, headingChunks, CHUNK_MAX_TOKENS } from "../ai/headingChunks";
import { chunkMarkdown } from "../ai/semanticSearch";
import { estimateTokens } from "../ai/usage";

const para = (n: number, word = "budget") => Array.from({ length: n }, (_, i) => `${word} line ${i} with a few more words to fill it.`).join(" ");

describe("heading chunks", () => {
  it("prefixes each chunk with the title, the heading path and the tags", () => {
    const note = `---\ntags: [travel, family]\n---\n# Trip to Eilat\n\nIntro.\n\n## Costs\n\n### Budget\n\nHotel 3000, flights 1200.\n\n## Packing\n\nSunscreen.\n`;
    const chunks = headingChunks(note, { min: 1 });
    expect(chunks.map((c) => c.prefix)).toEqual(["Trip to Eilat · #travel #family", "Trip to Eilat › Costs · #travel #family", "Trip to Eilat › Costs › Budget · #travel #family", "Trip to Eilat › Packing · #travel #family"]);
    const budget = chunks.find((c) => c.text.includes("Hotel"))!;
    expect(contextualText(budget).startsWith("Trip to Eilat › Costs › Budget · #travel #family\n")).toBe(true);
  });

  it("offsets point at the chunk's own text in the note", () => {
    const note = `# A\n\n${para(10)}\n\n## B\n\n${para(10, "תקציב")}\n`;
    for (const c of headingChunks(note)) expect(note.slice(c.start, c.end)).toBe(c.text);
  });

  it("joins short sibling sections up to the minimum, and keeps every chunk at most the maximum", () => {
    const note = `# Notes\n\n${["a", "b", "c", "d", "e", "f"].map((h) => `## ${h}\n\nshort ${h}.`).join("\n\n")}\n`;
    const chunks = headingChunks(note);
    expect(chunks.length).toBeLessThan(6);
    const long = `# Long\n\n${para(400)}\n\n${para(400)}\n`;
    const pieces = headingChunks(long);
    expect(pieces.length).toBeGreaterThan(2);
    for (const c of pieces) expect(estimateTokens(c.text)).toBeLessThanOrEqual(CHUNK_MAX_TOKENS + 1);
  });

  it("a cut section carries the previous piece's last ~50 tokens as overlap (embedded only)", () => {
    const pieces = headingChunks(`# Long\n\n${para(300)}\n`);
    expect(pieces[0]!.overlap).toBe("");
    expect(pieces[1]!.overlap.length).toBeGreaterThan(0);
    expect(pieces[0]!.text.endsWith(pieces[1]!.overlap)).toBe(true);
    expect(estimateTokens(pieces[1]!.overlap)).toBeGreaterThanOrEqual(45);
    expect(estimateTokens(pieces[1]!.overlap)).toBeLessThanOrEqual(60);
    expect(contextualText(pieces[1]!)).toContain(`… ${pieces[1]!.overlap}`);
  });

  it("a '#' inside fenced code is not a heading (today's chunker cuts there)", () => {
    const note = "# Setup\n\n```bash\n# install\nnpm i\n```\n\nDone.\n";
    expect(headingChunks(note, { min: 1 }).map((c) => c.headings)).toEqual([["Setup"]]);
    expect(chunkMarkdown(note).length).toBe(2);
  });

  it("reads tags in the inline, list and comma forms; the file name is the title when there is no H1", () => {
    expect(frontmatterTags("---\ntags: a, b\n---\nx")).toEqual(["a", "b"]);
    expect(frontmatterTags("---\ntags:\n  - x\n  - y\n---\nz")).toEqual(["x", "y"]);
    expect(headingChunks("## Only\n\nbody", { title: "my-note", min: 1 })[0]!.prefix).toBe("my-note › Only");
  });

  it("indexing work: on a vault of 10,000 notes, no more chunks to embed than today's chunker (×1.2 at most), and it runs in linear time", () => {
    const notes: string[] = [];
    for (let i = 0; i < 10_000; i++) {
      const sections = 1 + (i % 6);
      notes.push(`---\ntags: [t${i % 7}]\n---\n# Note ${i}\n\n${para(3 + (i % 5))}\n\n${Array.from({ length: sections }, (_, k) => `## Part ${k}\n\n${para(2 + ((i + k) % 9), i % 2 ? "שורה" : "line")}`).join("\n\n")}\n`);
    }
    let today = 0;
    let ours = 0;
    const t0 = performance.now();
    for (const n of notes) today += chunkMarkdown(n).length;
    const t1 = performance.now();
    for (const n of notes) ours += headingChunks(n).length;
    const t2 = performance.now();
    // eslint-disable-next-line no-console
    console.log(`CHUNKS today=${today} ours=${ours} ratio=${(ours / today).toFixed(3)} todayMs=${Math.round(t1 - t0)} oursMs=${Math.round(t2 - t1)}`);
    expect(ours / today).toBeLessThanOrEqual(1.2);
    // One long note without headings: linear, not quadratic.
    const huge = `# Huge\n\n${para(20_000)}`;
    const t3 = performance.now();
    const hugeChunks = headingChunks(huge);
    expect(performance.now() - t3).toBeLessThan(2000);
    expect(hugeChunks.length).toBeGreaterThan(100);
  });
});
