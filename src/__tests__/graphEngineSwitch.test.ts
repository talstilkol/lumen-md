/**
 * W13.G1 — the graph's engine switch: the standard engine below 20,000
 * nodes, the GPU layout above (WebGL 2 + float targets), the table where a
 * big graph meets no WebGL 2; the same CSR model packed for the GPU; the
 * multilevel grid's repulsion against the exact sum; the CPU mirror of the
 * shader step; the fallback when the GPU fails at run time; and the GPU code
 * as its own lazy chunk.
 *
 * The shader itself is checked against `referenceStep` in headless Chromium
 * (WebGL 2): the lane's harness, not this file, since Node has no GPU.
 */
import { describe, expect, it } from "vitest";
import { buildGraph, filteredGraph, neighborsOf, type GraphNoteInput } from "../graph/graphModel";
import { initialPositions } from "../graph/layout";
import { chooseEngine, gpuCapable, GPU_THRESHOLD, layoutWithEngine, NO_CAPS, probeCaps, textureSide, type GraphCaps } from "../graph/engine";
import { buildGrid, defaultParams, exactRepulsion, gridLevels, gridRepulsion, gridSize, packAdjacency, referenceStep, temperatureAt, MAX_DEGREE_READS } from "../graph/gpu/pack";

const GPU: GraphCaps = { webgl2: true, floatTargets: true, floatBlend: true, maxTextureSize: 8192 };

function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** n notes in clusters, ~2.5 links each, 90% inside the cluster. */
function vault(n: number, clusters = Math.max(4, Math.round(n / 250)), seed = 7): GraphNoteInput[] {
  const rnd = prng(seed);
  const notes = Array.from({ length: n }, (_, i) => ({ path: `c${i % clusters}/n${i}.md`, wikiTargets: [] as string[] }));
  for (let e = 0; e < n * 2.5; e++) {
    const a = Math.floor(rnd() * n);
    const b = rnd() < 0.9 ? (Math.floor(rnd() * (n / clusters)) * clusters + (a % clusters)) % n : Math.floor(rnd() * n);
    notes[a].wikiTargets.push(`n${b}`);
  }
  return notes;
}

describe("the switch", () => {
  it("standard below 20,000 nodes, GPU from 20,000 when the GPU can", () => {
    expect(GPU_THRESHOLD).toBe(20_000);
    expect(chooseEngine(19_999, GPU)).toEqual({ kind: "standard", reason: "auto-small" });
    expect(chooseEngine(20_000, GPU)).toEqual({ kind: "gpu", reason: "auto-big" });
    expect(chooseEngine(500_000, GPU, "auto", 2_000_000).kind).toBe("gpu");
    expect(chooseEngine(0, GPU).kind).toBe("standard");
  });
  it("a big graph without WebGL 2, float targets or float blending is a table, a small one stays drawn", () => {
    for (const caps of [NO_CAPS, { ...GPU, floatTargets: false }, { ...GPU, floatBlend: false }]) {
      expect(chooseEngine(100_000, caps)).toEqual({ kind: "list", reason: "no-webgl2" });
      expect(chooseEngine(5_000, caps).kind).toBe("standard");
    }
  });
  it("the textures must fit: positions ⌈√n⌉ wide, the neighbour list ⌈√2m⌉", () => {
    expect(textureSide(100_000)).toBe(317);
    expect(gpuCapable({ ...GPU, maxTextureSize: 316 }, 100_000)).toBe(false);
    expect(gpuCapable({ ...GPU, maxTextureSize: 317 }, 100_000, 10)).toBe(true);
    expect(gpuCapable({ ...GPU, maxTextureSize: 400 }, 100_000, 1_000_000)).toBe(false); // √2,000,000 ≈ 1415
  });
  it("the toolbar's choice wins; a GPU choice the GPU can't do falls back as automatic would", () => {
    expect(chooseEngine(100_000, GPU, "standard")).toEqual({ kind: "standard", reason: "pref" });
    expect(chooseEngine(10, GPU, "list")).toEqual({ kind: "list", reason: "pref" });
    expect(chooseEngine(10, GPU, "gpu")).toEqual({ kind: "gpu", reason: "pref" });
    expect(chooseEngine(100_000, NO_CAPS, "gpu")).toEqual({ kind: "list", reason: "pref-unavailable" });
    expect(chooseEngine(100, NO_CAPS, "gpu")).toEqual({ kind: "standard", reason: "pref-unavailable" });
  });
  it("probes the GPU once, through a throwaway context, and reads a broken one as no WebGL 2", () => {
    const exts = new Set(["EXT_color_buffer_float", "EXT_float_blend"]);
    let lost = 0;
    const gl = {
      MAX_TEXTURE_SIZE: 0x0d33,
      getExtension: (n: string) => (n === "WEBGL_lose_context" ? { loseContext: () => lost++ } : exts.has(n) ? {} : null),
      getParameter: () => 4096,
    };
    const canvas = { getContext: (k: string) => (k === "webgl2" ? gl : null) } as unknown as HTMLCanvasElement;
    expect(probeCaps(() => canvas, true)).toEqual({ webgl2: true, floatTargets: true, floatBlend: true, maxTextureSize: 4096 });
    expect(lost).toBe(1);
    expect(probeCaps(() => null, false).webgl2).toBe(true); // cached
    exts.delete("EXT_float_blend");
    expect(probeCaps(() => canvas, true).floatBlend).toBe(false);
    const broken = { getContext: () => { throw new Error("blocked"); } } as unknown as HTMLCanvasElement;
    expect(probeCaps(() => broken, true)).toEqual(NO_CAPS);
    expect(probeCaps(() => null, true)).toEqual(NO_CAPS);
  });
});

describe("the same model, packed for the GPU", () => {
  const g = buildGraph(vault(3000));
  const sub = filteredGraph(g, {});
  const packed = packAdjacency(sub.nodes.length, sub.edges);
  it("the CSR textures hold exactly graphModel's neighbours", () => {
    expect(packed.side).toBe(Math.ceil(Math.sqrt(3000)));
    expect(packed.adj.length).toBe(packed.side ** 2 * 2);
    for (let i = 0; i < 3000; i += 37) {
      const start = packed.adj[2 * i];
      const deg = packed.adj[2 * i + 1];
      const got = Array.from(packed.nbr.subarray(start, start + deg)).sort((a, b) => a - b);
      const want = Array.from(neighborsOf(g, i)).sort((a, b) => a - b);
      expect(got).toEqual(want);
    }
    expect(packed.nside ** 2).toBeGreaterThanOrEqual(sub.edges.length);
  });
  it("the filters are the model's: a filtered subgraph packs its own nodes", () => {
    const f = filteredGraph(g, { folder: "c1" });
    const p = packAdjacency(f.nodes.length, f.edges);
    let total = 0;
    for (let i = 0; i < f.nodes.length; i++) total += p.adj[2 * i + 1];
    expect(total).toBe(f.edges.length);
    expect(f.nodes.length).toBeLessThan(3000);
  });
  it("refuses an edge to a node that isn't there", () => {
    expect(() => packAdjacency(2, Uint32Array.from([0, 5]))).toThrow(RangeError);
  });
  it("packs 100,000 nodes and 250,000 links fast enough to start at once", () => {
    const rnd = prng(3);
    const n = 100_000;
    const edges = new Uint32Array(500_000);
    for (let e = 0; e < edges.length; e += 2) {
      edges[e] = Math.floor(rnd() * n);
      edges[e + 1] = (edges[e] + 1 + Math.floor(rnd() * (n - 1))) % n;
    }
    const t0 = performance.now();
    const p = packAdjacency(n, edges);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(p.side).toBe(317);
    expect(p.nside).toBe(Math.ceil(Math.sqrt(500_000)));
  });
});

describe("the multilevel grid (the shader's algorithm, on the CPU)", () => {
  it("sizes: cells about 1.5 link lengths wide, a power of two up to 1024; log₂F levels", () => {
    expect(gridSize(1)).toBe(32);
    expect(gridSize(20_000)).toBe(512);
    expect(gridSize(100_000)).toBe(1024);
    expect(gridSize(10_000_000)).toBe(1024);
    expect(gridLevels(256)).toBe(8);
  });
  it("every other node is counted exactly once, at some level", () => {
    const n = 4000;
    const pos = initialPositions(n, 10);
    const p = defaultParams(n);
    const levels = buildGrid(pos, n, p);
    expect(levels.length).toBe(gridLevels(p.F) + 1);
    expect(levels[levels.length - 1][0]).toBe(n);
    for (const i of [0, 1, 777, 1999, 3999]) {
      let seen = 0;
      gridRepulsion(levels, pos[2 * i], pos[2 * i + 1], p, (c) => (seen += c));
      expect(seen).toBeCloseTo(n - 1, 3);
    }
  });
  it("approximates the exact O(n²) repulsion: median error under 1%, 90th percentile under 5%", () => {
    const n = 3000;
    const rnd = prng(11);
    // A clumpy picture as a layout makes it: 12 clusters, nodes about one link length apart.
    const spiral = initialPositions(250, 10);
    const pos = new Float32Array(2 * n);
    for (let i = 0; i < n; i++) {
      const c = i % 12;
      const j = Math.floor(i / 12);
      pos[2 * i] = Math.cos(c) * 500 + spiral[2 * j] + rnd();
      pos[2 * i + 1] = Math.sin(c) * 500 + spiral[2 * j + 1] + rnd();
    }
    const p = defaultParams(n);
    const levels = buildGrid(pos, n, p);
    const errs: number[] = [];
    const abs: number[] = [];
    let meanForce = 0;
    for (let i = 0; i < n; i += 7) {
      const [ax, ay] = gridRepulsion(levels, pos[2 * i], pos[2 * i + 1], p);
      const [ex, ey] = exactRepulsion(pos, n, i, p.k);
      errs.push(Math.hypot(ax - ex, ay - ey) / Math.hypot(ex, ey));
      abs.push(Math.hypot(ax - ex, ay - ey));
      meanForce += Math.hypot(ex, ey) / Math.ceil(n / 7);
    }
    errs.sort((a, b) => a - b);
    abs.sort((a, b) => a - b);
    expect(errs[errs.length >> 1]).toBeLessThan(0.01);
    expect(errs[Math.floor(errs.length * 0.9)]).toBeLessThan(0.05);
    expect(abs[Math.floor(abs.length * 0.95)] / meanForce).toBeLessThan(0.02);
  });
  it("cools from t0 to t1", () => {
    const p = defaultParams(50_000, 300);
    expect(temperatureAt(0, p)).toBeCloseTo(p.t0);
    expect(temperatureAt(299, p)).toBeCloseTo(p.t1);
    expect(temperatureAt(150, p)).toBeLessThan(p.t0);
  });
});

describe("the step (the CPU mirror of the shader)", () => {
  it("lays out a clustered graph: finite, inside the square, clusters tighter than the whole", () => {
    const notes = vault(1200, 6);
    const g = buildGraph(notes);
    const n = g.paths.length;
    const packed = packAdjacency(n, g.edges);
    const p = defaultParams(n, 120);
    let pos = initialPositions(n, p.k);
    for (let s = 0; s < p.iterations; s++) pos = referenceStep(pos, packed, p, s);
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < n; i++) {
      expect(Number.isFinite(pos[2 * i]) && Math.abs(pos[2 * i]) <= p.R).toBe(true);
      cx += pos[2 * i] / n;
      cy += pos[2 * i + 1] / n;
    }
    const spread = (ids: number[]) => {
      let mx = 0;
      let my = 0;
      for (const i of ids) {
        mx += pos[2 * i] / ids.length;
        my += pos[2 * i + 1] / ids.length;
      }
      return ids.reduce((s, i) => s + Math.hypot(pos[2 * i] - mx, pos[2 * i + 1] - my), 0) / ids.length;
    };
    const all = Array.from({ length: n }, (_, i) => i);
    const linked = all.filter((i) => g.offsets[i + 1] > g.offsets[i]);
    const clusterSpread = [0, 1, 2, 3, 4, 5].map((c) => spread(linked.filter((i) => g.folders[i] === `c${c}`)));
    const avg = clusterSpread.reduce((a, b) => a + b) / 6;
    expect(avg).toBeLessThan(spread(linked) * 0.75);
    expect(Math.hypot(cx, cy)).toBeLessThan(p.R * 0.2);
  });
  it("samples a hub above MAX_DEGREE_READS evenly and weights it up", () => {
    const n = 3000;
    const edges: number[] = [];
    for (let i = 1; i < n; i++) edges.push(0, i);
    const packed = packAdjacency(n, Uint32Array.from(edges));
    expect(packed.maxDegree).toBe(n - 1);
    expect(packed.maxDegree).toBeGreaterThan(MAX_DEGREE_READS);
    const p = defaultParams(n, 10);
    const out = referenceStep(initialPositions(n, p.k), packed, p, 0);
    expect(Number.isFinite(out[0]) && Number.isFinite(out[1])).toBe(true);
  });
});

describe("running an engine", () => {
  const edges = Uint32Array.from([0, 1, 1, 2]);
  const cpu = async (n: number) => initialPositions(n);
  it("the GPU engine's result when it runs", async () => {
    const pos = Float32Array.from([1, 2, 3, 4, 5, 6]);
    const r = await layoutWithEngine("gpu", 3, edges, undefined, { load: async () => ({ runGpuLayout: async () => pos }) as never, fallback: cpu as never });
    expect(r.ran).toBe("gpu");
    expect(r.positions).toBe(pos);
  });
  it("a GPU failure (lost context, refused shader) falls back to the standard layout", async () => {
    const r = await layoutWithEngine("gpu", 3, edges, undefined, { load: async () => ({ runGpuLayout: async () => { throw new Error("context lost"); } }) as never, fallback: cpu as never });
    expect(r.ran).toBe("standard");
    expect(r.positions.length).toBe(6);
    const r2 = await layoutWithEngine("gpu", 3, edges, undefined, { load: async () => { throw new Error("chunk failed"); }, fallback: cpu as never });
    expect(r2.ran).toBe("standard");
  });
  it("an abort is not a failure: it stops, no fallback", async () => {
    const ac = new AbortController();
    ac.abort();
    let fell = false;
    await expect(
      layoutWithEngine("gpu", 3, edges, undefined, { signal: ac.signal, load: async () => ({ runGpuLayout: async () => { throw new DOMException("aborted", "AbortError"); } }) as never, fallback: (async () => { fell = true; return new Float32Array(6); }) as never }),
    ).rejects.toThrow("aborted");
    expect(fell).toBe(false);
  });
  it("the standard engine never loads the GPU chunk", async () => {
    let loaded = false;
    const r = await layoutWithEngine("standard", 3, edges, undefined, { load: async () => { loaded = true; throw new Error("no"); }, fallback: cpu as never });
    expect(loaded).toBe(false);
    expect(r.ran).toBe("standard");
  });
});

describe("the GPU engine is a lazy chunk", () => {
  it("engine.ts reaches ./gpu only through import(); a split build puts the GPU code in its own chunk", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const src = readFileSync(join(root, "src/graph/engine.ts"), "utf8");
    expect(src).toMatch(/import\("\.\/gpu\/gpuLayout"\)/);
    expect(src).not.toMatch(/^import[^;]*from\s+"\.\/gpu/m);
    const view = readFileSync(join(root, "src/ui/GraphView.tsx"), "utf8");
    expect(view).not.toMatch(/from\s+"\.\.\/graph\/gpu/);
    const esbuild = await import("esbuild");
    const r = await esbuild.build({ entryPoints: [join(root, "src/graph/engine.ts")], bundle: true, splitting: true, format: "esm", outdir: "/out", write: false, metafile: true, packages: "external", logLevel: "silent" });
    const outs = Object.values(r.metafile!.outputs);
    const entry = outs.find((o) => o.entryPoint?.endsWith("src/graph/engine.ts"))!;
    expect(Object.keys(entry.inputs).some((f) => f.includes("graph/gpu/"))).toBe(false);
    const gpuChunk = outs.find((o) => Object.keys(o.inputs).some((f) => f.endsWith("graph/gpu/gpuLayout.ts")));
    expect(gpuChunk).toBeDefined();
    expect(gpuChunk).not.toBe(entry);
    expect(entry.imports.some((im) => im.kind === "dynamic-import")).toBe(true);
  });
});
