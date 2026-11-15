/**
 * Plan W1.18 (W10.E41): word order on multi-column pages, ≥ 95%.
 *
 * The pages here are SYNTHETIC (src/__tests__/helpers/ocrLayoutBench.ts): seeded word
 * boxes of two- and three-column Hebrew pages with narrow gutters (0.6–2
 * line heights), headings, footers, lines tesseract ran across the gutter
 * and lines it cut in two. They are not scans and not OCR output; the real
 * column pages (the ocr-he dev split `mixed`, scripts/ocr/cer-node.mjs and
 * e2e/ocr-cer.spec.ts) stay the gate. Scored with the acceptance's own
 * metric, lineOrderAccuracy, through the pipeline ocr.ts runs:
 * splitAtGutters → layoutLines → layoutText.
 */
import { describe, expect, it } from "vitest";
import { benchPage, benchPages, type BenchOptions } from "./helpers/ocrLayoutBench";
import { defaultGap, defaultGutter, isRtlPage, layoutLines, layoutText, lineOrderAccuracy, splitAtGutters } from "../ai/ocrLayout";
import type { BenchPage } from "./helpers/ocrLayoutBench";

/** What ocr.ts does with tesseract's lines, then the metric. */
function score(pages: BenchPage[]) {
  let correct = 0;
  let total = 0;
  for (const p of pages) {
    const rtl = isRtlPage(p.lines.map((l) => l.text));
    const minGutter = defaultGutter(p.lines);
    const lines = splitAtGutters(p.lines, minGutter, rtl, defaultGap(p.lines));
    const placed = layoutLines(lines, lines.map((l) => l.text), { rtl, minGutter });
    const o = lineOrderAccuracy(p.reference, layoutText(placed));
    correct += o.correct;
    total += o.total;
  }
  return { correct, total, share: correct / total };
}

const plain: BenchOptions = { columns: 2, gutter: 2, merged: 0, cut: 0, heading: false, footer: false };
const pages = (o: Partial<BenchOptions>, n = 12) => Array.from({ length: n }, (_, i) => benchPage(900 + i, { ...plain, ...o }));

describe("the synthetic bench", () => {
  it("is seeded: the same pages every run, each with a reference in reading order", () => {
    const a = benchPages(5, 3);
    const b = benchPages(5, 3);
    expect(a.map((p) => p.reference)).toEqual(b.map((p) => p.reference));
    expect(a.every((p) => p.lines.length > 10 && p.reference.split("\n").length > 10)).toBe(true);
  });
});

describe("word order on column pages (acceptance ≥ 95%)", () => {
  it("the whole bench: 80 pages, two and three columns, every slip mixed in", () => {
    const r = score(benchPages(80, 7));
    expect(r.total).toBeGreaterThan(3000);
    expect(r.share).toBeGreaterThanOrEqual(0.95);
  });

  it("gutters narrower than 1.5 line heights: about one line height, and 0.6 (the base read these across the columns)", () => {
    expect(score(pages({ gutter: 1 })).share).toBeGreaterThanOrEqual(0.95);
    expect(score(pages({ gutter: 0.6 })).share).toBeGreaterThanOrEqual(0.95);
  });

  it("a narrow gutter with lines tesseract ran across it, a heading and a footer, three columns", () => {
    expect(score(pages({ gutter: 0.8, merged: 0.1, heading: true, footer: true })).share).toBeGreaterThanOrEqual(0.95);
    expect(score(pages({ columns: 3, gutter: 0.8, merged: 0.08, cut: 0.06, heading: true })).share).toBeGreaterThanOrEqual(0.95);
  });
});
