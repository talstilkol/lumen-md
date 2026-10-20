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

export interface OcrResult {
  text: string;
  /** Mean word confidence, 0–100. */
  confidence: number;
}

const LANGS = ["heb", "eng"] as const;
const IDLE_MS = 60_000;

type TesseractWorker = {
  recognize(image: Blob | HTMLCanvasElement | OffscreenCanvas | ImageData): Promise<{ data: { text: string; confidence: number } }>;
  terminate(): Promise<unknown>;
};

let workerPromise: Promise<TesseractWorker> | null = null;
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

function scheduleIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const p = workerPromise;
    workerPromise = null;
    void p?.then((w) => w.terminate()).catch(() => undefined);
  }, IDLE_MS);
}

/** Recognise text. Jobs run one at a time; the worker shuts down when idle. */
export function ocrImage(image: Blob | HTMLCanvasElement | OffscreenCanvas): Promise<OcrResult> {
  const job = queue.then(async () => {
    const w = await getWorker();
    try {
      const { data } = await w.recognize(image as Blob);
      return { text: cleanOcrText(data.text), confidence: data.confidence };
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
