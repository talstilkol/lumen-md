/**
 * On-device OCR (T31): Hebrew + English text from images and scanned PDF
 * pages, with tesseract.js (LSTM engine, tessdata_fast models).
 *
 * Everything runs in a Web Worker on this machine. The worker and its
 * WebAssembly cores are served from this origin (public/tesseract/, see
 * scripts/copy-tesseract.mjs); the language models (heb ≈ 1 MB, eng ≈ 4 MB)
 * are downloaded once from the tesseract-ocr project on GitHub and cached by
 * the browser. No image ever leaves the device.
 */

export interface OcrResult {
  text: string;
  /** Mean word confidence, 0–100. */
  confidence: number;
}

const LANG_PATH = "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main";
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

async function getWorker(): Promise<TesseractWorker> {
  return (workerPromise ??= (async () => {
    const T = await import("tesseract.js");
    await noteModelDownloads();
    // workerBlobURL: false — a same-origin worker URL, so the worker gets its
    // own CSP (public/_headers /tesseract/*) instead of a blob: that inherits
    // the app's Trusted Types requirement.
    const w = await T.createWorker([...LANGS], T.OEM.LSTM_ONLY, {
      workerPath: `${base()}worker.min.js`,
      corePath: base(),
      langPath: LANG_PATH,
      gzip: false,
      workerBlobURL: false,
    });
    return w as unknown as TesseractWorker;
  })().catch((e) => {
    workerPromise = null;
    throw e;
  }));
}

/**
 * The worker downloads the language models itself, out of sight of the
 * privacy ledger's fetch wrapper: record each one it will fetch — the ones
 * not yet in tesseract's IndexedDB cache (idb-keyval's default store,
 * key `./<lang>.traineddata`, shared with the same-origin worker).
 * @internal exported for tests.
 */
export async function noteModelDownloads(): Promise<void> {
  try {
    const [{ get }, { recordWorkerRequest }] = await Promise.all([import("idb-keyval"), import("./privacyLedger")]);
    for (const lang of LANGS) {
      const cached = await get(`./${lang}.traineddata`).catch(() => undefined);
      if (cached === undefined) recordWorkerRequest(`${LANG_PATH}/${lang}.traineddata`);
    }
  } catch {
    /* no IndexedDB: the ledger stays as it was */
  }
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
