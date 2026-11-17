/**
 * Reading a screenshot's layout before OCR (plan W7.16, the on-device path).
 *
 * Tesseract alone read the 50 screenshot fixtures at CER 17.8% (Hebrew) and
 * 8.6% (English), and no table came out as a table: screenshots are 1× text
 * (13–17 px), code sits light on dark, and a ruled table is read as lines of
 * words. Three things fix most of that, all on pixels, here, without a model:
 *
 *   1. Scale: the image is turned grey and enlarged (×3 for an ordinary
 *      screenshot, ×2 for a large or Retina one, within a pixel budget), so
 *      letters reach the size Tesseract was trained on.
 *   2. Ruled tables: long horizontal and vertical rules that cross into a
 *      grid are a table; each cell is read on its own (one line) and the
 *      table is written as a GFM table, first row as the header, columns in
 *      reading order (right to left when the cells are Hebrew).
 *   3. Dark panels (code, terminals): a large dark rectangle is read inverted
 *      (dark text on light, as Tesseract expects) and written as a fenced
 *      code block, left to right.
 *
 * Everything else is read in horizontal bands between those regions, top to
 * bottom, so the note keeps the screen's order. Pure: pixels in, a plan of
 * regions out; `screenshotOcr` runs the plan with any recogniser (the app's
 * Tesseract worker, or the Tesseract CLI in the measuring harness — the same
 * code either way).
 */

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, 4 bytes a pixel (ImageData's layout). */
  data: Uint8ClampedArray | Uint8Array;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Most pixels a prepared image may have (a 1600×1000 screenshot at ×3 is 14.4 M). */
export const MAX_OCR_PIXELS = 16_000_000;

/** How much to enlarge a screenshot before OCR: ×3 for ordinary ones, ×2 for wide (Retina) ones, never past the budget. */
export function ocrScale(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 1;
  const want = width <= 1600 ? 3 : width <= 2600 ? 2 : 1;
  const fit = Math.floor(Math.sqrt(MAX_OCR_PIXELS / (width * height)));
  return Math.max(1, Math.min(want, fit));
}

const lum = (d: Pixels["data"], i: number) => (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;

/** Luminance 0–255, one byte a pixel. */
export function grey(px: Pixels): Uint8Array {
  const out = new Uint8Array(px.width * px.height);
  for (let p = 0, i = 0; p < out.length; p++, i += 4) out[p] = px.data[i + 3] < 128 ? 255 : Math.round(lum(px.data, i));
  return out;
}

/** A grey image enlarged by `factor` (bilinear), as RGBA; `invert` for light-on-dark text. */
export function scaleGrey(g: Uint8Array, width: number, height: number, factor: number, box: Box = { x0: 0, y0: 0, x1: width, y1: height }, invert = false): Pixels {
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  const W = Math.max(1, Math.round(bw * factor));
  const H = Math.max(1, Math.round(bh * factor));
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(bh - 1, Math.max(0, (y + 0.5) / factor - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(bh - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < W; x++) {
      const sx = Math.min(bw - 1, Math.max(0, (x + 0.5) / factor - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(bw - 1, x0 + 1);
      const fx = sx - x0;
      const at = (xx: number, yy: number) => g[(box.y0 + yy) * width + box.x0 + xx];
      let v = (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
      if (invert) v = 255 - v;
      const o = (y * W + x) * 4;
      out[o] = out[o + 1] = out[o + 2] = v;
      out[o + 3] = 255;
    }
  }
  return { width: W, height: H, data: out };
}

/* ─── Finding ruled tables ─────────────────────────────────────────── */

/** A rule pixel: darker than paper and a header's tint, lighter than nothing in particular (borders are often grey). */
const RULE = 228;

interface HLine {
  y0: number;
  y1: number;
  x0: number;
  x1: number;
}

/** Rows that hold one long run of rule pixels: horizontal rules (a thick one is one rule). */
function horizontalRules(g: Uint8Array, w: number, h: number, minLen: number): HLine[] {
  const rows: Array<{ y: number; x0: number; x1: number }> = [];
  for (let y = 0; y < h; y++) {
    let best = { len: 0, x0: 0 };
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const on = x < w && g[y * w + x] < RULE;
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        if (x - start > best.len) best = { len: x - start, x0: start };
        start = -1;
      }
    }
    if (best.len >= minLen) rows.push({ y, x0: best.x0, x1: best.x0 + best.len });
  }
  const lines: HLine[] = [];
  for (const r of rows) {
    const last = lines[lines.length - 1];
    if (last && r.y === last.y1 && Math.abs(r.x0 - last.x0) <= 3 && Math.abs(r.x1 - last.x1) <= 3) last.y1 = r.y + 1;
    else lines.push({ y0: r.y, y1: r.y + 1, x0: r.x0, x1: r.x1 });
  }
  // A rule is thin; a filled bar (a button, a header band) is not.
  return lines.filter((l) => l.y1 - l.y0 <= 4);
}

/** Columns inside `box` dark from top to bottom: vertical rules (adjacent ones merged), as x positions. */
function verticalRules(g: Uint8Array, w: number, box: Box): number[] {
  const xs: number[] = [];
  const need = (box.y1 - box.y0) * 0.92;
  for (let x = box.x0; x < box.x1; x++) {
    let n = 0;
    for (let y = box.y0; y < box.y1; y++) if (g[y * w + x] < RULE) n++;
    if (n >= need) xs.push(x);
  }
  const merged: number[] = [];
  let run: number[] = [];
  for (const x of xs) {
    if (run.length && x - run[run.length - 1] > 1) {
      merged.push(Math.round((run[0] + run[run.length - 1]) / 2));
      run = [];
    }
    run.push(x);
  }
  if (run.length) merged.push(Math.round((run[0] + run[run.length - 1]) / 2));
  return merged;
}

export interface TableGrid {
  box: Box;
  /** The y of each horizontal rule, top to bottom. */
  rows: number[];
  /** The x of each vertical rule, left to right. */
  cols: number[];
}

/** Ruled tables: at least two rows and two columns of cells, bounded by rules on every side. */
export function findTables(g: Uint8Array, w: number, h: number): TableGrid[] {
  const minLen = Math.max(60, Math.round(w * 0.12));
  const rules = horizontalRules(g, w, h, minLen);
  const tables: TableGrid[] = [];
  let group: HLine[] = [];
  const flush = () => {
    if (group.length >= 3) {
      const box = { x0: Math.min(...group.map((l) => l.x0)), y0: group[0].y0, x1: Math.max(...group.map((l) => l.x1)), y1: group[group.length - 1].y1 };
      const cols = verticalRules(g, w, box);
      // The outer rules are the table's edges; a grid needs one inside too.
      if (cols.length >= 3 && cols[0] - box.x0 <= 3 && box.x1 - 1 - cols[cols.length - 1] <= 3) {
        tables.push({ box, rows: group.map((l) => Math.round((l.y0 + l.y1 - 1) / 2)), cols });
      }
    }
    group = [];
  };
  for (const l of rules) {
    const last = group[group.length - 1];
    // The same table: rules of the same extent, no more than a few text lines apart.
    if (last && Math.abs(l.x0 - last.x0) <= 4 && Math.abs(l.x1 - last.x1) <= 4 && l.y0 - last.y1 < 120) group.push(l);
    else {
      flush();
      group.push(l);
    }
  }
  flush();
  return tables;
}

/** The cells of a grid, row by row, left to right, each inset from its rules. */
export function cellBoxes(t: TableGrid, inset = 3): Box[][] {
  const out: Box[][] = [];
  for (let r = 0; r + 1 < t.rows.length; r++) {
    const row: Box[] = [];
    for (let c = 0; c + 1 < t.cols.length; c++) row.push({ x0: t.cols[c] + inset, y0: t.rows[r] + inset, x1: t.cols[c + 1] - inset + 1, y1: t.rows[r + 1] - inset + 1 });
    out.push(row);
  }
  return out;
}

/* ─── Finding dark panels (code, terminals) ────────────────────────── */

/** Large rectangles whose pixels are mostly dark: code blocks and terminals, read inverted. */
export function findDarkPanels(g: Uint8Array, w: number, h: number): Box[] {
  const dark = (v: number) => v < 70;
  const minW = Math.max(80, Math.round(w * 0.25));
  const rowRun = (y: number) => {
    let best = { len: 0, x0: 0 };
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const on = x < w && dark(g[y * w + x]);
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        if (x - start > best.len) best = { len: x - start, x0: start };
        start = -1;
      }
    }
    return best;
  };
  // A panel starts at a row with a long dark run (its background); a row below still belongs to it
  // while dark pixels fill a good part of the panel's span (text inside breaks the run, not the panel).
  const panels: Box[] = [];
  let cur: Box | null = null;
  for (let y = 0; y < h; y++) {
    const r = rowRun(y);
    let inside = false;
    if (cur) {
      let n = 0;
      for (let x = cur.x0; x < cur.x1; x++) if (dark(g[y * w + x])) n++;
      // Light text covers well under 70% of a row even in dense code; the panel's background shows through the rest.
      inside = n >= (cur.x1 - cur.x0) * 0.3;
    }
    if (inside) cur!.y1 = y + 1;
    else {
      if (cur && cur.y1 - cur.y0 >= 24) panels.push(cur);
      cur = r.len >= minW ? { x0: r.x0, y0: y, x1: r.x0 + r.len, y1: y + 1 } : null;
    }
  }
  if (cur && cur.y1 - cur.y0 >= 24) panels.push(cur);
  return panels;
}

/** Most of the page is dark: a dark-theme window (its text is light). */
export function isDarkPage(g: Uint8Array): boolean {
  let n = 0;
  for (let i = 0; i < g.length; i++) if (g[i] < 100) n++;
  return n >= g.length * 0.6;
}

/* ─── The plan and running it ──────────────────────────────────────── */

export type Region = { kind: "text"; box: Box } | { kind: "table"; grid: TableGrid } | { kind: "code"; box: Box };

/** The page as regions, top to bottom: tables, dark panels, and the bands of text between them. */
export function planRegions(g: Uint8Array, w: number, h: number): Region[] {
  const special: Region[] = [...findTables(g, w, h).map((grid) => ({ kind: "table" as const, grid })), ...findDarkPanels(g, w, h).map((box) => ({ kind: "code" as const, box }))];
  const top = (r: Region) => (r.kind === "table" ? r.grid.box.y0 : r.box.y0);
  const bottom = (r: Region) => (r.kind === "table" ? r.grid.box.y1 : r.box.y1);
  special.sort((a, b) => top(a) - top(b));
  // A table inside a panel (or the other way round) is not two things: keep the first.
  const kept: Region[] = [];
  for (const r of special) if (!kept.some((k) => top(r) < bottom(k) && bottom(r) > top(k))) kept.push(r);
  const out: Region[] = [];
  let y = 0;
  for (const r of kept) {
    if (top(r) - y >= 8) out.push({ kind: "text", box: { x0: 0, y0: y, x1: w, y1: top(r) } });
    out.push(r);
    y = bottom(r);
  }
  if (h - y >= 8) out.push({ kind: "text", box: { x0: 0, y0: y, x1: w, y1: h } });
  return out;
}

/** Ink: pixels dark enough to be text (window shadows, rounded corners and tints are lighter). */
const INK = 150;

/**
 * The part of `box` that holds ink, padded; null when there is (almost) none.
 * An empty band sent to OCR comes back as invented letters, so it is not sent.
 */
export function inkBox(g: Uint8Array, w: number, box: Box, pad = 6): Box | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  let n = 0;
  for (let y = box.y0; y < box.y1; y++)
    for (let x = box.x0; x < box.x1; x++)
      if (g[y * w + x] < INK) {
        n++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (n < 20 || y1 - y0 < 5) return null;
  return { x0: Math.max(box.x0, x0 - pad), y0: Math.max(box.y0, y0 - pad), x1: Math.min(box.x1, x1 + 1 + pad), y1: Math.min(box.y1, y1 + 1 + pad) };
}

/**
 * A recogniser: the text of an image (already enlarged and grey). `line` asks
 * for one line (a table cell) with Hebrew and English; `line-latin` for one
 * line with the English model alone.
 */
export type Recognise = (image: Pixels, mode: "block" | "line" | "line-latin") => Promise<string>;

const HEBREW = /[֐-׿]/g;
const LATIN = /[A-Za-z]/g;
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

/** A GFM table from rows of cell texts; `|` escaped, line breaks in a cell joined. */
export function tableMarkdown(rows: string[][]): string {
  const cell = (s: string) => s.replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => cell(r[i] ?? "")).join(" | ")} |`;
  return [line(rows[0]), `|${" --- |".repeat(width)}`, ...rows.slice(1).map(line)].join("\n");
}

const one = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * A cell: read with Hebrew and English; a reading with no Hebrew letter is
 * read again with the English model alone, which reads codes and names
 * ("LUM-101") that the two models together turn into marks ("| 1").
 */
async function readCell(img: Pixels, recognise: Recognise): Promise<string> {
  const both = one(await recognise(img, "line"));
  if (count(both, HEBREW) > 0) return both;
  const latin = one(await recognise(img, "line-latin"));
  return latin || both;
}

/**
 * Read a screenshot: plan its regions, enlarge each, recognise it, and put the
 * note together in the screen's order. Text bands are cleaned of OCR noise by
 * the caller's usual clean-up; cells and code are kept as read.
 */
export async function screenshotOcr(px: Pixels, recognise: Recognise): Promise<string> {
  const { width: w, height: h } = px;
  let g = grey(px);
  // A dark-theme screenshot is a dark page, not one big code block: read the whole page inverted.
  if (isDarkPage(g)) g = g.map((v) => 255 - v);
  const f = ocrScale(w, h);
  const parts: string[] = [];
  for (const r of planRegions(g, w, h)) {
    if (r.kind === "text") {
      const ink = inkBox(g, w, r.box);
      if (!ink) continue;
      const text = (await recognise(scaleGrey(g, w, h, f, ink), "block")).trim();
      if (text) parts.push(text);
    } else if (r.kind === "code") {
      const text = (await recognise(scaleGrey(g, w, h, f, r.box, true), "block")).replace(/\s+$/g, "");
      if (text.trim()) parts.push(["```", ...text.split("\n").filter((l, i, a) => l.trim() || (i > 0 && i < a.length - 1)), "```"].join("\n"));
    } else {
      const cells = cellBoxes(r.grid);
      const rows: string[][] = [];
      for (const row of cells) {
        const texts: string[] = [];
        for (const b of row) texts.push(b.x1 - b.x0 > 2 && b.y1 - b.y0 > 2 && inkBox(g, w, b, 0) ? await readCell(scaleGrey(g, w, h, f, b), recognise) : "");
        rows.push(texts);
      }
      // Columns in reading order: a Hebrew table starts at the right.
      const all = rows.flat().join(" ");
      const rtl = count(all, HEBREW) > count(all, LATIN);
      parts.push(tableMarkdown(rtl ? rows.map((r) => [...r].reverse()) : rows));
    }
  }
  return parts.join("\n\n");
}
