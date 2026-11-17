/**
 * W12.R3, wave g5: a highlight on a scanned book's page carries the page
 * number PRINTED on it. The PDF here is SYNTHETIC, written byte by byte
 * below: 6 pages, /PageLabels "i, ii" for the cover and front matter, then
 * decimal from 14 (ISO 32000-1 §12.4.2) — the shape of a scanned chapter.
 * pdf.js (the app's reader) reads it; the export cites "עמ׳ 14", not "עמ׳ 3".
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../pdf/pdfjs", () => ({
  openPdf: async (data: Uint8Array) => {
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as {
      GlobalWorkerOptions: { workerSrc: string };
      getDocument(o: { data: Uint8Array; isEvalSupported: boolean }): { promise: Promise<unknown>; destroy(): Promise<void> };
    };
    pdfjs.GlobalWorkerOptions.workerSrc = "pdfjs-dist/legacy/build/pdf.worker.min.mjs";
    const task = pdfjs.getDocument({ data, isEvalSupported: false });
    return { doc: await task.promise, close: () => task.destroy() };
  },
}));

const written: Record<string, string> = {};
vi.mock("../citations/library", () => ({
  loadLibrary: async () => [{ key: "cohen2020", record: { type: "book", authors: [{ family: "כהן", given: "דנה" }], year: "2020", title: "ספר לדוגמה", publisher: "הוצאה" } }],
  searchLibrary: (lib: unknown[]) => lib,
}));
vi.mock("../ui/PromptDialog", () => ({ uiSelect: async () => "cohen2020" }));
vi.mock("../storage/workspaceEvents", () => ({ notifyWorkspaceChanged: () => undefined }));
vi.mock("../storage/workspace", () => ({
  readWorkspaceBlob: async () => new Blob([SCANNED_BYTES()]),
  uniqueWorkspaceName: async (p: string) => p,
  writeWorkspaceFile: async (p: string, text: string) => {
    written[p] = text;
  },
}));
/** Hoisted mocks run before the module body: the bytes come through a function. */
function SCANNED_BYTES(): Uint8Array {
  return pdfWith(6, "<< /Nums [0 << /S /r >> 2 << /S /D /St 14 >>] >>");
}

import { labelsByPage, pdfPageLabels, withPageLabels } from "../highlights/pageLabels";
import { runApaExport } from "../highlights/apaExportRun";
import { exportNoteApa, type SourceMeta } from "../highlights/apaExport";
import type { HighlightItem } from "../highlights/hub";

/** A minimal valid PDF: `pages` empty pages and an optional /PageLabels number tree. */
function pdfWith(pages: number, pageLabels: string | null): Uint8Array {
  const objs: string[] = [];
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i} 0 R`).join(" ");
  objs.push(`<< /Type /Catalog /Pages 2 0 R${pageLabels ? ` /PageLabels ${pageLabels}` : ""} >>`);
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
  for (let i = 0; i < pages; i++) objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] >>`);
  let out = "%PDF-1.7\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

const SCANNED = pdfWith(6, "<< /Nums [0 << /S /r >> 2 << /S /D /St 14 >>] >>");
const PLAIN = pdfWith(3, null);

const cohen = { type: "book" as const, authors: [{ family: "כהן", given: "דנה" }, { family: "לוי", given: "יוסי" }, { family: "מזרחי", given: "רון" }], year: "2020", title: "ספר לדוגמה", publisher: "הוצאה" };
const hl = (source: string, page: number): HighlightItem =>
  ({ key: `pdf:n:${page}`, kind: "pdf", source, notePath: "n.md", id: String(page), text: "ציטוט", note: "", tags: [], location: page, link: source, created: null }) as unknown as HighlightItem;

describe("printed page labels from the PDF", () => {
  it("pdf.js reads the scanned chapter's labels: i, ii, then 14…", async () => {
    expect(await pdfPageLabels(SCANNED.slice())).toEqual({ 1: "i", 2: "ii", 3: "14", 4: "15", 5: "16", 6: "17" });
  });

  it("a PDF without labels, or one that can't be opened, gives none (the index is used)", async () => {
    expect(await pdfPageLabels(PLAIN.slice())).toBeUndefined();
    expect(await pdfPageLabels(new TextEncoder().encode("not a pdf"))).toBeUndefined();
    expect(labelsByPage(["1", "2", "3"])).toBeUndefined();
    expect(labelsByPage(["", "ii", null, "4"])).toEqual({ 2: "ii" });
  });

  it("the export cites the printed page: a highlight on PDF page 3 is (…, עמ׳ 14)", async () => {
    const metas = new Map<string, SourceMeta>([["books/scan.pdf", { key: "cohen2020", record: cohen }]]);
    const items = [hl("books/scan.pdf", 3), hl("books/scan.pdf", 1)];
    // A fresh copy each read, as the vault gives: pdf.js takes the buffer it is handed.
    await withPageLabels(metas, items, async () => SCANNED.slice());
    expect(metas.get("books/scan.pdf")!.pageLabels).toMatchObject({ 3: "14", 1: "i" });
    const r = exportNoteApa(items, (s) => metas.get(s) ?? null, { title: "הדגשות", references: "מקורות", where: (it) => `עמ׳ ${it.location}` });
    expect(r.ok).toBe(true);
    expect((r as { markdown: string }).markdown).toContain("עמ׳ 14)");
    expect((r as { markdown: string }).markdown).toContain("עמ׳ i)");
  });

  it("the panel's export (runApaExport) reads the labels from the vault: the note says עמ׳ 14", async () => {
    try {
      localStorage.removeItem("lumen.highlights.citeKeys");
    } catch {
      /* why: no storage here; the library question is answered by the mock */
    }
    const path = await runApaExport([hl("books/scan.pdf", 3)], (it) => `עמ׳ ${it.location}`);
    expect(path).toBeTruthy();
    expect(written[path!]).toContain("עמ׳ 14)");
    expect(written[path!]).not.toContain("עמ׳ 3)");
  });

  it("a source that can't be read keeps its metadata unchanged", async () => {
    const metas = new Map<string, SourceMeta>([["gone.pdf", { key: "k", record: cohen }]]);
    await withPageLabels(metas, [hl("gone.pdf", 2)], async () => Promise.reject(new Error("missing")));
    expect(metas.get("gone.pdf")).toEqual({ key: "k", record: cohen });
  });
});
