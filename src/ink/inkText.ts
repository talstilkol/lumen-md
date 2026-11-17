/**
 * W12.R4 — handwritten text in search, behind a measured gate.
 *
 * When the ink recogniser (W7.11) reads an ink block, the text goes into
 * the block's hidden `data-ink-text` attribute. The block is part of the
 * note's Markdown, which the vault index already tokenises, so search finds
 * a handwritten word with no other change. Nothing is shown: the attribute
 * is not rendered, and the UI offers no recognition.
 *
 * The gate: this happens only while ./inkRecognitionGate.json says W11.H14
 * passed — an eval card is linked and its character error rate on the
 * ivrit.ai handwriting benchmark is at or under `maxCer`. Until then
 * `inkTextEnabled()` is false, `applyInkText` changes nothing and returns
 * why, and no capability that was not measured is offered. (MyScript is
 * not an option: its recognition runs only on its cloud or server, under a
 * commercial licence.)
 */
import gateFile from "./inkRecognitionGate.json";
import { findInkBlocks, parseInk, type Ink } from "./inkModel";

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface InkRecognitionGate {
  plan: string;
  status: "not-measured" | "failed" | "passed";
  /** The eval card of the measurement (a path or URL); null until one exists. */
  evalCard: string | null;
  /** Character error rate measured on the benchmark (0..1). */
  cer: number | null;
  /** The highest CER that passes. */
  maxCer: number;
}

export const INK_GATE: InkRecognitionGate = gateFile as InkRecognitionGate;

/** Why the gate is shut, or null when it is open. */
export function gateClosedReason(g: InkRecognitionGate = INK_GATE): string | null {
  if (g.status !== "passed") return `${g.plan} has not passed (status: ${g.status})`;
  if (!g.evalCard) return `${g.plan} passed without an eval card`;
  if (g.cer === null || !Number.isFinite(g.cer)) return `${g.plan} has no measured CER`;
  if (g.cer > g.maxCer) return `CER ${g.cer} is above the gate (${g.maxCer})`;
  return null;
}

/** True only when the recogniser passed its measured gate. */
export const inkTextEnabled = (g: InkRecognitionGate = INK_GATE): boolean => gateClosedReason(g) === null;

/**
 * Put recognised `texts` (ink id → text) into the note's ink blocks. With
 * the gate shut, the note is returned unchanged with the reason. Empty
 * text removes a block's hidden text.
 */
export function applyInkText(markdown: string, texts: ReadonlyMap<string, string>, g: InkRecognitionGate = INK_GATE): { markdown: string; changed: number; blocked: string | null } {
  const blocked = gateClosedReason(g);
  if (blocked) return { markdown, changed: 0, blocked };
  let out = markdown;
  let changed = 0;
  // From the end, so earlier offsets stay valid. Only the opening <svg> tag
  // changes: the strokes stay byte for byte as they were.
  for (const range of findInkBlocks(markdown).reverse()) {
    const text = texts.get(range.id);
    if (text === undefined) continue;
    const block = markdown.slice(range.start, range.end);
    const ink = parseInk(block);
    if (!ink) continue;
    const clean = text.replace(/\s+/g, " ").trim();
    if ((ink.text ?? "") === clean) continue;
    const head = /^<svg\b[^>]*>/i.exec(block)![0];
    const bare = head.replace(/\sdata-ink-text="[^"]*"/, "");
    const next = clean ? bare.replace(/>$/, ` data-ink-text="${escapeAttr(clean)}">`) : bare;
    out = out.slice(0, range.start) + next + block.slice(head.length) + out.slice(range.end);
    changed++;
  }
  return { markdown: out, changed, blocked: null };
}

/** The hidden text of every ink block in a note, by ink id. */
export function inkTexts(markdown: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const range of findInkBlocks(markdown)) {
    const ink = parseInk(markdown.slice(range.start, range.end));
    if (ink?.text) out.set(ink.id, ink.text);
  }
  return out;
}

/* ─── The recogniser (W11.H14): a classic path and a local-model seam ─────
 *
 * Two recognisers of a block's ink, both on this device:
 *  - classic: the strokes drawn black on white at a fixed x-height, cleaned
 *    (grey → Otsu threshold → ink only, padded), then Tesseract's Hebrew +
 *    English (src/ai/ocr.ts, the app's own OCR). Measurable today;
 *  - model: any image-to-text model run locally (a TrOCR-style checkpoint
 *    through transformers.js, say) behind `modelRecognizer(run)`. None is
 *    pinned yet.
 * Either is measured on the ivrit.ai benchmark by the eval engine
 * scripts/eval-public/engines/handwriting-tesseract.mjs (the same cleaning),
 * and `recognizeNote` runs one only while the gate above is open: until the
 * eval card passes, nothing is recognised and nothing is offered.
 */

/** Otsu's threshold of an 8-bit histogram source (0..255). */
export function otsuThreshold(gray: ArrayLike<number>): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]!]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t]!;
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let at = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) (best = between), (at = t);
  }
  return at;
}

/** RGBA pixels → black ink on white (0 or 255 per pixel), by Otsu's threshold of their luminance. */
export function binarize(rgba: ArrayLike<number>, width: number, height: number): { gray: Uint8Array; threshold: number; inkPixels: number } {
  const n = width * height;
  const gray = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3]! / 255;
    // Transparent counts as paper: the pen draws on nothing.
    gray[i] = Math.round(255 - a * (255 - (0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!)));
  }
  const threshold = otsuThreshold(gray);
  let inkPixels = 0;
  for (let i = 0; i < n; i++) {
    gray[i] = gray[i]! <= threshold ? 0 : 255;
    if (!gray[i]) inkPixels++;
  }
  return { gray, threshold, inkPixels };
}

/** The x-height the strokes are scaled to before OCR (Tesseract reads best at ~30-40 px). */
export const OCR_LINE_PX = 64;
export const OCR_PAD_PX = 16;

/** Scale and offset that fit the ink's strokes into a line OCR_LINE_PX high, padded. */
export function rasterLayout(ink: Ink): { scale: number; dx: number; dy: number; width: number; height: number } | null {
  const pts = ink.strokes.flatMap((s) => s.points);
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = OCR_LINE_PX / Math.max(1, y1 - y0);
  return { scale, dx: OCR_PAD_PX - x0 * scale, dy: OCR_PAD_PX - y0 * scale, width: Math.ceil((x1 - x0) * scale + 2 * OCR_PAD_PX), height: Math.ceil((y1 - y0) * scale + 2 * OCR_PAD_PX) };
}

export interface HandwritingRecognizer {
  id: string;
  recognize(ink: Ink, signal?: AbortSignal): Promise<string>;
}

type Canvas2D = { fillStyle: string; fillRect(x: number, y: number, w: number, h: number): void; setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void; fill(p: unknown): void; getImageData(x: number, y: number, w: number, h: number): { data: ArrayLike<number> }; putImageData(d: unknown, x: number, y: number): void; createImageData(w: number, h: number): { data: Uint8ClampedArray } };

/** The ink as a cleaned black-on-white canvas (browser: OffscreenCanvas + Path2D, the pen's own outlines). */
export async function inkToCanvas(ink: Ink): Promise<OffscreenCanvas | null> {
  const box = rasterLayout(ink);
  if (!box || typeof OffscreenCanvas === "undefined" || typeof Path2D === "undefined") return null;
  const { strokeOutline } = await import("./inkPath");
  const canvas = new OffscreenCanvas(box.width, box.height);
  const g = canvas.getContext("2d") as unknown as Canvas2D;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, box.width, box.height);
  g.fillStyle = "#000";
  g.setTransform(box.scale, 0, 0, box.scale, box.dx, box.dy);
  for (const s of ink.strokes) g.fill(new Path2D(s.d ?? strokeOutline(s)));
  g.setTransform(1, 0, 0, 1, 0, 0);
  const img = g.getImageData(0, 0, box.width, box.height);
  const { gray } = binarize(img.data, box.width, box.height);
  const out = g.createImageData(box.width, box.height);
  for (let i = 0; i < gray.length; i++) out.data.set([gray[i]!, gray[i]!, gray[i]!, 255], i * 4);
  g.putImageData(out, 0, 0);
  return canvas;
}

/** The classic path: the cleaned raster through the app's Tesseract (Hebrew + English). */
export function tesseractRecognizer(ocr?: (c: OffscreenCanvas) => Promise<{ text: string }>, raster: (ink: Ink) => Promise<OffscreenCanvas | null> = inkToCanvas): HandwritingRecognizer {
  return {
    id: "tesseract-heb+eng:clean-v1",
    async recognize(ink, signal) {
      const canvas = await raster(ink);
      if (!canvas || signal?.aborted) return "";
      const run = ocr ?? ((c: OffscreenCanvas) => import("../ai/ocr").then((m) => m.ocrImage(c)));
      return (await run(canvas)).text.replace(/\s+/g, " ").trim();
    },
  };
}

/** The local-model seam: `run(image)` is an image-to-text model on this device. */
export function modelRecognizer(id: string, run: (image: OffscreenCanvas, signal?: AbortSignal) => Promise<string>, raster: (ink: Ink) => Promise<OffscreenCanvas | null> = inkToCanvas): HandwritingRecognizer {
  return {
    id,
    async recognize(ink, signal) {
      const canvas = await raster(ink);
      return canvas ? (await run(canvas, signal)).replace(/\s+/g, " ").trim() : "";
    },
  };
}

/**
 * Recognise every ink block of a note and put the text in (applyInkText).
 * With the gate shut the recogniser is never called: the note comes back
 * unchanged with the reason.
 */
export async function recognizeNote(markdown: string, r: HandwritingRecognizer, opts: { gate?: InkRecognitionGate; signal?: AbortSignal } = {}): Promise<{ markdown: string; changed: number; blocked: string | null }> {
  const g = opts.gate ?? INK_GATE;
  const blocked = gateClosedReason(g);
  if (blocked) return { markdown, changed: 0, blocked };
  const texts = new Map<string, string>();
  for (const range of findInkBlocks(markdown)) {
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const ink = parseInk(markdown.slice(range.start, range.end));
    if (ink) texts.set(range.id, await r.recognize(ink, opts.signal));
  }
  return applyInkText(markdown, texts, g);
}
