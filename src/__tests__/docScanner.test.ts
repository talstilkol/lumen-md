/**
 * W13.M4: scan a document into a note. The best scanner there is (VisionKit,
 * ML Kit when a service is allowed, else the photo picker); the PDF kept in
 * attachments/; each page's text, read on this device, under its heading —
 * and the pipeline adds no error of its own to the OCR text (CER 0 against
 * what the OCR returned, Hebrew and mixed lines included).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOW_CONFIDENCE, MAX_PAGES, scanDocument, scanNoteMarkdown, scanPaths, scanToNote, type ScanDeps, type ScannerPlugin } from "../mobile/docScanner";
import { measureItem } from "../ai/ocrCer";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const b64 = (s: string) => Buffer.from(s).toString("base64");
const WHEN = new Date(2026, 10, 17, 10, 42);
const TEXT = { title: "Scan", page: (n: number) => `Page ${n}`, uncertain: "check it", empty: "no text", source: "The scan (PDF)" };

function deps(plugin: ScannerPlugin | null, over: Partial<ScanDeps> = {}) {
  const ledger: string[] = [];
  let picked = 0;
  const d: ScanDeps = {
    plugin,
    pickPhotos: async () => (picked++, [new Blob(["p1"], { type: "image/jpeg" })]),
    allowService: true,
    ledger: { onDevice: (n) => void ledger.push(`device:${n}`), service: (n) => void ledger.push(`service:${n}`) },
    ...over,
  };
  return { d, ledger, picked: () => picked };
}

describe("choosing the scanner", () => {
  it("VisionKit pages and its PDF, recorded as on-device", async () => {
    let asked: unknown = null;
    const plugin: ScannerPlugin = { scanDocument: async (o) => ((asked = o), { status: "ok", engine: "visionkit", pages: [b64("a"), b64("b")], pdf: b64("%PDF") }) };
    const { d, ledger, picked } = deps(plugin);
    const r = await scanDocument(d);
    expect(r?.engine).toBe("visionkit");
    expect(r?.pages).toHaveLength(2);
    expect(new TextDecoder().decode(r!.pdf!)).toBe("%PDF");
    expect(asked).toEqual({ maxPages: MAX_PAGES, allowService: true });
    expect(ledger).toEqual(["device:VisionKit document camera"]);
    expect(picked()).toBe(0);
  });

  it("ML Kit is a service in the ledger, and under local only the app does not even ask for it", async () => {
    const plugin: ScannerPlugin = { scanDocument: async (o) => (o.allowService ? { status: "ok", engine: "mlkit", pages: [b64("a")], pdf: null } : { status: "unavailable" }) };
    const on = deps(plugin);
    expect((await scanDocument(on.d))?.engine).toBe("mlkit");
    expect(on.ledger[0]).toMatch(/^service:Google Play services/);
    const off = deps(plugin, { allowService: false });
    expect((await scanDocument(off.d))?.engine).toBe("photos");
    expect(off.ledger).toEqual([]);
  });

  it("no scanner (no Play services, the web, an older app) → the photo picker; cancel → nothing", async () => {
    expect((await scanDocument(deps({ scanDocument: async () => ({ status: "unavailable" }) }).d))?.engine).toBe("photos");
    expect((await scanDocument(deps({ scanDocument: () => Promise.reject(new Error("not implemented")) }).d))?.engine).toBe("photos");
    expect((await scanDocument(deps(null).d))?.engine).toBe("photos");
    const c = deps({ scanDocument: async () => ({ status: "cancelled" }) });
    expect(await scanDocument(c.d)).toBeNull();
    expect(c.picked()).toBe(0);
    expect(await scanDocument(deps(null, { pickPhotos: async () => [] }).d)).toBeNull();
  });

  it("at most 24 pages", async () => {
    const many = Array.from({ length: 40 }, () => b64("x"));
    expect((await scanDocument(deps({ scanDocument: async () => ({ status: "ok", engine: "visionkit", pages: many, pdf: null }) }).d))?.pages).toHaveLength(MAX_PAGES);
  });
});

describe("the note", () => {
  const he = "שלום עולם. הפגישה ב-14:30 עם Dana ב-Tel Aviv, חדר 3.";
  const mixed = "Invoice #2026-117 — סה״כ ₪1,250.00 (כולל מע״מ)";

  it("PDF kept, each page's text under its heading, the OCR text exactly as returned (CER 0)", async () => {
    const writes = new Map<string, Uint8Array | string>();
    const ocr = [{ text: he, confidence: 91 }, { text: mixed, confidence: 88 }];
    let i = 0;
    const path = await scanToNote(
      { engine: "visionkit", pages: [new Blob(["a"]), new Blob(["b"])], pdf: new Uint8Array([37, 80, 68, 70]) },
      { ocr: async () => ocr[i++], writeBlob: async (p, b) => void writes.set(p, b), writeNote: async (p, t) => void writes.set(p, t), text: TEXT, now: WHEN },
    );
    expect(path).toBe("Scans/Scan 2026-11-17 1042.md");
    expect(writes.get("attachments/scan-2026-11-17-1042.pdf")).toEqual(new Uint8Array([37, 80, 68, 70]));
    const note = writes.get(path) as string;
    expect(note).toContain("[The scan (PDF)](<attachments/scan-2026-11-17-1042.pdf>)");
    const page = (n: number) => note.split(`## Page ${n}\n\n`)[1].split("\n\n## ")[0].trim();
    for (const [n, ref] of [[1, he], [2, mixed]] as const) {
      const m = measureItem(ref, page(n));
      expect(m.all.length, `page ${n}`).toBeGreaterThan(10);
      expect(m.all.edits, `page ${n}`).toBe(0);
      expect(m.he.items, `page ${n} has Hebrew`).toBe(1);
    }
    expect(note).toMatch(/^---\ncreated: .*\ntags: \[scan\]\nscanner: visionkit\n---\n\n# Scan\n/);
  });

  it("without a PDF the pages are kept as images and embedded; a hard page is flagged; an empty one says so", async () => {
    const writes = new Map<string, unknown>();
    const results = [{ text: "blurry", confidence: LOW_CONFIDENCE - 1 }, { text: "  ", confidence: 0 }, null];
    let i = 0;
    await scanToNote(
      { engine: "photos", pages: [new Blob(["1"]), new Blob(["2"]), new Blob(["3"])], pdf: null },
      {
        ocr: async () => {
          const r = results[i++];
          if (r === null) throw new Error("ocr crashed");
          return r;
        },
        writeBlob: async (p, b) => void writes.set(p, b),
        writeNote: async (p, t) => void writes.set(p, t),
        text: TEXT,
        now: WHEN,
      },
    );
    expect([...writes.keys()].filter((k) => k.endsWith(".jpg"))).toEqual(["attachments/scan-2026-11-17-1042-p1.jpg", "attachments/scan-2026-11-17-1042-p2.jpg", "attachments/scan-2026-11-17-1042-p3.jpg"]);
    const note = writes.get("Scans/Scan 2026-11-17 1042.md") as string;
    expect(note).toContain("![Page 1](<attachments/scan-2026-11-17-1042-p1.jpg>)");
    expect(note).toContain("> check it\n\nblurry");
    expect(note.match(/_no text_/g)).toHaveLength(2); // the empty page, and the page whose OCR failed
  });

  it("stops reading when cancelled, and reports progress", async () => {
    const ac = new AbortController();
    const progress: string[] = [];
    let n = 0;
    const writes = new Map<string, unknown>();
    await scanToNote(
      { engine: "visionkit", pages: [new Blob(["1"]), new Blob(["2"]), new Blob(["3"])], pdf: new Uint8Array([1]) },
      {
        ocr: async () => {
          n++;
          if (n === 1) ac.abort();
          return { text: "x", confidence: 90 };
        },
        writeBlob: async () => undefined,
        writeNote: async (p, t) => void writes.set(p, t),
        text: TEXT,
        now: WHEN,
        signal: ac.signal,
        onProgress: (d, t) => progress.push(`${d}/${t}`),
      },
    );
    expect(n).toBe(1);
    expect(progress).toEqual(["1/3"]);
    expect(((writes.values().next().value as string).match(/## Page/g) ?? []).length).toBe(3);
  });

  it("paths and markdown are stable", () => {
    expect(scanPaths(WHEN, 2, true)).toEqual({ note: "Scans/Scan 2026-11-17 1042.md", pdf: "attachments/scan-2026-11-17-1042.pdf", images: [] });
    expect(scanNoteMarkdown({ when: WHEN, paths: scanPaths(WHEN, 1, true), ocr: [{ text: "x", confidence: 99 }], text: TEXT, engine: "mlkit" })).toMatch(/scanner: mlkit/);
  });
});

describe("the native halves", () => {
  it("iOS: VisionKit's document camera, a PDF of the pages, and the camera purpose names scanning", () => {
    const swift = read("ios/App/App/DocScanner.swift");
    expect(swift).toMatch(/VNDocumentCameraViewController/);
    expect(swift).toMatch(/UIGraphicsPDFRenderer/);
    expect(read("ios/App/App/LumenNative.swift")).toMatch(/CAPPluginMethod\(name: "scanDocument"/);
    expect(read("ios/App/App/Info.plist")).toMatch(/scan a document into a note/);
    expect(read("ios/App/App.xcodeproj/project.pbxproj")).toMatch(/DocScanner\.swift in Sources/);
  });

  it("Android: ML Kit's scanner only when the WebView allows the service and Play services is there", () => {
    const java = read("android/app/src/main/java/com/lumen/editor/LumenNativePlugin.java");
    expect(java).toMatch(/GmsDocumentScanning\.getClient/);
    expect(java).toMatch(/!allowService \|\| GoogleApiAvailability/);
    expect(read("android/app/build.gradle")).toMatch(/play-services-mlkit-document-scanner:\$mlkitDocumentScannerVersion/);
  });
});
