/**
 * Plan W13.R7 — scroll sync in line space: the source-line anchor map the
 * render pipeline stamps (src/renderer/rehypeSourceLines.ts), the line ⇄
 * pixel maps (src/reading/scrollSync.ts), the linked panes
 * (src/reading/scrollLink.ts) and the keyboard between columns.
 *
 * The acceptance number — on a 2 MB note the two panes stay within one
 * line — is measured here on the real block-by-block render of a 2 MB
 * synthetic note (labelled as such): every rendered block's lines resolve
 * to the right source line, and scrolling the source to any line puts the
 * preview's top on that line ±1. The same in a real browser, with real
 * layout and CodeMirror: e2e/scroll-sync.spec.ts (owed on the Mac).
 */
import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { renderMarkdown } from "../renderer/pipeline";
import { IncrementalPreview } from "../renderer/incrementalPreview";
import { setRenderPortFactory, type RenderPort } from "../renderer/renderClient";
import { createRenderHandler } from "../renderer/renderWorkerCore";
import type { RenderReply } from "../renderer/renderProtocol";
import { anchorMap, boxAtLine, headingLines, lineToY, nextColumn, yToLine, type LineBox } from "../reading/scrollSync";
import { editorPane, linkPanes, previewPane, type EditorLike, type LinkedPane } from "../reading/scrollLink";
import { registerLineBases } from "../renderer/sourceLineRegistry";

const html = (el: ReactElement | null) => renderToStaticMarkup(el!);
const dark = () => false;

afterEach(() => setRenderPortFactory());

function inProcessWorker(): RenderPort {
  const handler = createRenderHandler();
  const port: RenderPort = {
    onmessage: null,
    onerror: null,
    terminate() {},
    postMessage(msg) {
      void handler.handle(structuredClone(msg)).then((reply) => {
        if (reply) setTimeout(() => port.onmessage?.({ data: structuredClone(reply) } as MessageEvent<RenderReply>), 0);
      });
    },
  };
  return port;
}

/** Elements with data-sl in a rendered string: tag, start, end, block key, text. */
function stamped(markup: string): { tag: string; sl: number; sle: number; sb?: string; text: string }[] {
  const out: { tag: string; sl: number; sle: number; sb?: string; text: string }[] = [];
  const re = /<([a-z0-9-]+)([^>]*?)\sdata-sl="(\d+)"([^>]*)>([^<]*)/g;
  for (let m = re.exec(markup); m; m = re.exec(markup)) {
    const attrs = m[2] + m[4];
    out.push({ tag: m[1], sl: Number(m[3]), sle: Number(/data-sle="(\d+)"/.exec(attrs)?.[1] ?? m[3]), sb: /data-sb="([^"]+)"/.exec(attrs)?.[1], text: m[5] });
  }
  return out;
}

/** A synthetic note (labelled as such): headings, Hebrew and English prose, lists, quotes, tables, code. */
function syntheticNote(targetBytes: number): string {
  const parts: string[] = [];
  let size = 0;
  for (let i = 0; size < targetBytes; i++) {
    const s = [
      `## Section ${i}`,
      i % 2 ? `פסקה ${i} בעברית עם **הדגשה** ו-English in the middle.\nשורה שנייה של אותה פסקה.` : `Paragraph ${i} with _emphasis_ and עברית.\nA second line of it.`,
      `- item ${i}.a\n- item ${i}.b`,
      i % 7 === 0 ? "| a | b |\n|---|---|\n| 1 | 2 |" : `> quote ${i}`,
      i % 5 === 0 ? "```ts\nconst x = " + i + ";\nconst y = x;\n```" : `Closing line ${i}.`,
    ].join("\n\n");
    parts.push(s);
    size += s.length + 2;
  }
  return "# A long note\n\n" + parts.join("\n\n") + "\n";
}

describe("source lines on the preview's blocks", () => {
  const note = "# Title\n\nFirst paragraph\nstill first.\n\n- one\n- two\n\n> quote\n\n```js\nlet a = 1;\n```\n\n## עברית\n\nפסקה.\n";

  it("each block carries its first and last source line when the preview asks", async () => {
    const out = stamped(html(await renderMarkdown(note, dark, { lines: true })));
    const at = (tag: string, text?: string) => out.find((e) => e.tag === tag && (text === undefined || e.text.includes(text)));
    expect(at("h1")).toMatchObject({ sl: 1, sle: 1 });
    expect(at("p", "First")).toMatchObject({ sl: 3, sle: 4 });
    expect(at("ul")).toMatchObject({ sl: 6, sle: 7 });
    expect(at("li", "two")).toMatchObject({ sl: 7 });
    expect(at("blockquote")).toMatchObject({ sl: 9 });
    // The code block (Shiki's wrapper or the plain <pre>) keeps its lines.
    expect(out.some((e) => (e.tag === "div" || e.tag === "pre") && e.sl === 11 && e.sle === 13)).toBe(true);
    expect(at("h2")).toMatchObject({ sl: 15 });
    expect(at("p", "פסקה")).toMatchObject({ sl: 17 });
  });

  it("an export (no lines asked) gets no data-sl attributes", async () => {
    expect(html(await renderMarkdown(note, dark))).not.toContain("data-sl");
  });

  it("the render worker stamps them too, through the structured-clone boundary", async () => {
    setRenderPortFactory(inProcessWorker);
    const out = stamped(html(await renderMarkdown(note, dark, { lines: true })));
    expect(out.find((e) => e.tag === "h2")).toMatchObject({ sl: 15 });
  });

  it("a 2 MB note rendered block by block: every block resolves to its source line, after an edit above it too", async () => {
    setRenderPortFactory(inProcessWorker);
    let text = syntheticNote(2_000_000);
    expect(text.length).toBeGreaterThanOrEqual(2_000_000);
    const inc = new IncrementalPreview();
    const check = async (markdown: string) => {
      const markup = html(await inc.render(markdown, dark));
      const bases = inc.lineBases();
      const lines = markdown.split("\n");
      const heads = stamped(markup).filter((e) => e.tag === "h2");
      expect(heads.length).toBe(headingLines(markdown).length - 1);
      let checked = 0;
      for (const h of heads) {
        expect(h.sb).toBeTruthy();
        const line = bases.get(h.sb!)! + h.sl - 1;
        expect(lines[line - 1]).toBe(`## ${h.text}`);
        checked++;
      }
      return checked;
    };
    expect(await check(text)).toBeGreaterThan(5000);
    // Lines added at the top: kept blocks are not re-rendered, yet their lines move with the text.
    const before = inc.rendered;
    text = "# A long note\n\nNew line one.\n\nNew line two\nand three.\n\n" + text.slice("# A long note\n\n".length);
    expect(await check(text)).toBeGreaterThan(5000);
    expect(inc.rendered - before).toBeLessThan(5);
  }, 240_000);
});

describe("the line ⇄ pixel maps", () => {
  const boxes: LineBox[] = [
    { start: 1, end: 1, top: 0, bottom: 40 }, // h1
    { start: 3, end: 6, top: 60, bottom: 160 }, // a 4-line paragraph
    { start: 8, end: 9, top: 180, bottom: 240 }, // a list
    { start: 8, end: 8, top: 180, bottom: 210 }, // its first item (same start: no second point)
    { start: 9, end: 9, top: 210, bottom: 240 },
    { start: 11, end: 11, top: 500, bottom: 520 }, // after a tall image
  ];
  const points = anchorMap(boxes, { lines: 12, height: 560 });

  it("is monotonic in both lines and pixels", () => {
    for (let i = 1; i < points.length; i++) {
      expect(points[i].line).toBeGreaterThan(points[i - 1].line);
      expect(points[i].y).toBeGreaterThanOrEqual(points[i - 1].y);
    }
  });

  it("maps a line to its block and back, fractions included", () => {
    expect(lineToY(points, 3)).toBe(60);
    expect(lineToY(points, 5)).toBe(110); // half of the paragraph
    expect(yToLine(points, 110)).toBe(5);
    expect(lineToY(points, 11)).toBe(500);
    for (let l = 1; l <= 12; l += 0.25) expect(yToLine(points, lineToY(points, l))).toBeCloseTo(l, 6);
  });

  it("drops a box laid out above where its line belongs (a side note, a float)", () => {
    const p = anchorMap([...boxes, { start: 10, end: 10, top: 20, bottom: 30 }]);
    expect(p.find((x) => x.y === 20 || x.y === 30)).toBeUndefined();
    expect(p.find((x) => x.line === 10)?.y).toBe(240); // line 10 stays where the list ends
  });

  it("the caret's block is the innermost one that holds the line", () => {
    expect(boxAtLine(boxes, 8)).toBe(boxes[3]);
    expect(boxAtLine(boxes, 4)).toBe(boxes[1]);
    expect(boxAtLine(boxes, 10)).toBeNull();
  });

  it("a 2 MB note's anchor map: any source line comes back within one line, in under 100 ms", () => {
    // 40,000 blocks of 1–6 lines with uneven rendered heights (images, tables, wrapping).
    const many: LineBox[] = [];
    let line = 1;
    let y = 0;
    for (let i = 0; i < 40_000; i++) {
      const n = 1 + (i % 6);
      const h = 18 * n + ((i * 37) % 120);
      many.push({ start: line, end: line + n - 1, top: y, bottom: y + h });
      line += n + 1;
      y += h + 12;
    }
    const t0 = performance.now();
    const map = anchorMap(many, { lines: line, height: y });
    let worst = 0;
    for (let l = 1; l < line; l += 7.3) worst = Math.max(worst, Math.abs(yToLine(map, lineToY(map, l)) - l));
    expect(performance.now() - t0).toBeLessThan(100);
    expect(worst).toBeLessThanOrEqual(1);
  });
});

/** An element with scroll geometry and a stored scrollTop (no layout in the DOM stand-in). */
function scroller(height: number, client: number): HTMLElement {
  const el = document.createElement("div");
  let top = 0;
  Object.defineProperty(el, "scrollTop", { configurable: true, get: () => top, set: (v: number) => (top = Math.max(0, Math.min(v, height - client))) });
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => height });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => client });
  el.getBoundingClientRect = () => ({ top: 0, bottom: client, left: 0, right: 100, width: 100, height: client, x: 0, y: 0, toJSON() {} }) as DOMRect;
  document.body.append(el);
  return el;
}

/** A CodeMirror-shaped view: `lines` lines of 20 px. */
function fakeView(lines: number, caret = 1): EditorLike {
  return {
    state: {
      doc: { lines, line: (n: number) => ({ from: n }), lineAt: (pos: number) => ({ number: pos }) },
      selection: { main: { head: caret } },
    },
    lineBlockAt: (from: number) => ({ top: (from - 1) * 20, height: 20, from }),
    lineBlockAtHeight: (h: number) => {
      const n = Math.min(lines, Math.floor(h / 20) + 1);
      return { top: (n - 1) * 20, height: 20, from: n };
    },
  };
}

/** A preview root whose blocks have fixed boxes (relative to the content top). */
function fakePreview(blocks: { sl: number; sle: number; top: number; h: number; sb?: string }[], height: number, client: number) {
  const root = scroller(height, client);
  for (const b of blocks) {
    const el = document.createElement("p");
    el.dataset.sl = String(b.sl);
    el.dataset.sle = String(b.sle);
    if (b.sb) el.dataset.sb = b.sb;
    el.getBoundingClientRect = () => ({ top: b.top - root.scrollTop, bottom: b.top + b.h - root.scrollTop, height: b.h, width: 100, left: 0, right: 100, x: 0, y: 0, toJSON() {} }) as DOMRect;
    root.append(el);
  }
  return root;
}

const fire = (el: HTMLElement, type: string) => el.dispatchEvent(new Event(type));
const settle = () => new Promise((r) => setTimeout(r, 40));

describe("linked panes", () => {
  it("source → preview → source keeps the same line at the top", async () => {
    const ed = scroller(2000, 400);
    const view = fakeView(100);
    // Preview: line n of 1..100 in 10 blocks of 10 lines, each 300 px (taller than the source).
    const blocks = Array.from({ length: 10 }, (_, i) => ({ sl: i * 10 + 1, sle: i * 10 + 10, top: i * 300, h: 300 }));
    const pv = fakePreview(blocks, 3000, 400);
    const a = editorPane(ed, () => view);
    const b = previewPane(pv, () => "");
    const off = linkPanes(a, b);
    fire(ed, "mouseenter");
    ed.scrollTop = 20 * 34; // line 35 at the top
    fire(ed, "scroll");
    await settle();
    expect(b.topLine()).toBeCloseTo(35, 5);
    expect(pv.scrollTop).toBeCloseTo(3 * 300 + 4 * 30, 5);
    fire(pv, "mouseenter");
    pv.scrollTop = 1500; // the top of block 6 = line 51
    fire(pv, "scroll");
    await settle();
    expect(a.topLine()).toBeCloseTo(51, 5);
    off();
  });

  it("a long note's blocks resolve through the registered line bases", async () => {
    const pv = fakePreview([{ sl: 1, sle: 2, top: 0, h: 100, sb: "b1" }, { sl: 1, sle: 3, top: 100, h: 300, sb: "b2" }], 1000, 200);
    registerLineBases(pv, () => new Map([["b1", 1], ["b2", 41]]));
    const p = previewPane(pv, () => "");
    expect(p.scrollToLine(42)).toBe(true);
    expect(pv.scrollTop).toBe(200);
  });

  it("the follower's echo does not bounce back, and the end meets the end", async () => {
    const ed = scroller(2000, 400);
    const pv = fakePreview([{ sl: 1, sle: 100, top: 0, h: 5000 }], 5000, 400);
    const a = editorPane(ed, () => fakeView(100));
    const b = previewPane(pv, () => "");
    let moved = 0;
    const real = Object.getOwnPropertyDescriptor(ed, "scrollTop")!;
    Object.defineProperty(ed, "scrollTop", { configurable: true, get: real.get, set: (v) => { moved++; real.set!.call(ed, v); } });
    const off = linkPanes(a, b);
    fire(ed, "mouseenter");
    ed.scrollTop = 1600; // the bottom
    moved = 0;
    fire(ed, "scroll");
    await settle();
    fire(pv, "scroll"); // the preview's own scroll event: the editor leads, nothing comes back
    await settle();
    expect(moved).toBe(0);
    expect(pv.scrollTop).toBe(4600);
    off();
  });

  it("when the preview re-renders under the reader (a long note's blocks coming in), it follows the source again", async () => {
    const ed = scroller(2000, 400);
    const blocks = Array.from({ length: 10 }, (_, i) => ({ sl: i * 10 + 1, sle: i * 10 + 10, top: i * 300, h: 300 }));
    const pv = fakePreview(blocks, 6000, 400);
    const a = editorPane(ed, () => fakeView(100));
    const b = previewPane(pv, () => "");
    const off = linkPanes(a, b);
    fire(ed, "mouseenter");
    ed.scrollTop = 20 * 50; // line 51
    fire(ed, "scroll");
    await settle();
    expect(pv.scrollTop).toBe(1500);
    // The blocks above grow (estimated placeholders replaced by rendered blocks): every block moves down 200px.
    pv.querySelectorAll<HTMLElement>("p").forEach((el, i) => {
      el.getBoundingClientRect = () => ({ top: i * 300 + 200 - pv.scrollTop, bottom: i * 300 + 500 - pv.scrollTop, height: 300, width: 100, left: 0, right: 100, x: 0, y: 0, toJSON() {} }) as DOMRect;
    });
    pv.append(document.createElement("div")); // the re-render the observer sees
    await new Promise((r) => setTimeout(r, 150));
    expect(pv.scrollTop).toBe(1700);
    expect(b.topLine()).toBeCloseTo(51, 5);
    off();
  });

  it("the preview marks the block that holds the source caret", async () => {
    const ed = scroller(2000, 400);
    const view = fakeView(100, 25);
    const pv = fakePreview([{ sl: 1, sle: 20, top: 0, h: 300 }, { sl: 21, sle: 30, top: 300, h: 300 }], 3000, 400);
    const b: LinkedPane = previewPane(pv, () => "");
    const off = linkPanes(editorPane(ed, () => view), b, { followCaret: true });
    fire(ed, "keyup");
    expect(pv.querySelectorAll("[data-sync-caret]").length).toBe(1);
    expect((pv.querySelector("[data-sync-caret]") as HTMLElement).dataset.sl).toBe("21");
    off();
    expect(pv.querySelector("[data-sync-caret]")).toBeNull();
  });

  it("without any line map the panes scroll proportionally", async () => {
    const a = scroller(1100, 100);
    const b = scroller(2100, 100);
    const pa = previewPane(a, () => "");
    const pb = previewPane(b, () => "");
    const off = linkPanes(pa, pb);
    fire(a, "mouseenter");
    a.scrollTop = 500;
    fire(a, "scroll");
    await settle();
    expect(b.scrollTop).toBe(1000);
    off();
  });
});

describe("columns by keyboard", () => {
  it("left to right: → is the next column; right to left: ← is", () => {
    expect(nextColumn(3, 0, "ArrowRight", "ltr")).toBe(1);
    expect(nextColumn(3, 1, "ArrowLeft", "ltr")).toBe(0);
    expect(nextColumn(3, 0, "ArrowLeft", "rtl")).toBe(1);
    expect(nextColumn(3, 2, "ArrowRight", "rtl")).toBe(1);
    expect(nextColumn(3, 2, "ArrowLeft", "rtl")).toBe(2); // the last column stays
  });
});
