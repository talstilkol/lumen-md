/**
 * W6.47: "OCR all pages" reads only the scanned pages (no text of their
 * own, not read before), in order, and reports each one (pdf/ocrAll.ts,
 * split out of PdfReader.tsx).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../pdf/ocrPages", () => ({ ocrPdfPage: vi.fn(async (_doc: unknown, page: number) => ({ text: `ocr ${page}` })) }));

import { ocrScannedPages } from "../pdf/ocrAll";
import type { OcrPage } from "../pdf/ocrPages";
import type { PdfDocument } from "../pdf/pdfjs";

const items = (s: string) => (s ? [{ str: s, transform: [1, 0, 0, 1, 0, 0], width: 10, height: 10, hasEOL: true }] : []);

function fakeDoc(texts: string[]): PdfDocument {
  return { numPages: texts.length, getPage: async (p: number) => ({ getTextContent: async () => ({ items: items(texts[p - 1]) }) }) } as unknown as PdfDocument;
}

describe("OCR every scanned page (W6.47)", () => {
  it("skips pages with text and pages already read, reads the rest in order", async () => {
    const doc = fakeDoc(["printed text", "", "", "more text"]);
    const have: Record<number, OcrPage> = { 3: { text: "done before" } as unknown as OcrPage };
    const texts = new Map<number, string>();
    const got: Array<[number, string]> = [];
    const progress = vi.fn();
    const n = await ocrScannedPages(doc, have, texts, (p, v) => got.push([p, (v as unknown as { text: string }).text]), progress);
    expect(n).toBe(1);
    expect(got).toEqual([[2, "ocr 2"]]);
    expect(progress).toHaveBeenCalledWith(2, 4);
    expect(texts.get(1)).toMatch(/printed text/);
  });

  it("uses a page text the reader already has, without asking the PDF again", async () => {
    const doc = fakeDoc(["", ""]);
    const spy = vi.spyOn(doc, "getPage");
    const n = await ocrScannedPages(doc, {}, new Map([[1, "known text"], [2, ""]]), () => {}, () => {});
    expect(n).toBe(1);
    expect(spy).not.toHaveBeenCalled();
  });
});
