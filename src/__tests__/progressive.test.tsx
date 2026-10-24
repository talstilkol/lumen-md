/**
 * Plan 8.1 step 4 — viewport-first progressive rendering changes when
 * each part of the preview reaches the DOM, never what it shows:
 *  - splitBlocks cuts Markdown at block boundaries and loses nothing;
 *  - the first-screen head is a prefix that ends on a block boundary;
 *  - a tree applied in slices renders exactly what the whole tree renders
 *    (all 50 snapshot documents), and every slice respects its budget.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Root, RootContent } from "hast";
import { hastToReact } from "../renderer/pipeline";
import { renderToHast } from "../renderer/hastPipeline";
import { StaticRenderContext } from "../renderer/components";
import { applyInSlices, firstScreen, splitBlocks } from "../renderer/progressive";
import { renderDocs } from "./fixtures/renderDocs";

vi.mock("../lib/idle", () => ({ scheduleIdle: (cb: () => void) => (setTimeout(cb, 0), () => {}) }));

const docs = renderDocs();
const staticHtml = (el: React.ReactNode) => renderToStaticMarkup(createElement(StaticRenderContext.Provider, { value: true }, el));

describe("splitBlocks", () => {
  it("loses nothing on the 50 documents", () => {
    for (const d of docs) expect(splitBlocks(d.markdown).join(""), d.name).toBe(d.markdown);
  });
  it("never splits a fence, a $$ block, a ::: container or the frontmatter", () => {
    const md = ["---", "title: x", "", "tags: [a]", "---", "", "```js", "a", "", "b", "```", "", "$$", "x", "", "y", "$$", "", ":::note", "p1", "", "p2", ":::", "", "end"].join("\n");
    const blocks = splitBlocks(md);
    expect(blocks.join("")).toBe(md);
    expect(blocks[0]).toBe("---\ntitle: x\n\ntags: [a]\n---\n\n"); // blank lines stay with the block before them
    expect(blocks.some((b) => b.includes("```js\na\n\nb\n```"))).toBe(true);
    expect(blocks.some((b) => b.includes("$$\nx\n\ny\n$$"))).toBe(true);
    expect(blocks.some((b) => b.includes(":::note\np1\n\np2\n:::"))).toBe(true);
  });
});

describe("firstScreen", () => {
  it("is a block-aligned prefix, partial only when more follows", () => {
    for (const d of docs) {
      const { head, partial } = firstScreen(d.markdown);
      expect(d.markdown.startsWith(head), d.name).toBe(true);
      expect(partial, d.name).toBe(head.length < d.markdown.length);
    }
    const welcome = docs.find((d) => d.name === "welcome-en")!.markdown;
    const { head, partial } = firstScreen(welcome);
    expect(partial).toBe(true);
    expect(head.length).toBeLessThan(welcome.length / 3);
  });
});

describe("applyInSlices", () => {
  it("slices render exactly what the whole tree renders (50 documents)", async () => {
    for (const d of docs) {
      const tree = await renderToHast(d.markdown, { raw: /<[a-zA-Z!/]/.test(d.markdown) });
      const whole = staticHtml(hastToReact(tree));
      const slices = await new Promise<React.ReactElement[]>((resolve) =>
        applyInSlices(tree, (nodes: RootContent[]) => hastToReact({ type: "root", children: nodes } as Root), (s, done) => done && resolve(s), { budgetMs: 0, step: 3 }),
      );
      expect(staticHtml(createElement(Fragment, null, ...slices)), d.name).toBe(whole);
    }
  }, 120_000);

  it("keeps each slice to its budget, and the first slice covers what the first paint showed", async () => {
    const tree: Root = { type: "root", children: Array.from({ length: 200 }, (_, i) => ({ type: "element", tagName: "p", properties: {}, children: [{ type: "text", value: String(i) }] })) };
    const sizes: number[] = [];
    let last = 0;
    await new Promise<void>((resolve) =>
      applyInSlices(
        tree,
        (nodes) => {
          // A slow converter: 1 ms a node.
          const t = performance.now();
          while (performance.now() - t < nodes.length) {
            /* busy */
          }
          return nodes.length;
        },
        (s, done) => {
          sizes.push(s.slice(last).reduce((a, b) => a + b, 0));
          last = s.length;
          if (done) resolve();
        },
        { budgetMs: 10, step: 2, minFirstElements: 30 },
      ),
    );
    expect(sizes[0]).toBeGreaterThanOrEqual(30);
    // After the first: each idle slice stops once the budget is spent (one step may overrun it).
    expect(Math.max(...sizes.slice(1))).toBeLessThanOrEqual(10 + 2 * 2);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(200);
  });
});
