/**
 * W13.G13 — the graph performance day's harness (the measurement itself
 * runs on the Mac: `npm run perf:vault100k -- --graph`): the synthetic graph
 * is the size asked for, deterministic, without self-links, mostly local
 * with hubs; the arguments; and a missed target becomes an open finding.
 */
import { describe, expect, it } from "vitest";
import { syntheticGraph } from "../../scripts/perf/graphSynth";
// @ts-expect-error — plain .mjs module without type declarations
import { findingsOf, parseArgs, TARGETS } from "../../scripts/perf/graph-100k.mjs";

describe("W13.G13 synthetic graph", () => {
  it("100k nodes, 500k links: sized, deterministic, local, with hubs", () => {
    const t0 = performance.now();
    const g = syntheticGraph(100_000, 500_000);
    const ms = performance.now() - t0;
    expect(g.edges.length).toBe(1_000_000);
    expect(ms).toBeLessThan(2000);
    let self = 0, local = 0, max = 0;
    const deg = new Uint32Array(100_000);
    for (let k = 0; k < g.edges.length; k += 2) {
      const a = g.edges[k], b = g.edges[k + 1];
      if (a === b) self++;
      if (g.folder[a] === g.folder[b]) local++;
      deg[a]++;
      deg[b]++;
    }
    for (const d of deg) max = Math.max(max, d);
    expect(self).toBe(0);
    expect(local / 500_000).toBeGreaterThan(0.8);
    expect(max).toBeGreaterThan(10 * (1_000_000 / 100_000)); // hubs: far above the mean degree of 10
    expect(Array.from(syntheticGraph(1000, 3000).edges)).toEqual(Array.from(syntheticGraph(1000, 3000).edges));
  });
});

describe("W13.G13 runner", () => {
  it("arguments and defaults", () => {
    expect(parseArgs([])).toMatchObject({ nodes: 100_000, edges: 500_000, engines: ["chromium", "firefox", "webkit"], strict: false });
    expect(parseArgs(["--nodes", "2000", "--engines", "chromium", "--strict"])).toMatchObject({ nodes: 2000, engines: ["chromium"], strict: true });
  });
  it("a missed target is an open finding; met targets are none", () => {
    expect(TARGETS).toEqual({ chromiumFps: 30, chromiumLayoutMs: 10_000, offlineRequests: 0 });
    expect(findingsOf({ chromium: { fps: 60, layoutMs: 4000, offlineRequests: 0 }, webkit: { fps: 20, layoutMs: 12000, offlineRequests: 0 } })).toEqual([]);
    expect(findingsOf({ chromium: { fps: 24, layoutMs: 12_500, offlineRequests: 2 } })).toEqual(["chromium: 24 fps < 30", "chromium: layout 12500 ms > 10000", "chromium: 2 requests offline"]);
    expect(findingsOf({ chromium: { error: "no GPU" } })).toEqual(["chromium: no measurement (no GPU)"]);
  });
});
