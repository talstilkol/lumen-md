/**
 * Scan a document into a note (plan W13.M4), like Apple Notes: the system
 * document camera finds the page edges, flattens and cleans each page, and
 * Lumen keeps the scan as a PDF in attachments/ and writes a note with its
 * text, read on this device by the app's own OCR (plan W1.18: Hebrew and
 * Latin, right-to-left order, mixed lines).
 *
 * Engines, in order:
 *   - iOS: VisionKit's VNDocumentCameraViewController — on the device;
 *   - Android: ML Kit's document scanner, run by Google Play services on
 *     the device; Play services may download the scanner module once, so it
 *     goes in the privacy ledger as a service and is not used under
 *     "local only";
 *   - otherwise (no Play services, local only, the web): pick or take photos
 *     the ordinary way; each page is still OCRed and kept.
 */
import type { OcrResult } from "../ai/ocr";

export interface ScannerPlugin {
  /** Base64 JPEG pages and, where the engine makes one, a PDF of them. */
  scanDocument(o: { maxPages?: number; allowService?: boolean }): Promise<{ status: "ok" | "cancelled" | "unavailable"; engine?: "visionkit" | "mlkit"; pages?: string[]; pdf?: string | null }>;
}

export interface ScanResult {
  engine: "visionkit" | "mlkit" | "photos";
  pages: Blob[];
  pdf: Uint8Array | null;
}

export const MAX_PAGES = 24;
/** Below this mean confidence a page's text is marked "check against the scan". */
export const LOW_CONFIDENCE = 60;

const fromB64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-11-17 1042": the stamp in the scan's file names. */
export function scanStamp(when: Date): string {
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}${pad(when.getMinutes())}`;
}

/** Where the note, the PDF and (without a PDF) the page images go. */
export function scanPaths(when: Date, pages: number, hasPdf: boolean): { note: string; pdf: string | null; images: string[] } {
  const s = scanStamp(when);
  const file = `scan-${s.replace(" ", "-")}`;
  return {
    note: `Scans/Scan ${s}.md`,
    pdf: hasPdf ? `attachments/${file}.pdf` : null,
    images: hasPdf ? [] : Array.from({ length: pages }, (_, i) => `attachments/${file}-p${i + 1}.jpg`),
  };
}

export interface ScanNoteText {
  title: string;
  page: (n: number) => string;
  uncertain: string;
  empty: string;
  source: string;
}

/** The note: title, the scan (PDF link or images), then each page's text under its own heading. */
export function scanNoteMarkdown(o: { when: Date; paths: ReturnType<typeof scanPaths>; ocr: Array<Pick<OcrResult, "text" | "confidence"> | null>; text: ScanNoteText; engine: ScanResult["engine"] }): string {
  const iso = o.when.toISOString();
  const lines = ["---", `created: ${iso}`, "tags: [scan]", `scanner: ${o.engine}`, "---", "", `# ${o.text.title}`, ""];
  if (o.paths.pdf) lines.push(`[${o.text.source}](<${o.paths.pdf}>)`, "");
  o.ocr.forEach((r, i) => {
    lines.push(`## ${o.text.page(i + 1)}`, "");
    if (o.paths.images[i]) lines.push(`![${o.text.page(i + 1)}](<${o.paths.images[i]}>)`, "");
    const body = r?.text.trim() ?? "";
    if (!body) lines.push(`_${o.text.empty}_`, "");
    else {
      if (r && r.confidence < LOW_CONFIDENCE) lines.push(`> ${o.text.uncertain}`, "");
      lines.push(body, "");
    }
  });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export interface ScanDeps {
  plugin: ScannerPlugin | null;
  /** The ordinary photo picker (camera or library), for no scanner at all. */
  pickPhotos: () => Promise<Blob[]>;
  /** May a service (Google Play services) run the scanner? False under "local only". */
  allowService: boolean;
  /** Ledger entries: an on-device engine, or a service. */
  ledger: { onDevice: (name: string) => void; service: (name: string, reason: string) => void };
}

/** Run the best scanner there is → the pages, or null when the person cancelled. */
export async function scanDocument(d: ScanDeps): Promise<ScanResult | null> {
  if (d.plugin) {
    let r: Awaited<ReturnType<ScannerPlugin["scanDocument"]>> | null = null;
    try {
      r = await d.plugin.scanDocument({ maxPages: MAX_PAGES, allowService: d.allowService });
    } catch {
      r = null; // why: an older app without the scanner: the photo picker below
    }
    if (r?.status === "cancelled") return null;
    if (r?.status === "ok" && r.pages?.length) {
      const engine = r.engine === "mlkit" ? "mlkit" : "visionkit";
      if (engine === "mlkit") d.ledger.service("Google Play services: ML Kit document scanner", "Scans on this device; Play services may download the scanner once");
      else d.ledger.onDevice("VisionKit document camera");
      return { engine, pages: r.pages.slice(0, MAX_PAGES).map((p) => new Blob([fromB64(p) as BlobPart], { type: "image/jpeg" })), pdf: r.pdf ? fromB64(r.pdf) : null };
    }
  }
  const photos = (await d.pickPhotos()).slice(0, MAX_PAGES);
  return photos.length ? { engine: "photos", pages: photos, pdf: null } : null;
}

export interface WriteDeps {
  ocr: (page: Blob) => Promise<Pick<OcrResult, "text" | "confidence"> | null>;
  writeBlob: (path: string, bytes: Uint8Array) => Promise<void>;
  writeNote: (path: string, text: string) => Promise<void>;
  text: ScanNoteText;
  now?: Date;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/** Keep the scan and write its note → the note's path. OCR runs page by page; a page that fails keeps its image. */
export async function scanToNote(scan: ScanResult, d: WriteDeps): Promise<string> {
  const when = d.now ?? new Date();
  const paths = scanPaths(when, scan.pages.length, !!scan.pdf);
  if (scan.pdf && paths.pdf) await d.writeBlob(paths.pdf, scan.pdf);
  for (const [i, p] of paths.images.entries()) await d.writeBlob(p, new Uint8Array(await scan.pages[i].arrayBuffer()));
  const ocr: Array<Pick<OcrResult, "text" | "confidence"> | null> = [];
  for (const [i, page] of scan.pages.entries()) {
    if (d.signal?.aborted) break;
    try {
      ocr.push(await d.ocr(page));
    } catch {
      ocr.push(null); // why: the page is kept as an image or in the PDF; its text can be read again later
    }
    d.onProgress?.(i + 1, scan.pages.length);
  }
  while (ocr.length < scan.pages.length) ocr.push(null);
  await d.writeNote(paths.note, scanNoteMarkdown({ when, paths, ocr, text: d.text, engine: scan.engine }));
  return paths.note;
}
