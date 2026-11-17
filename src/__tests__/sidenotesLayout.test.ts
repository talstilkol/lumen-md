/**
 * Plan W13.R9 — side notes: footnotes, comments and suggestions in the
 * margin (src/reading/sidenotes.ts), laid out without overlap
 * (src/reading/sidenotesLayout.ts).
 *
 * Acceptance: on 30 golden notes no side note covers another. The 30 notes
 * (fixtures/sidenotesGolden.json) are synthetic, labelled as such: Hebrew
 * and English, with clusters of up to three footnotes in one line, long
 * footnotes, CriticMarkup comments, insertions, deletions and
 * substitutions. Here each is rendered by the real pipeline, its notes
 * collected from the rendered DOM, and laid out from heights estimated from
 * their text and anchors one line apart (the DOM stand-in does no layout);
 * the same 30 in a real browser with real layout: e2e/sidenotes.spec.ts and
 * the Chromium harness (owed on the Mac for the spec).
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { renderMarkdown } from "../renderer/pipeline";
import { drift, layoutSidenotes, marginSide, overlaps } from "../reading/sidenotesLayout";
import { attachSidenotes, collectSidenotes } from "../reading/sidenotes";

type Golden = { name: string; dir: "rtl" | "ltr"; md: string };
const golden = JSON.parse(readFileSync(join(__dirname, "fixtures/sidenotesGolden.json"), "utf8")) as Golden[];

async function mount(md: string, dir: "rtl" | "ltr"): Promise<HTMLElement> {
  const root = document.createElement("div");
  root.setAttribute("data-preview-root", "");
  root.dir = dir;
  const prose = document.createElement("div");
  prose.className = "prose-lumen";
  root.append(prose);
  document.body.append(root);
  const el = await renderMarkdown(md, () => false);
  await act(async () => {
    createRoot(prose).render(el);
  });
  return root;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("the layout", () => {
  it("pushes a note down when the one above would cover it, and keeps order", () => {
    const notes = [
      { anchor: 100, height: 60 },
      { anchor: 110, height: 40 },
      { anchor: 120, height: 30 },
      { anchor: 400, height: 20 },
    ];
    const tops = layoutSidenotes(notes, 8);
    expect(tops).toEqual([100, 168, 216, 400]);
    expect(overlaps(tops, notes.map((n) => n.height), 8)).toBe(0);
    expect(drift(notes, tops).every((d) => d >= 0)).toBe(true);
  });

  it("past the end of the text the last notes are pulled back up, still apart", () => {
    const notes = [
      { anchor: 0, height: 50 },
      { anchor: 900, height: 80 },
      { anchor: 950, height: 80 },
    ];
    const tops = layoutSidenotes(notes, 10, 0, 1000);
    expect(tops[2] + 80).toBeLessThanOrEqual(1000);
    expect(overlaps(tops, notes.map((n) => n.height), 10)).toBe(0);
  });

  it("the margin is on the inline end: right in English, left in Hebrew", () => {
    expect(marginSide("ltr")).toBe("right");
    expect(marginSide("rtl")).toBe("left");
  });

  it("a thousand notes in one line: none covers another, in linear time", () => {
    const notes = Array.from({ length: 1000 }, (_, i) => ({ anchor: 50 + (i % 3), height: 20 + (i % 7) * 10 }));
    const t0 = performance.now();
    const tops = layoutSidenotes(notes, 6);
    expect(performance.now() - t0).toBeLessThan(20);
    expect(overlaps(tops, notes.map((n) => n.height), 6)).toBe(0);
  });
});

describe("30 golden notes", () => {
  it("there are 30, half Hebrew", () => {
    expect(golden.length).toBe(30);
    expect(golden.filter((g) => g.dir === "rtl").length).toBe(15);
  });

  for (const g of golden) {
    it(`${g.name}: every footnote, comment and suggestion becomes one note; none covers another`, async () => {
      const root = await mount(g.md, g.dir);
      const notes = collectSidenotes(root);
      const footnotes = new Set(g.md.match(/\[\^\d+\](?!:)/g) ?? []).size;
      const comments = (g.md.match(/\{>>/g) ?? []).length;
      const ins = (g.md.match(/\{\+\+/g) ?? []).length;
      const del = (g.md.match(/\{--/g) ?? []).length;
      const sub = (g.md.match(/\{~~/g) ?? []).length;
      expect(notes.filter((n) => n.kind === "footnote").length).toBe(footnotes);
      expect(notes.filter((n) => n.kind === "comment").length).toBe(comments);
      expect(notes.filter((n) => n.kind === "insert").length).toBe(ins);
      expect(notes.filter((n) => n.kind === "delete").length).toBe(del);
      expect(notes.filter((n) => n.kind === "replace").length).toBe(sub);
      // Footnote numbers follow the text; the others get letters.
      expect(notes.filter((n) => n.kind === "footnote").map((n) => n.label)).toEqual(Array.from({ length: footnotes }, (_, i) => String(i + 1)));
      // Layout: anchors one 24px line per paragraph in document order, heights from the text (40 chars a line).
      const para = new Map<Element, number>();
      const boxes = notes.map((n) => {
        const block = n.anchor.closest("p, li, h1") ?? n.anchor;
        if (!para.has(block)) para.set(block, para.size);
        const text = typeof n.content === "string" ? n.content : n.content.map((c) => c.textContent ?? "").join("");
        return { anchor: para.get(block)! * 72, height: 22 * Math.max(1, Math.ceil(text.length / 40)) };
      });
      const tops = layoutSidenotes(boxes, 10);
      expect(overlaps(tops, boxes.map((b) => b.height), 10)).toBe(0);
    });
  }
});

describe("the margins mode on a preview", () => {
  it("turns on and off: notes in a labelled list, the bottom footnotes hidden, anchors marked; off restores the text", async () => {
    const g = golden[0];
    const root = await mount(g.md, "rtl");
    const before = root.querySelector(".prose-lumen")!.innerHTML;
    const off = attachSidenotes(root, { narrow: false });
    expect(root.dataset.sidenotes).toBe("margin");
    const list = root.querySelector(".sn-list")!;
    expect(list.getAttribute("role")).toBe("list");
    const notes = root.querySelectorAll<HTMLElement>(".sn-note[role=note]");
    expect(notes.length).toBe(Number(root.dataset.sidenoteCount));
    expect(notes[0].getAttribute("aria-label")).toMatch(/1/);
    expect(root.querySelectorAll("[data-sn-anchor]").length).toBe(notes.length);
    off();
    expect(root.dataset.sidenotes).toBeUndefined();
    expect(root.querySelector(".sn-layer")).toBeNull();
    expect(root.querySelector(".prose-lumen")!.innerHTML).toBe(before);
  });

  it("narrow: each note goes under the paragraph of its anchor", async () => {
    const root = await mount("Para one[^1].\n\nPara two {>>a comment<<}.\n\n[^1]: The note.\n", "ltr");
    const off = attachSidenotes(root, { narrow: true });
    expect(root.dataset.sidenotes).toBe("inline");
    const ps = root.querySelectorAll(".prose-lumen > p");
    expect(ps[0].nextElementSibling?.classList.contains("sn-inline")).toBe(true);
    expect(ps[0].nextElementSibling?.textContent).toContain("The note.");
    expect(ps[1].nextElementSibling?.textContent).toContain("a comment");
    off();
    expect(root.querySelector(".sn-inline")).toBeNull();
  });

  it("keyboard: a footnote mark goes to its note; ↓ to the next note; Enter back to the text", async () => {
    const root = await mount("One[^1] two[^2].\n\n[^1]: First.\n[^2]: Second.\n", "ltr");
    const off = attachSidenotes(root, { narrow: false });
    const ref = root.querySelector<HTMLAnchorElement>("a[data-footnote-ref]")!;
    ref.click();
    const notes = root.querySelectorAll<HTMLElement>(".sn-note");
    expect(document.activeElement).toBe(notes[0]);
    notes[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(notes[1]);
    notes[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(document.activeElement).toBe(root.querySelectorAll("a[data-footnote-ref]")[1]);
    expect(notes[1].classList.contains("sn-active")).toBe(true);
    off();
  });

  it("collab comments anchor to the block of their source line", async () => {
    const root = document.createElement("div");
    root.innerHTML = `<div class="prose-lumen"><p data-sl="1" data-sle="1">first</p><p data-sl="3" data-sle="4">second</p></div>`;
    document.body.append(root);
    const notes = collectSidenotes(root, [{ line: 4, text: "about the second", author: "Dana" }]);
    expect(notes).toHaveLength(1);
    expect(notes[0].anchor.textContent).toBe("second");
    expect(notes[0].author).toBe("Dana");
  });
});
