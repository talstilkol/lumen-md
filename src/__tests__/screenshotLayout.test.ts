/**
 * W7.16, the on-device path: the layout reader (src/ai/screenshotLayout.ts)
 * on drawn pixels — ruled tables found with their rows and columns, dark
 * panels (code) found and read inverted, empty bands never sent to OCR, the
 * scale, and the note put together in the screen's order (a Hebrew table's
 * columns right to left, a cell read without Hebrew read again in English,
 * a dark-theme window read as a page, not as one code block).
 */
import { describe, expect, it } from "vitest";
import { cellBoxes, findDarkPanels, isDarkPage, findTables, grey, inkBox, ocrScale, planRegions, scaleGrey, screenshotOcr, tableMarkdown, type Pixels } from "../ai/screenshotLayout";

function canvas(w: number, h: number, bg = 255): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) (data[i] = data[i + 1] = data[i + 2] = bg), (data[i + 3] = 255);
  return { width: w, height: h, data };
}
function rect(px: Pixels, x0: number, y0: number, x1: number, y1: number, v: number) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * px.width + x) * 4;
    px.data[i] = px.data[i + 1] = px.data[i + 2] = v;
  }
}
/** A 3-column, 3-row ruled table at (x, y), cells 100×30, rules 1 px of #adb5bd (180), a "word" of ink in each cell. */
function table(px: Pixels, x: number, y: number, cols = 3, rows = 3) {
  for (let r = 0; r <= rows; r++) rect(px, x, y + r * 30, x + cols * 100 + 1, y + r * 30 + 1, 180);
  for (let c = 0; c <= cols; c++) rect(px, x + c * 100, y, x + c * 100 + 1, y + rows * 30 + 1, 180);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) rect(px, x + c * 100 + 10, y + r * 30 + 10, x + c * 100 + 50, y + r * 30 + 20, 20);
}
const text = (px: Pixels, x: number, y: number, w = 200) => rect(px, x, y, x + w, y + 12, 25);

describe("finding the layout", () => {
  it("a ruled table: its rules, its cells, and the text above and below it as bands", () => {
    const px = canvas(600, 300);
    text(px, 20, 20);
    table(px, 40, 60);
    text(px, 20, 220);
    const g = grey(px);
    const [t] = findTables(g, 600, 300);
    expect(t.rows).toEqual([60, 90, 120, 150]);
    expect(t.cols).toEqual([40, 140, 240, 340]);
    expect(cellBoxes(t).map((r) => r.length)).toEqual([3, 3, 3]);
    expect(planRegions(g, 600, 300).map((r) => r.kind)).toEqual(["text", "table", "text"]);
  });

  it("not a table: a lone rule, an underline, a filled bar, two rules without a column rule inside", () => {
    const px = canvas(600, 300);
    rect(px, 20, 40, 500, 41, 180); // a divider
    rect(px, 20, 80, 500, 110, 120); // a filled bar (a button)
    rect(px, 20, 150, 400, 151, 180);
    rect(px, 20, 180, 400, 181, 180);
    rect(px, 20, 210, 400, 211, 180); // three rules, no vertical ones
    expect(findTables(grey(px), 600, 300)).toEqual([]);
  });

  it("a dark panel is code; a dark-theme window is a page", () => {
    const px = canvas(600, 300);
    text(px, 20, 20);
    rect(px, 30, 60, 560, 160, 30); // a code block
    rect(px, 50, 80, 300, 92, 220); // light text on it
    const g = grey(px);
    expect(findDarkPanels(g, 600, 300)).toEqual([{ x0: 30, y0: 60, x1: 560, y1: 160 }]);
    expect(planRegions(g, 600, 300).map((r) => r.kind)).toEqual(["text", "code", "text"]);
  });

  it("a band with no ink is not sent to OCR (an empty band comes back as invented letters)", () => {
    const px = canvas(300, 100);
    rect(px, 0, 90, 300, 100, 200); // a window shadow: light grey
    const g = grey(px);
    expect(inkBox(g, 300, { x0: 0, y0: 0, x1: 300, y1: 100 })).toBeNull();
    text(px, 40, 30, 100);
    expect(inkBox(grey(px), 300, { x0: 0, y0: 0, x1: 300, y1: 100 })).toEqual({ x0: 34, y0: 24, x1: 146, y1: 48 });
  });

  it("scale: ×3 for an ordinary screenshot, ×2 for a Retina one, within the pixel budget; bilinear and inverted when asked", () => {
    expect(ocrScale(800, 600)).toBe(3);
    expect(ocrScale(2400, 1500)).toBe(2);
    expect(ocrScale(1600, 4000)).toBe(1);
    expect(ocrScale(4000, 3000)).toBe(1);
    const g = new Uint8Array([0, 255, 0, 255]);
    const s = scaleGrey(g, 2, 2, 2);
    expect([s.width, s.height]).toEqual([4, 4]);
    expect(s.data[0]).toBe(0);
    expect(scaleGrey(g, 2, 2, 1, undefined, true).data[0]).toBe(255);
  });

  it("tableMarkdown: header, separator, rows; | escaped; ragged rows padded", () => {
    expect(tableMarkdown([["a", "b"], ["1|2", "x"], ["3"]])).toBe("| a | b |\n| --- | --- |\n| 1\\|2 | x |\n| 3 |  |");
  });
});

describe("putting the note together", () => {
  it("in the screen's order: text, a Hebrew table right to left, a code block fenced; a cell without Hebrew read again in English", async () => {
    const px = canvas(600, 400);
    text(px, 20, 20);
    table(px, 40, 60, 3, 2);
    rect(px, 30, 200, 560, 300, 30);
    rect(px, 50, 220, 300, 232, 220);
    const calls: string[] = [];
    const both = ["שם", "ציון", "LUM-1", "דנה", "90", "| 1"];
    const latin = ["LUM-101", "90", "LUM-7"];
    const blocks = ["כותרת", "npm ERR! code 1\n"];
    const note = await screenshotOcr(px, async (_img, mode) => {
      calls.push(mode);
      return (mode === "block" ? blocks : mode === "line" ? both : latin).shift() ?? "";
    });
    expect(note).toBe(["כותרת", "| LUM-101 | ציון | שם |\n| --- | --- | --- |\n| LUM-7 | 90 | דנה |", "```\nnpm ERR! code 1\n```"].join("\n\n"));
    // Only the cells read without Hebrew went to the English model.
    expect(calls.filter((m) => m === "line-latin")).toHaveLength(3);
  });

  it("a dark-theme window: read inverted as a page — no code fence around everything", async () => {
    const px = canvas(500, 300, 28);
    rect(px, 40, 40, 300, 52, 230);
    const seen: number[] = [];
    const note = await screenshotOcr(px, async (img) => (seen.push(img.data[0]), "Dark mode text"));
    expect(note).toBe("Dark mode text");
    expect(seen[0]).toBeGreaterThan(200); // the page was inverted: dark text on light, as Tesseract expects
    expect(isDarkPage(grey(px))).toBe(true);
    expect(isDarkPage(grey(canvas(10, 10)))).toBe(false);
  });
});
