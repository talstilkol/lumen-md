/**
 * W12.R1 acceptance 2: "a scanned PDF with an OCR layer (W6.47) works the
 * same way" as a text PDF: highlight → drag to the canvas → the card's link
 * → the reader at that page, on that passage.
 *
 * For each of the 20 real scanned Hebrew pages of W6.47 (fixtures/scanned-he:
 * the lines the app's own OCR placed on each page), the whole chain runs on
 * the app's code, with the OCR layer rendered as the reader renders it
 * (OcrTextLayer, layerText):
 *
 *  1. the phrase is found on the OCR layer as the reader's search finds it
 *     (findAll, loose) and saved as the reader saves a highlight, into the
 *     PDF's sidecar note;
 *  2. All highlights reads that note (hub.buildIndex) and the panel's drag
 *     payload is made from the item exactly as HighlightsPanel does;
 *  3. the canvas makes its card (highlightCard) and the card's link is read
 *     back as the canvas's link handler does (parseCardLink), then as the
 *     reader does (parsePdfFragment, the annotation by its short id);
 *  4. the reader opens the page and anchors the highlight in the page's OCR
 *     layer. The layer is the text of a SECOND OCR run, not the first: one
 *     letter misread in another line and the spacing changed, because the
 *     anchoring is by TextQuoteSelector so that a card survives the text
 *     layer being read again (W12.R1 step 2). The anchor must cover the
 *     same passage.
 *
 * Gate: the same as W6.47's: at least 18 of the 20 pages.
 */
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import fixture from "./fixtures/scanned-he/ocr.json";
import { OcrTextLayer } from "../pdf/OcrTextLayer";
import { ocrPageOf } from "../pdf/ocrPages";
import { textLayerSpans, type PlacedLine } from "../ai/ocrLayout";
import { createPdfAnnotation, findAll, parseAnnotationsNote, parsePdfFragment, shortId, upsertAnnotationsNote, anchorAnnotation } from "../pdf/annotations";
import { layerText } from "../pdf/textMap";
import { buildIndex } from "../highlights/hub";
import { highlightCard, parseCardLink, type HighlightDrag } from "../canvas/highlightCards";
import { normalizeForMatch } from "../text/hebrew";

interface Page {
  id: string;
  page: { w: number; h: number };
  image: { w: number; h: number };
  lines: PlacedLine[];
  phrase: string;
}

const pages = (fixture as { pages: Page[] }).pages;
const SCALE = 1;

/** The text the reader's OCR layer holds for these lines. */
function renderedLayer(p: Page, lines: PlacedLine[]): string {
  const ocr = ocrPageOf({ text: "", lines }, p.image.w, p.image.h, textLayerSpans);
  const host = document.createElement("div");
  Object.assign(host.style, { position: "relative", width: `${p.page.w * SCALE}px`, height: `${p.page.h * SCALE}px` });
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<OcrTextLayer spans={ocr.spans ?? []} pageHeightPx={p.page.h * SCALE} />));
    return layerText(host.querySelector<HTMLElement>("[data-pdf-text=ocr-layer]")!);
  } finally {
    root.unmount();
    host.remove();
  }
}

/** A second OCR run of the page: one letter misread in a line without the phrase, and the spacing changed. */
function reOcr(lines: PlacedLine[], phrase: string): PlacedLine[] {
  const probe = normalizeForMatch(phrase).slice(0, 4);
  let misread = false;
  return lines.map((l) => {
    let text = l.text.replace(/ /g, "  ");
    if (!misread && !normalizeForMatch(l.text).includes(probe)) {
      const i = text.search(/[א-ת]/);
      if (i >= 0) {
        text = `${text.slice(0, i)}${text[i] === "ה" ? "ח" : "ה"}${text.slice(i + 1)}`;
        misread = true;
      }
    }
    return { ...l, text };
  });
}

const squash = (s: string) => normalizeForMatch(s).replace(/\s+/g, " ").trim();

function cardChain(p: Page, n: number): { ok: boolean; why: string } {
  // 1. Highlight on the first OCR run's layer, saved to the sidecar note.
  const first = renderedLayer(p, p.lines);
  const hits = findAll(first, p.phrase, { loose: true });
  if (hits.length !== 1) return { ok: false, why: `phrase found ${hits.length} times` };
  const id = `${String(n + 1).padStart(8, "0")}-0000-4000-8000-000000000000`;
  const pdf = `scans/${p.id}.pdf`;
  const ann = createPdfAnnotation({ id, source: pdf, page: 1, text: first, start: hits[0].start, end: hits[0].end, now: new Date("2026-11-17T08:00:00Z") });
  const sidecar = upsertAnnotationsNote(null, pdf, [ann], { title: `Highlights — ${p.id}`, page: (k) => `p. ${k}`, empty: "_none_" });
  // 2. All highlights, and the panel's drag payload (HighlightsPanel onDragStart).
  const it = buildIndex([{ path: `${pdf}.md`, content: sidecar }]).find((x) => x.kind === "pdf");
  if (!it || !it.id || !it.location) return { ok: false, why: "not in All highlights" };
  const drag: HighlightDrag = JSON.parse(JSON.stringify({ pdf: it.source, id: it.id, page: it.location, quote: it.text }));
  // 3. The card and its link, read back by the canvas and by the reader.
  const [shape] = highlightCard(drag, { x: 0, y: 0 }, (k) => `p. ${k}`, 0);
  const link = parseCardLink((shape as { link?: string | null }).link);
  if (!link) return { ok: false, why: "card has no PDF link" };
  if (link.path !== pdf || link.page !== 1) return { ok: false, why: `link ${link.path} p.${link.page}` };
  const frag = parsePdfFragment(link.fragment);
  const saved = parseAnnotationsNote(sidecar).find((a) => shortId(a.id) === frag.highlight);
  if (!saved || frag.page !== 1) return { ok: false, why: "the reader finds no highlight for the link" };
  // 4. The reader anchors it in the page's layer after a second OCR run.
  const second = renderedLayer(p, reOcr(p.lines, p.phrase));
  if (second === first) return { ok: false, why: "the second OCR run changed nothing (test setup)" };
  const anchor = anchorAnnotation(saved, second);
  if (!anchor) return { ok: false, why: "does not anchor in the re-read layer" };
  const want = squash(first.slice(hits[0].start, hits[0].end));
  const got = squash(second.slice(anchor.start, anchor.end));
  if (got !== want) return { ok: false, why: `anchored on "${got}", want "${want}"` };
  return { ok: true, why: anchor.match };
}

describe("W12.R1 on scanned PDFs: highlight → card → link → the same passage after a new OCR run", () => {
  it("the 20 scanned pages of W6.47 are the input", () => {
    expect(pages).toHaveLength(20);
  });

  it("works on at least 18 of 20 scanned pages, as on a text PDF", () => {
    const results = pages.map((p, i) => ({ id: p.id, ...cardChain(p, i) }));
    const ok = results.filter((r) => r.ok);
    console.log(`scanned cards: ${ok.length}/20 (${ok.map((r) => r.why).join(",")}); ` + results.filter((r) => !r.ok).map((r) => `${r.id} ${r.why}`).join("; "));
    expect(ok.length).toBeGreaterThanOrEqual(18);
  });

  it("the second OCR run really differs from the first in each page's layer", () => {
    for (const p of pages.slice(0, 5)) expect(renderedLayer(p, reOcr(p.lines, p.phrase))).not.toBe(renderedLayer(p, p.lines));
  });
});
