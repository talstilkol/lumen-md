/**
 * W6.47: read every scanned page of a PDF (a page with no text of its own)
 * with the on-device OCR, one page after another. Split out of PdfReader.tsx
 * (it loads on use, with the OCR). Returns how many pages were read.
 */
import { ocrPdfPage, type OcrPage } from "./ocrPages";
import type { PdfDocument } from "./pdfjs";
import { pageTextFromItems } from "./textMap";

export async function ocrScannedPages(
  doc: PdfDocument,
  have: Readonly<Record<number, OcrPage>>,
  pageTexts: Map<number, string>,
  onOcr: (page: number, value: OcrPage) => void,
  progress: (page: number, total: number) => void,
): Promise<number> {
  let done = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    if (have[p]) continue;
    let text = pageTexts.get(p);
    if (text === undefined) {
      text = pageTextFromItems((await (await doc.getPage(p)).getTextContent()).items);
      pageTexts.set(p, text);
    }
    if (text.trim()) continue;
    progress(p, doc.numPages);
    onOcr(p, await ocrPdfPage(doc, p));
    done++;
  }
  return done;
}
