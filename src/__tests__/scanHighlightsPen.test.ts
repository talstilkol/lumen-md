/**
 * W7.2, wave g5: the pen cases the end-to-end photo harness
 * (scripts/eval/print-highlights) found the scanner missing —
 *   • a dark blue ballpoint line was taken for a blue highlighter band (its
 *     box was the squiggle, so OCR read nothing), and a wavy line's own crest
 *     was taken for the text above it;
 *   • a fine red ballpoint line goes pale in a photo and was not "dark";
 *   • a passage underlined over two lines of a book with 1.7 leading came
 *     out as two passages.
 */
import { describe, expect, it } from "vitest";
import { detectMarks, type Pixels } from "../highlights/scan/detect";
import { groupPassages } from "../highlights/scan/text";

function paper(w = 900, h = 1200): Pixels & { set: (x: number, y: number, c: [number, number, number]) => void } {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) (data[i] = 246), (data[i + 1] = 242), (data[i + 2] = 232), (data[i + 3] = 255);
  const set = (x: number, y: number, c: [number, number, number]) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    (data[i] = c[0]), (data[i + 1] = c[1]), (data[i + 2] = c[2]);
  };
  return { width: w, height: h, data, set };
}
/** A line of print: letter strokes 3 px wide with gaps, words with spaces, from y0 to y1. */
function print(p: ReturnType<typeof paper>, x0: number, x1: number, y0: number, y1: number) {
  for (let x = x0; x < x1; x++) {
    if (x % 5 >= 3 || (x - x0) % 60 > 50) continue;
    for (let y = y0; y < y1; y++) p.set(x, y, [28, 28, 32]);
  }
}

describe("pen lines in a photo (W7.2)", () => {
  it("a dark blue wavy ballpoint line is a pen mark over the text above it, not a blue highlighter band", () => {
    const p = paper();
    print(p, 60, 840, 100, 122);
    // A wave 3 px thick, 8 px from crest to trough, 8 px under the text.
    for (let x = 300; x < 700; x++) for (let t = 0; t < 3; t++) p.set(x, 134 + t + Math.round(4 * Math.sin(x / 6)), [29, 63, 154]);
    const marks = detectMarks(p);
    expect(marks.map((m) => m.color)).toEqual(["pen"]);
    const b = marks[0].box;
    expect(b.y0).toBeLessThanOrEqual(104);
    expect(b.y1).toBeGreaterThanOrEqual(118);
    expect(b.y1).toBeLessThan(130);
    expect([b.x0 <= 305, b.x1 >= 695]).toEqual([true, true]);
  });

  it("a fine red ballpoint line, pale in the photo, is found", () => {
    const p = paper();
    print(p, 60, 840, 100, 122);
    for (let x = 200; x < 600; x++) {
      p.set(x, 127, [205, 120, 112]);
      p.set(x, 128, [190, 95, 88]);
    }
    const marks = detectMarks(p);
    expect(marks.map((m) => m.color)).toEqual(["pen"]);
    expect(marks[0].box.y1).toBeLessThan(126);
  });

  it("a passage underlined over two lines of a book (leading 1.7) is one passage", () => {
    const lines = [
      { text: "The only rule was never", color: "pen", box: { x0: 980, y0: 320, x1: 1250, y1: 335 } },
      { text: "to use the word nice", color: "pen", box: { x0: 130, y0: 373, x1: 415, y1: 394 } },
    ];
    expect(groupPassages(lines)).toEqual([{ text: "The only rule was never to use the word nice", color: "pen" }]);
  });
});
