/**
 * W5.19 acceptance, measured on the app's own path (audit r2: "≤ 2 s on a
 * 10,000-note vault not measured"): `morningBlock()` reads the real vault
 * index (src/storage/workspaceIndex.ts, built from the workspace's files),
 * the review file and the Hebrew calendar. Only the file store underneath is
 * in memory here. Timed twice: with the index cold (built from the 10,000
 * files inside the call, as on the first morning after the app opens) and
 * warm (the index already up, as on every other morning). The budget is the
 * warm path; the cold one is reported and held to a looser ceiling.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

const N = 10_000;
const NOW = Date.UTC(2026, 10, 12, 7, 0, 0); // Thursday 12 Nov 2026, 2 Kislev 5787
const files = new Map<string, { content: string; modified: number }>();

vi.mock("../storage/workspace", async (orig) => {
  const real = await orig<typeof import("../storage/workspace")>();
  return {
    ...real,
    isOPFSAvailable: () => true,
    isAssetName: () => false,
    listWorkspace: async () => [...files.entries()].map(([path, f]) => ({ path, name: path.split("/").pop() ?? path, size: f.content.length, modified: f.modified })),
    readWorkspaceFile: async (p: string) => {
      const f = files.get(p);
      if (f === undefined) throw Object.assign(new Error(`missing ${p}`), { name: "NotFoundError" });
      return f.content;
    },
  };
});

import { morningBlock } from "../daily/morning";
import { DEFAULT_DAILY } from "../daily/defaults";
import { __resetWorkspaceIndex } from "../storage/workspaceIndex";
import { START, END } from "../daily/morningCore";

function seed() {
  files.clear();
  for (let i = 0; i < N; i++) {
    const hebrew = i % 3 === 0;
    const body = hebrew ? "פסקה על הנושא, עם קישור ל[[n" + ((i * 7) % N) + "]] ועוד מילים. ".repeat(30) : "Some text about the topic, with a link to [[n" + ((i * 7) % N) + "]]. ".repeat(30);
    const task = i % 40 === 0 ? `\n- [ ] משימה ${i} 📅 2026-11-${String((i % 12) + 1).padStart(2, "0")}\n` : "";
    files.set(`notes/${Math.floor(i / 400)}/n${i}.md`, { content: `# Note ${i}\n\n${body}${task}\n- [x] done\n`, modified: NOW - (i % 2000) * 3_600_000 });
  }
  // The review file (.lumen/review.json) is absent: the block says there is nothing to review.
}

const day = { y: 2026, m: 11, d: 12 };
const settings = { ...DEFAULT_DAILY, morning: true };

describe("W5.19 — 'Your morning' on a 10,000-note vault, through the real index", () => {
  beforeAll(() => {
    seed();
    __resetWorkspaceIndex();
  });

  let cold = 0;
  it("cold (the index is built from the 10,000 files inside the call)", async () => {
    const t0 = performance.now();
    const block = await morningBlock(day, settings, "he", new Date(NOW));
    cold = performance.now() - t0;
    expect(block.startsWith(START)).toBe(true);
    expect(block.trimEnd().endsWith(END)).toBe(true);
    // Every line is linked to its source: the changed notes and the tasks are [[wikilinks]] into notes/.
    const listed = block.split("\n").filter((l) => /^\s*- /.test(l) && /notes\//.test(l));
    expect(listed.length).toBeGreaterThan(0);
    for (const l of listed) expect(l).toMatch(/\[\[notes\/\d+\/n\d+(\.md)?(#[^\]]*)?(\|[^\]]*)?\]\]/);
    if (process.env.SHOW_BLOCK) console.log(block);
    console.log(`[W5.19] cold: ${cold.toFixed(0)} ms for ${N} notes`);
    expect(cold).toBeLessThan(10_000);
  }, 60_000);

  it("warm (the index is up, as on every morning after the first): ≤ 2 s, median of 5, no request", async () => {
    const calls: string[] = [];
    const saved = globalThis.fetch;
    globalThis.fetch = (async (u: string) => (calls.push(String(u)), new Response(""))) as typeof fetch;
    const times: number[] = [];
    try {
      for (let r = 0; r < 5; r++) {
        const t0 = performance.now();
        await morningBlock(day, settings, "he", new Date(NOW));
        times.push(performance.now() - t0);
      }
    } finally {
      globalThis.fetch = saved;
    }
    times.sort((a, b) => a - b);
    console.log(`[W5.19] warm: median ${times[2].toFixed(0)} ms, max ${times[4].toFixed(0)} ms (cold was ${cold.toFixed(0)} ms)`);
    expect(times[2]).toBeLessThan(2000);
    expect(calls).toEqual([]);
  }, 60_000);
});
