/**
 * Plan W13.V3 — a search with thousands of matches: the first result in
 * ≤ 50 ms (p95), all 5,000 in ≤ 1 s, in relevance order (BM25, plan 5.2),
 * streamed page by page into a virtual list whose rows never move.
 */
import { describe, expect, it } from "vitest";
import { createElement, createRef } from "react";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { VaultIndex, type SearchHit } from "../storage/vaultIndexCore";
import { streamSearch } from "../storage/searchStream";
import { HIT_OVERSCAN, HIT_ROW_HEIGHT, SearchHitList, visibleRange } from "../ui/SearchHitList";

const ROOT = resolve(__dirname, "..", "..");
const WORDS = ["פגישה", "תקציב", "מצגת", "לקוח", "חוזה", "סיכום", "budget", "meeting", "draft", "report", "שבוע", "דוח"];

/** 10,000 notes; "פרויקט" is in every other one (5,000 matches), more often in some. */
function vault10k(): VaultIndex {
  const idx = new VaultIndex();
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let i = 0; i < 10_000; i++) {
    const words: string[] = [];
    for (let w = 0; w < 120; w++) words.push(WORDS[Math.floor(rnd() * WORDS.length)]);
    if (i % 2 === 0) for (let k = 0; k <= i % 7; k++) words.splice(Math.floor(rnd() * words.length), 0, "פרויקט");
    idx.upsert({ path: `notes/${Math.floor(i / 100)}/n${i}.md`, name: `n${i}.md`, content: `# הערה ${i}\n\n${words.join(" ")}\n`, modified: i });
  }
  return idx;
}

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)];

describe("paging in the index core", () => {
  const idx = vault10k();
  const page = async (q: string, o: { limit: number; offset: number }) => idx.search(q, o);

  it("the pages, joined, are the whole ranking: nothing lost, nothing twice, the same order", async () => {
    const whole = idx.search("פרויקט", { limit: 5000 });
    expect(whole).toHaveLength(5000);
    const streamed = await streamSearch(page, "פרויקט", { onPage: () => undefined });
    expect(streamed).toHaveLength(5000);
    expect(new Set(streamed.map((h) => h.path)).size).toBe(5000);
    expect(streamed.map((h) => h.path)).toEqual(whole.map((h) => h.path));
  });

  it("is ordered by relevance (BM25): scores never go up down the list", async () => {
    const streamed = await streamSearch(page, "פרויקט", { onPage: () => undefined });
    for (let i = 1; i < streamed.length; i++) expect(streamed[i].score, String(i)).toBeLessThanOrEqual(streamed[i - 1].score + 1e-9);
  });

  it("a phrase match the first page lifts is not repeated or lost (multi-word query)", async () => {
    const whole = idx.search("פרויקט תקציב", { limit: 5000 });
    const streamed = await streamSearch(page, "פרויקט תקציב", { firstPage: 30, pageSize: 200, onPage: () => undefined });
    expect(new Set(streamed.map((h) => h.path)).size).toBe(streamed.length);
    expect(new Set(streamed.map((h) => h.path))).toEqual(new Set(whole.map((h) => h.path)));
  });

  it("first result ≤ 50 ms p95 and all 5,000 ≤ 1 s, on 10,000 notes", async () => {
    // CPU time of this process (wall clock where there is no process.cpuUsage): a shared test machine's
    // load must not decide a performance gate. The wall clock on a quiet machine is perf:large-vault's.
    const cpu = typeof process !== "undefined" && typeof process.cpuUsage === "function";
    const now = () => (cpu ? (process.cpuUsage().user + process.cpuUsage().system) / 1000 : performance.now());
    idx.search("פרויקט", { limit: 50, offset: 0 }); // warm
    const first: number[] = [];
    const all: number[] = [];
    for (let r = 0; r < 20; r++) {
      const t0 = now();
      let firstAt = -1;
      await streamSearch(page, "פרויקט", {
        onPage: () => {
          if (firstAt < 0) firstAt = now() - t0;
        },
      });
      first.push(firstAt);
      all.push(now() - t0);
    }
    expect(pct(first, 95), `first page p95 ${pct(first, 95).toFixed(1)} ms (${cpu ? "CPU" : "wall"})`).toBeLessThanOrEqual(50);
    expect(pct(all, 95), `all 5,000 p95 ${pct(all, 95).toFixed(1)} ms (${cpu ? "CPU" : "wall"})`).toBeLessThanOrEqual(1000);
  }, 120_000);
});

describe("the stream", () => {
  const fake = (n: number) => async (_q: string, o: { limit: number; offset: number }): Promise<SearchHit[]> =>
    Array.from({ length: Math.max(0, Math.min(o.limit, n - o.offset)) }, (_, i) => ({ path: `p${o.offset + i}`, name: `p${o.offset + i}`, score: n - o.offset - i, snippet: null }));

  it("appends page after page and stops at the end, or at max", async () => {
    const sizes: number[] = [];
    const out = await streamSearch(fake(1234), "x", { onPage: (h, shown) => sizes.push(h.length, shown) });
    expect(out).toHaveLength(1234);
    expect(sizes).toEqual([50, 50, 500, 550, 500, 1050, 184, 1234]);
    expect(await streamSearch(fake(9000), "x", { max: 5000, onPage: () => undefined })).toHaveLength(5000);
  });

  it("stops when the next keystroke aborts it", async () => {
    const ac = new AbortController();
    let pages = 0;
    const out = await streamSearch(fake(5000), "x", {
      signal: ac.signal,
      onPage: () => {
        if (++pages === 2) ac.abort();
      },
    });
    expect(pages).toBe(2);
    expect(out).toHaveLength(550);
  });
});

describe("the virtual list", () => {
  const hits = (n: number): SearchHit[] => Array.from({ length: n }, (_, i) => ({ path: `notes/${i}.md`, name: `${i}.md`, score: n - i, snippet: `שורה ${i}` }));

  it("draws only the rows in view and a few around them", () => {
    expect(visibleRange(5000, 0, 600)).toEqual([0, Math.ceil(600 / HIT_ROW_HEIGHT) + HIT_OVERSCAN]);
    const [a, b] = visibleRange(5000, 100 * HIT_ROW_HEIGHT, 600);
    expect(a).toBe(100 - HIT_OVERSCAN);
    expect(b - a).toBeLessThanOrEqual(Math.ceil(600 / HIT_ROW_HEIGHT) + 1 + 2 * HIT_OVERSCAN);
    expect(visibleRange(3, 0, 600)).toEqual([0, 3]);
  });

  it("5,000 results keep a few dozen rows in the DOM; a new page below moves no row (CLS 0)", () => {
    const scrollRef = createRef<HTMLDivElement>();
    const props = { active: 0, setActive: () => undefined, onOpen: () => undefined, query: "x", showMatchedAs: true, scrollRef };
    const { container, rerender } = render(createElement("div", { ref: scrollRef, style: { height: 600, overflow: "auto" } }, createElement(SearchHitList, { ...props, hits: hits(550) })));
    const rows = () => [...container.querySelectorAll<HTMLElement>("[data-search-index]")];
    const before = rows().map((r) => [r.dataset.searchIndex, r.style.insetBlockStart, r.style.blockSize]);
    expect(before.length).toBeLessThan(60);
    rerender(createElement("div", { ref: scrollRef, style: { height: 600, overflow: "auto" } }, createElement(SearchHitList, { ...props, hits: hits(5000) })));
    const after = rows().map((r) => [r.dataset.searchIndex, r.style.insetBlockStart, r.style.blockSize]);
    expect(after).toEqual(before);
    expect(container.querySelector<HTMLElement>('[data-testid="search-hit-list"]')!.style.blockSize).toBe(`${5000 * HIT_ROW_HEIGHT}px`);
  });

  it("every row has the same height, with room for the snippet and the 'matched as' line", () => {
    const scrollRef = createRef<HTMLDivElement>();
    const { container } = render(createElement("div", { ref: scrollRef }, createElement(SearchHitList, { hits: hits(5), active: 0, setActive: () => undefined, onOpen: () => undefined, query: "x", showMatchedAs: true, scrollRef })));
    const heights = new Set([...container.querySelectorAll<HTMLElement>("[data-search-index]")].map((r) => r.style.blockSize));
    expect([...heights]).toEqual([`${HIT_ROW_HEIGHT - 2}px`]);
  });

  it("the search dialog streams into it", () => {
    const src = readFileSync(join(ROOT, "src/ui/SearchDialog.tsx"), "utf8");
    expect(src).toMatch(/streamSearch\(page, query, \{/);
    expect(src).toMatch(/<SearchHitList /);
    expect(src).toMatch(/abort\.abort\(\)/);
  });
});
