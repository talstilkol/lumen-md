/**
 * W10.E64 (plan 4.14): ink on PDF pages, as W3C Web Annotations in the
 * companion note. It is saved and loaded back, kept apart from the highlights
 * (neither writer drops the other's block), safe to move (same ids, new
 * source) and to duplicate (new ids). The strokes are SYNTHETIC samples.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { duplicateInk, inkAnnotation, inkPage, INK_START, moveInk, readInkNote, setPageStrokes, strokesSvg, upsertInkNote, cleanStroke, type PdfInkStroke } from "../pdf/ink";
import { createPdfAnnotation, readAnnotationsNote, upsertAnnotationsNote, ANNO_CONTEXT, RFC3778 } from "../pdf/annotations";
import { InkLayer } from "../pdf/InkLayer";

const stroke = (x: number): PdfInkStroke => ({ points: [[x, 0.1, 0.5], [x + 0.1, 0.2, 0.7], [x + 0.2, 0.25, 0.6]], size: 0.004, color: "#D03B3B" });
const labels = { title: "Highlights — paper.pdf", page: (n: number) => `p. ${n}`, empty: "No highlights yet." };
const fixedRand = () => {
  let i = 0;
  return () => (i++ * 0.6180339887) % 1;
};

describe("ink annotations (W10.E64)", () => {
  it("is a W3C annotation: page fragment refined by an SvgSelector in page units, with the samples kept", () => {
    const a = inkAnnotation({ source: "papers/p.pdf", page: 3, strokes: [stroke(0.1)], now: new Date("2026-11-15T00:00:00Z"), id: "urn:x" });
    expect(a).toMatchObject({ "@context": ANNO_CONTEXT, type: "Annotation", motivation: "highlighting", id: "urn:x", created: "2026-11-15T00:00:00.000Z" });
    expect(a.target.selector).toMatchObject({ type: "FragmentSelector", conformsTo: RFC3778, value: "page=3", refinedBy: { type: "SvgSelector" } });
    expect(a.target.selector.refinedBy.value).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" preserveAspectRatio="none"><path d="M0.1 0.1 L0.2 0.2 L0.3 0.25" fill="none" stroke="#d03b3b" stroke-width="0.004" stroke-linecap="round" stroke-linejoin="round"/></svg>');
    expect(a["lumen:strokes"][0].color).toBe("#d03b3b");
    expect(cleanStroke({ points: [[1.5, -2, 0.33333]], size: 9, color: "red" })).toEqual({ points: [[1, 0, 0.3333]], size: 0.2, color: "#000000" });
    expect(strokesSvg([{ points: [[0.5, 0.5, 0.5]], size: 0.01, color: "#000000" }])).toContain('d="M0.5 0.5 L0.5 0.5"');
  });

  it("one annotation per page: strokes added, a page emptied drops its annotation; the id and created time stay", () => {
    let list = setPageStrokes([], "p.pdf", 2, [stroke(0.1)], new Date("2026-11-15T00:00:00Z"));
    const id = list[0].id;
    list = setPageStrokes(list, "p.pdf", 2, [stroke(0.1), stroke(0.5)], new Date("2026-11-15T01:00:00Z"));
    list = setPageStrokes(list, "p.pdf", 1, [stroke(0.3)]);
    expect(list.map(inkPage)).toEqual([1, 2]);
    expect(list[1]).toMatchObject({ id, created: "2026-11-15T00:00:00.000Z", modified: "2026-11-15T01:00:00.000Z" });
    expect(list[1]["lumen:strokes"]).toHaveLength(2);
    expect(setPageStrokes(list, "p.pdf", 1, []).map(inkPage)).toEqual([2]);
  });

  it("is saved in the companion note and loaded back (dirt-free round trip); the note's own text is kept byte for byte", () => {
    const list = setPageStrokes([], "p.pdf", 1, [stroke(0.1)]);
    const note = "# My notes\n\nSome thoughts.\n";
    const saved = upsertInkNote(note, list);
    expect(saved.startsWith(note)).toBe(true);
    expect(readInkNote(saved)).toEqual(list);
    expect(upsertInkNote(saved, list)).toBe(saved);
    expect(upsertInkNote(saved, [])).toBe(note);
    expect(readInkNote(null)).toEqual([]);
  });

  it("lives beside the highlights: each writer keeps the other's block, and each strict reader still reads its own", () => {
    const hl = [createPdfAnnotation({ id: "urn:h1", source: "p.pdf", page: 1, text: "a quoted sentence here", start: 2, end: 8, now: new Date("2026-11-15T00:00:00Z") })];
    const ink = setPageStrokes([], "p.pdf", 1, [stroke(0.1)]);
    const both = upsertInkNote(upsertAnnotationsNote(null, "p.pdf", hl, labels), ink);
    expect(readAnnotationsNote(both)).toEqual(hl);
    expect(readInkNote(both)).toEqual(ink);
    const moreHl = [...hl, createPdfAnnotation({ id: "urn:h2", source: "p.pdf", page: 2, text: "another one", start: 0, end: 7 })];
    const again = upsertAnnotationsNote(both, "p.pdf", moreHl, labels);
    expect(readInkNote(again)).toEqual(ink);
    expect(readAnnotationsNote(again)).toHaveLength(2);
    const ink2 = setPageStrokes(ink, "p.pdf", 2, [stroke(0.4)]);
    expect(readAnnotationsNote(upsertInkNote(again, ink2))).toHaveLength(2);
  });

  it("a damaged ink block reads as null and is never saved over", () => {
    const broken = `text\n${INK_START}\n\`\`\`json lumen-pdf-ink\n[{"type":"Annotation"\n\`\`\`\n<!-- lumen:pdf-ink:end -->\n`;
    expect(readInkNote(broken)).toBeNull();
    expect(() => upsertInkNote(broken, [])).toThrow(/can't be read/);
    expect(readInkNote(`x ${INK_START} no end`)).toBeNull();
  });

  it("moving the PDF keeps the ids and points at the new path; duplicating gives new ids", () => {
    const list = setPageStrokes(setPageStrokes([], "a/p.pdf", 1, [stroke(0.1)]), "a/p.pdf", 2, [stroke(0.2)]);
    const moved = moveInk(list, "b/p.pdf");
    expect(moved.map((a) => a.id)).toEqual(list.map((a) => a.id));
    expect(moved.every((a) => a.target.source === "b/p.pdf")).toBe(true);
    expect(list.every((a) => a.target.source === "a/p.pdf")).toBe(true);
    const copy = duplicateInk(list, "c/copy.pdf", fixedRand());
    expect(copy.every((a, i) => a.id !== list[i].id && a.target.source === "c/copy.pdf")).toBe(true);
    expect(new Set(copy.map((a) => a.id)).size).toBe(2);
    copy[0]["lumen:strokes"][0].points[0][0] = 0.9;
    expect(list[0]["lumen:strokes"][0].points[0][0]).toBe(0.1);
  });
});

describe("the ink layer (W10.E64)", () => {
  it("draws saved strokes; in ink mode a press-move-release is one stroke", () => {
    const got: PdfInkStroke[] = [];
    const { getByTestId, getAllByTestId, rerender } = render(<InkLayer strokes={[stroke(0.1)]} width={600} height={800} drawing={false} color="#d03b3b" size={0.004} label="Ink on page 1" onStroke={(s) => got.push(s)} />);
    expect(getAllByTestId("pdf-ink-stroke")).toHaveLength(1);
    expect(getByTestId("pdf-ink-layer").style.pointerEvents).toBe("none");
    rerender(<InkLayer strokes={[stroke(0.1)]} width={600} height={800} drawing color="#d03b3b" size={0.004} label="Ink on page 1" onStroke={(s) => got.push(s)} />);
    const svg = getByTestId("pdf-ink-layer");
    fireEvent.pointerDown(svg, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 1, clientY: 1, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 1, clientY: 1, pointerId: 1 });
    expect(got).toHaveLength(1);
    expect(got[0].points.length).toBeGreaterThanOrEqual(2);
    expect(got[0]).toMatchObject({ color: "#d03b3b", size: 0.004 });
  });
});
