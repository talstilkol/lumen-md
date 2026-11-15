/**
 * SYNTHETIC multi-column page layouts for the reading-order code in src/ai/ocrLayout.ts
 * (plan W1.18, W10.E41). Not OCR output and not real scans:
 * seeded, generated word boxes of Hebrew (and some English) pages, with the
 * things that break a column reader on real pages: narrow gutters, ragged
 * line ends, a heading across the columns, a footer, paragraph gaps, lines
 * tesseract ran across the gutter, lines it cut in two, short last lines,
 * and jitter. Each page comes with its reference text in reading order, so
 * lineOrderAccuracy scores a layout the way the real dev split does. The
 * real column pages (eval/golden/ocr-he dev split `mixed`) stay the gate.
 */
import type { OcrWord } from "../../ai/ocrMixed";
import type { LayoutLine } from "../../ai/ocrLayout";

/** Mulberry32: a small seeded generator, so a page set is the same on every run. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LETTERS = "אבגדהוזחטיכלמנסעפצקרשת";
const EN = ["Zoom", "API", "Python", "GitHub", "Linux", "PDF"];

export interface BenchPage {
  id: string;
  lines: LayoutLine[];
  /** The page's text in reading order: one line per printed line. */
  reference: string;
  columns: number;
}

export interface BenchOptions {
  columns: 2 | 3;
  /** The gutter, in line heights. */
  gutter: number;
  /** Chance a printed row is joined across the gutter into one tesseract line. */
  merged: number;
  /** Chance a printed line is cut in two. */
  cut: number;
  heading: boolean;
  footer: boolean;
}

/** One synthetic page. Line height 30 px, page 1200 px wide; x grows to the right, Hebrew is set right to left. */
export function benchPage(seed: number, o: BenchOptions): BenchPage {
  const r = rng(seed);
  const H = 30;
  const W = 1200;
  const gutter = Math.round(o.gutter * H);
  const margin = 60;
  const colW = Math.floor((W - 2 * margin - (o.columns - 1) * gutter) / o.columns);
  // Random 2–6 letter Hebrew words: a vocabulary large enough that the metric matches each line to its own.
  const word = () => (r() < 0.06 ? EN[Math.floor(r() * EN.length)] : Array.from({ length: 2 + Math.floor(r() * 5) }, () => LETTERS[Math.floor(r() * LETTERS.length)]).join(""));
  const lines: LayoutLine[] = [];
  const ref: string[] = [];
  /** Words set right to left between x1 (right edge) and x0, as many as fit, ragged left edge. */
  const setLine = (x0: number, x1: number, y: number, fill: number): { words: OcrWord[]; text: string } => {
    const words: OcrWord[] = [];
    let x = x1;
    const minX = x1 - (x1 - x0) * fill;
    while (x > minX) {
      const t = word();
      const w = 14 * t.length + Math.floor(r() * 10);
      if (x - w < x0) break;
      const jy = Math.round((r() - 0.5) * 4);
      words.push({ text: t, bbox: { x0: x - w, y0: y + jy, x1: x, y1: y + H - 6 + jy }, confidence: 90, symbols: [] });
      x -= w + 10 + Math.floor(r() * 4);
    }
    return { words, text: words.map((w) => w.text).join(" ") };
  };
  const push = (ws: OcrWord[]) => {
    if (!ws.length) return;
    lines.push({ text: `${ws.map((w) => w.text).join(" ")}\n`, words: ws });
  };
  let y = 40;
  if (o.heading) {
    const h = setLine(margin + 200, W - margin, y, 0.9);
    push(h.words);
    ref.push(h.text);
    y += 2 * H;
  }
  const top = y;
  const rows = 14 + Math.floor(r() * 10);
  // Paragraph gaps at the same rows in every column, as typeset pages have them per column (each its own).
  const cols: Array<Array<{ words: OcrWord[]; text: string; row: number }>> = [];
  for (let c = 0; c < o.columns; c++) {
    const x1 = W - margin - c * (colW + gutter);
    const x0 = x1 - colW;
    const col: Array<{ words: OcrWord[]; text: string; row: number }> = [];
    let yy = top;
    for (let k = 0; k < rows; k++) {
      const last = r() < 0.15;
      const l = setLine(x0, x1, yy, last ? 0.3 + r() * 0.5 : 0.85 + r() * 0.15);
      col.push({ ...l, row: k });
      yy += H + 6 + (last ? H : 0);
    }
    cols.push(col);
  }
  // Reference: right column first (a Hebrew page), each top to bottom.
  for (const col of cols) for (const l of col) ref.push(l.text);
  // What tesseract gives: per column, per line; sometimes a row of two columns as one line, sometimes a line in two.
  const taken = new Set<string>();
  for (let c = 0; c < o.columns; c++) {
    for (const l of cols[c]) {
      const key = `${c}:${l.row}`;
      if (taken.has(key)) continue;
      const next = cols[c + 1]?.find((m) => Math.abs(m.words[0]?.bbox.y0 - l.words[0]?.bbox.y0) < 8);
      if (next && r() < o.merged) {
        taken.add(`${c + 1}:${next.row}`);
        push([...l.words, ...next.words]);
        continue;
      }
      if (l.words.length > 3 && r() < o.cut) {
        const at = 1 + Math.floor(r() * (l.words.length - 2));
        push(l.words.slice(0, at));
        push(l.words.slice(at));
        continue;
      }
      push(l.words);
    }
  }
  if (o.footer) {
    const yy = Math.max(...lines.map((l) => Math.max(...l.words.map((w) => w.bbox.y1)))) + 3 * H;
    const f = setLine(margin, W - margin, yy, 0.6);
    push(f.words);
    ref.push(f.text);
  }
  return { id: `synthetic-${o.columns}col-${seed}`, lines, reference: ref.join("\n"), columns: o.columns };
}

/** The bench: pages over a spread of gutters, columns and tesseract slips. */
export function benchPages(count = 60, seed = 1): BenchPage[] {
  const r = rng(seed);
  return Array.from({ length: count }, (_, i) =>
    benchPage(seed * 1000 + i, {
      columns: r() < 0.7 ? 2 : 3,
      gutter: 0.6 + r() * 1.4,
      merged: r() < 0.5 ? 0.08 : 0,
      cut: r() < 0.5 ? 0.06 : 0,
      heading: r() < 0.6,
      footer: r() < 0.3,
    }),
  );
}
