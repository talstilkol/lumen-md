/**
 * W11.H14: a handwriting recogniser on this device — the classic path
 * (cleaned raster → the app's Tesseract) and a local-model seam — that runs
 * only while the measured gate is open; and the eval engine that measures
 * the same cleaning on the ivrit.ai benchmark (on the Mac).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { binarize, modelRecognizer, otsuThreshold, rasterLayout, recognizeNote, tesseractRecognizer, OCR_LINE_PX, OCR_PAD_PX, type InkRecognitionGate } from "../ink/inkText";
import { findInkBlocks, parseInk } from "../ink/inkModel";
import { cleanGray, makeHandwritingTesseract, parsePgm, toPgm } from "../../scripts/eval-public/engines/handwriting-tesseract.mjs";

const note = readFileSync(join(resolve(__dirname, "../.."), "src/__tests__/fixtures/ink/he-block.md"), "utf8");
const passed: InkRecognitionGate = { plan: "W11.H14", status: "passed", evalCard: "evals/cards/w11-h14.json", cer: 0.09, maxCer: 0.15 };
const shut: InkRecognitionGate = { ...passed, status: "not-measured", evalCard: null, cer: null };
const fakeCanvas = async () => ({}) as OffscreenCanvas;

describe("cleaning", () => {
  it("Otsu splits a bimodal histogram between its two peaks", () => {
    const g = [...Array(500).fill(20), ...Array(500).fill(230)];
    const t = otsuThreshold(g);
    expect(t).toBeGreaterThanOrEqual(20);
    expect(t).toBeLessThan(230);
  });

  it("transparent is paper, dark ink is black, the rest white", () => {
    // 3 pixels: transparent, opaque dark blue ink, opaque light grey paper.
    const rgba = [0, 0, 0, 0, 10, 20, 80, 255, 235, 235, 235, 255];
    const { gray, inkPixels } = binarize(rgba, 3, 1);
    expect([...gray]).toEqual([255, 0, 255]);
    expect(inkPixels).toBe(1);
  });

  it("lays the fixture's ink out at the OCR line height, padded", () => {
    const ink = parseInk(note.slice(findInkBlocks(note)[0]!.start, findInkBlocks(note)[0]!.end))!;
    const box = rasterLayout(ink)!;
    expect(box.height).toBe(OCR_LINE_PX + 2 * OCR_PAD_PX);
    expect(box.width).toBeGreaterThan(2 * OCR_PAD_PX);
    expect(rasterLayout({ ...ink, strokes: [] })).toBeNull();
  });
});

describe("recognising a note, behind the gate", () => {
  it("with the gate shut the recogniser is never called and the note is unchanged", async () => {
    let calls = 0;
    const r = modelRecognizer("m", async () => (calls++, "x"), fakeCanvas);
    const out = await recognizeNote(note, r, { gate: shut });
    expect(out).toMatchObject({ markdown: note, changed: 0, blocked: expect.stringMatching(/has not passed/) });
    expect(calls).toBe(0);
  });

  it("with the gate open the classic path's text goes into the block's hidden text", async () => {
    const seen: unknown[] = [];
    const r = tesseractRecognizer(async (c) => (seen.push(c), { text: "  חיפוש בינארי\nלוגריתמי " }), fakeCanvas);
    expect(r.id).toBe("tesseract-heb+eng:clean-v1");
    const out = await recognizeNote(note, r, { gate: passed });
    expect(out.changed).toBe(1);
    expect(out.markdown).toContain('data-ink-text="חיפוש בינארי לוגריתמי"');
    expect(seen).toHaveLength(1);
    const ac = new AbortController();
    ac.abort();
    await expect(recognizeNote(note, r, { gate: passed, signal: ac.signal })).rejects.toThrow(/aborted/);
  });
});

describe("the eval engine (scripts/eval-public/engines/handwriting-tesseract.mjs)", () => {
  it("reads and writes binary PGM and cleans with the app's threshold", () => {
    const gray = Uint8Array.from([10, 240, 15, 250]);
    const pgm = toPgm(2, 2, gray);
    expect(parsePgm(pgm)).toEqual({ width: 2, height: 2, gray: expect.any(Buffer) });
    expect([...parsePgm(pgm).gray]).toEqual([10, 240, 15, 250]);
    expect([...cleanGray(gray, otsuThreshold)]).toEqual([0, 255, 0, 255]);
    expect(() => parsePgm(Buffer.from("P2\n1 1\n255\n0"))).toThrow(/P5/);
  });

  it("decodes, cleans and recognises an image with local traineddata only", async () => {
    await expect(makeHandwritingTesseract({})).rejects.toThrow(/LUMEN_TESSDATA/);
    const got: Buffer[] = [];
    const e = await makeHandwritingTesseract({}, { otsu: otsuThreshold, decode: () => toPgm(2, 1, [5, 250]), ocr: async (b: Buffer) => (got.push(b), " שלום \n עולם ") });
    expect(await e.recognize("/x.png")).toBe("שלום עולם");
    expect([...parsePgm(got[0]!).gray]).toEqual([0, 255]);
  });
});
