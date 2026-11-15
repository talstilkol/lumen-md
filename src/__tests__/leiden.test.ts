/**
 * Plan R12.8: Leiden (static and live) next to Louvain. The graphs are
 * SYNTHETIC: two hand-drawn ones, and a 10,000-node clustered graph from the
 * same generator as graph10k.test.ts (about 5 links per node, 90% inside its
 * cluster). Both partitions are scored with one function, Newman's Q.
 */
import { describe, expect, it } from "vitest";
import { communitiesConnected, leiden, LiveLeiden, modularity } from "../views/leiden";
import { louvain, type GraphInput } from "../views/louvain";

function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clustered(n: number, clusters = Math.max(4, Math.round(n / 250)), seed = 7): GraphInput {
  const rnd = prng(seed);
  const nodes = Array.from({ length: n }, (_, i) => `n${i}`);
  const edges: GraphInput["edges"] = [];
  for (let e = 0; e < n * 5; e++) {
    const a = Math.floor(rnd() * n);
    const b = rnd() < 0.9 ? (Math.floor(rnd() * (n / clusters)) * clusters + (a % clusters)) % n : Math.floor(rnd() * n);
    if (a !== b) edges.push({ source: nodes[a], target: nodes[b] });
  }
  return { nodes, edges };
}

const bridge: GraphInput = {
  nodes: ["a", "b", "c", "x", "y", "z"],
  edges: [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
    { source: "c", target: "a" },
    { source: "x", target: "y" },
    { source: "y", target: "z" },
    { source: "z", target: "x" },
    { source: "c", target: "x" },
  ],
};

describe("Newman's modularity", () => {
  it("two triangles joined by one edge, split at the bridge: Q = 5/14", () => {
    const parts = new Map([..."abc"].map((k) => [k, 0] as [string, number]).concat([..."xyz"].map((k) => [k, 1] as [string, number])));
    // m = 7; each side: L = 3, d = 7 → 2 × (3/7 − (7/14)²) = 6/7 − 1/2 = 5/14
    expect(modularity(bridge, parts)).toBeCloseTo(5 / 14, 12);
    expect(modularity(bridge, new Map([..."abcxyz"].map((k) => [k, 0])))).toBeCloseTo(0, 12);
  });
});

describe("static Leiden", () => {
  it("finds the two triangles", () => {
    const r = leiden(bridge);
    expect(r.numCommunities).toBe(2);
    expect(r.communities.get("a")).toBe(r.communities.get("c"));
    expect(r.communities.get("a")).not.toBe(r.communities.get("x"));
    expect(r.modularity).toBeCloseTo(5 / 14, 12);
  });

  it("never leaves a community disconnected", () => {
    const g = clustered(2000, 8, 11);
    expect(communitiesConnected(g, leiden(g).communities)).toBe(true);
  });

  it("10,000 nodes: Leiden's Q ≥ Louvain's Q (same scoring function)", () => {
    const g = clustered(10_000);
    const t0 = performance.now();
    const lo = louvain(g);
    const t1 = performance.now();
    const le = leiden(g);
    const t2 = performance.now();
    const qLo = modularity(g, lo.communities);
    const qLe = modularity(g, le.communities);
    console.log(`[R12.8] 10k nodes, ${g.edges.length} edges: Louvain Q=${qLo.toFixed(4)} (${lo.numCommunities} communities, ${(t1 - t0).toFixed(0)} ms), Leiden Q=${qLe.toFixed(4)} (${le.numCommunities}, ${(t2 - t1).toFixed(0)} ms)`);
    expect(qLe).toBeGreaterThanOrEqual(qLo);
    expect(le.modularity).toBeCloseTo(qLe, 12);
    expect(communitiesConnected(g, le.communities)).toBe(true);
  });

  it("deterministic", () => {
    const g = clustered(1000, 6, 3);
    expect([...leiden(g).communities]).toEqual([...leiden(g).communities]);
  });
});

describe("live Leiden (incremental)", () => {
  it("a bridge removed and a new triangle added, without a rebuild", () => {
    const live = new LiveLeiden(bridge);
    const moved = live.update({
      remove: [{ source: "c", target: "x" }],
      add: [
        { source: "p", target: "q" },
        { source: "q", target: "r" },
        { source: "r", target: "p" },
        { source: "r", target: "z" },
      ],
    });
    const r = live.result();
    expect(moved).toBeGreaterThanOrEqual(0);
    expect(r.communities.get("p")).toBe(r.communities.get("q"));
    expect(r.communities.get("a")).not.toBe(r.communities.get("p"));
    expect(communitiesConnected({ nodes: [...r.communities.keys()], edges: [...bridge.edges.filter((e) => !(e.source === "c" && e.target === "x")), { source: "p", target: "q" }, { source: "q", target: "r" }, { source: "r", target: "p" }, { source: "r", target: "z" }] }, r.communities)).toBe(true);
  });

  it("2,000 nodes, 200 edge changes: close to a rebuild's Q, connected, faster than a rebuild", () => {
    const g = clustered(2000, 8, 5);
    const live = new LiveLeiden(g);
    const rnd = prng(99);
    const remove = g.edges.filter(() => rnd() < 0.01).slice(0, 100);
    const add = Array.from({ length: 100 }, () => ({ source: `n${Math.floor(rnd() * 2000)}`, target: `n${Math.floor(rnd() * 2000)}` })).filter((e) => e.source !== e.target);
    const t0 = performance.now();
    live.update({ remove, add });
    const tLive = performance.now() - t0;
    const gone = new Set(remove);
    const after: GraphInput = { nodes: g.nodes, edges: [...g.edges.filter((e) => !gone.has(e)), ...add] };
    const t1 = performance.now();
    const rebuilt = leiden(after);
    const tRebuild = performance.now() - t1;
    const qLive = modularity(after, live.result().communities);
    console.log(`[R12.8] live update ${tLive.toFixed(0)} ms, Q=${qLive.toFixed(4)}; rebuild ${tRebuild.toFixed(0)} ms, Q=${rebuilt.modularity.toFixed(4)}`);
    expect(qLive).toBeGreaterThan(rebuilt.modularity * 0.97);
    expect(communitiesConnected(after, live.result().communities)).toBe(true);
    expect(tLive).toBeLessThan(tRebuild);
  });
});
