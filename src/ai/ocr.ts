/**
 * On-device OCR (T31): Hebrew + English text from images and scanned PDF
 * pages, with tesseract.js (LSTM engine, tessdata_fast models).
 *
 * Everything runs in a Web Worker on this machine, and everything it loads
 * comes from this origin: the worker and its WebAssembly cores
 * (public/tesseract/, staged by scripts/copy-tesseract.mjs) and the
 * language models (public/tesseract/lang/<lang>.traineddata.gz, committed:
 * tesseract-ocr/tessdata_fast, Apache-2.0, heb ≈ 0.5 MB and eng ≈ 2 MB
 * gzipped; plan 7.5). tesseract.js keeps them in IndexedDB after the first
 * use. No image ever leaves the device, and OCR makes no outside request.
 */

import type { Box, OcrLine } from "./ocrMixed";

export interface OcrResult {
  text: string;
  /** Mean word confidence, 0–100. */
  confidence: number;
}

const LANGS = ["heb", "eng"] as const;
const IDLE_MS = 60_000;

type Image = Blob | HTMLCanvasElement | OffscreenCanvas | ImageData | Uint8Array;
type TesseractWorker = {
  recognize(
    image: Image,
    options?: { rectangle?: { left: number; top: number; width: number; height: number } },
    output?: { text?: boolean; blocks?: boolean },
  ): Promise<{ data: { text: string; confidence: number; blocks?: Array<{ paragraphs: Array<{ lines: OcrLine[] }> }> | null } }>;
  setParameters?(p: Record<string, unknown>): Promise<unknown>;
  terminate(): Promise<unknown>;
};

let workerPromise: Promise<TesseractWorker> | null = null;
/** Hebrew only, one word at a time: re-reads the Hebrew bits of mixed lines (./ocrMixed). Started only when a line needs it. */
let hebPromise: Promise<TesseractWorker> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function base(): string {
  const b = (import.meta.env?.BASE_URL as string | undefined) ?? "/";
  return new URL(`${b.replace(/\/?$/, "/")}tesseract/`, location.href).href;
}

/**
 * Where the worker fetches `<lang>.traineddata.gz`: same origin, so the
 * worker's CSP (public/_headers /tesseract/*) needs no outside host.
 * @internal exported for tests.
 */
export function langPath(): string {
  return `${base()}lang`;
}

async function getWorker(): Promise<TesseractWorker> {
  return (workerPromise ??= (async () => {
    const T = await import("tesseract.js");
    // workerBlobURL: false — a same-origin worker URL, so the worker gets its
    // own CSP (public/_headers /tesseract/*) instead of a blob: that inherits
    // the app's Trusted Types requirement.
    const w = await T.createWorker([...LANGS], T.OEM.LSTM_ONLY, {
      workerPath: `${base()}worker.min.js`,
      corePath: base(),
      langPath: langPath(),
      gzip: true,
      workerBlobURL: false,
    });
    return w as unknown as TesseractWorker;
  })().catch((e) => {
    workerPromise = null;
    throw e;
  }));
}

function getHebWorker(): Promise<TesseractWorker> {
  return (hebPromise ??= (async () => {
    const T = await import("tesseract.js");
    const w = (await T.createWorker(["heb"], T.OEM.LSTM_ONLY, {
      workerPath: `${base()}worker.min.js`,
      corePath: base(),
      langPath: langPath(),
      gzip: true,
      workerBlobURL: false,
    })) as unknown as TesseractWorker;
    await w.setParameters?.({ tessedit_pageseg_mode: T.PSM.SINGLE_WORD });
    return w;
  })().catch((e) => {
    hebPromise = null;
    throw e;
  }));
}

function scheduleIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    for (const p of [workerPromise, hebPromise]) void p?.then((w) => w.terminate()).catch(() => undefined);
    workerPromise = null;
    hebPromise = null;
  }, IDLE_MS);
}

const rect = (b: Box) => ({ left: b.x0, top: b.y0, width: Math.max(1, b.x1 - b.x0), height: Math.max(1, b.y1 - b.y0) });

/**
 * Recognise, then fix the lines that mix Latin into Hebrew (./ocrMixed):
 * the Hebrew-only worker is asked only for those. `heb` may be a getter so
 * that it starts only when a line needs it. Exported for the node CER
 * harness (scripts/ocr/cer-node.mjs), which runs the same path.
 */
export async function recognizeWithMixedFix(
  main: TesseractWorker,
  heb: TesseractWorker | (() => Promise<TesseractWorker>) | null,
  image: Image,
): Promise<OcrResult> {
  const { data } = await main.recognize(image, {}, { text: true, blocks: true });
  const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
  const mixed = lines.some((l) => /[A-Za-z]/.test(l.text) && /[\u05D0-\u05EA]/.test(l.text));
  if (!mixed || !heb) return { text: data.text, confidence: data.confidence };
  const { fixMixedText } = await import("./ocrMixed");
  const getHeb = typeof heb === "function" ? heb : async () => heb;
  const text = await fixMixedText(lines, async (box) => {
    const r = await (await getHeb()).recognize(image, { rectangle: rect(box) });
    return { text: r.data.text, confidence: r.data.confidence };
  });
  return { text, confidence: data.confidence };
}

/** Recognise text. Jobs run one at a time; the worker shuts down when idle. */
export function ocrImage(image: Blob | HTMLCanvasElement | OffscreenCanvas): Promise<OcrResult> {
  const job = queue.then(async () => {
    const w = await getWorker();
    try {
      const r = await recognizeWithMixedFix(w, getHebWorker, image as Blob);
      return { text: cleanOcrText(r.text), confidence: r.confidence };
    } finally {
      scheduleIdle();
    }
  });
  queue = job.catch(() => undefined);
  return job;
}

/** Collapse OCR noise: trailing spaces, runs of blank lines, lone symbols. */
export function cleanOcrText(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l && /[\p{L}\p{N}]{2,}/u.test(l))
    .join("\n")
    .trim();
}

/** Is this enough real text to call the image "an image with text"? */
export function meaningfulText(r: OcrResult): boolean {
  const letters = (r.text.match(/[\p{L}\p{N}]/gu) ?? []).length;
  return letters >= 12 && r.confidence >= 55;
}
