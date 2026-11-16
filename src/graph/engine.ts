/**
 * The graph's engine switch (plan W13.G1): one renderer layer, two engines,
 * chosen by the size of the graph on screen.
 *
 * - "standard" (below 20,000 nodes): the W1.10 engine — Barnes–Hut layout in
 *   a worker, WebGL / Canvas drawing (./renderer.ts), labels and keyboard.
 * - "gpu" (20,000 nodes and up, WebGL 2 with float render targets): the
 *   force layout runs on the GPU (./gpu/gpuLayout.ts, a lazy chunk), in the
 *   spirit of cosmos.gl — positions live in a float texture, repulsion comes
 *   from a multilevel density grid, springs read the CSR adjacency from a
 *   texture. Drawing, labels and the keyboard stay the same.
 * - "list" (a big graph and no WebGL 2): the text alternative, the table of
 *   notes and links (W10.E60 / W13.G11) — never a frozen tab.
 *
 * The same graphModel (CSR) and the same filters feed every engine: an engine
 * only receives the filtered subgraph's node count and edges.
 *
 * This file is in the graph view's chunk; the GPU code is loaded only when
 * the GPU engine is picked (`loadGpuLayout`).
 */

import { runLayout } from "./layoutClient";

export type GraphEngineKind = "gpu" | "standard" | "list";
export type GraphEnginePref = "auto" | GraphEngineKind;

/** From this many nodes the GPU engine takes over (the research's 20k). */
export const GPU_THRESHOLD = 20_000;

export interface GraphCaps {
  /** A WebGL 2 context can be made. */
  webgl2: boolean;
  /** RGBA32F render targets (EXT_color_buffer_float). */
  floatTargets: boolean;
  /** Additive blending into RGBA32F (EXT_float_blend), for the density grid. */
  floatBlend: boolean;
  /** MAX_TEXTURE_SIZE: the position texture is ⌈√n⌉ wide. */
  maxTextureSize: number;
}

export const NO_CAPS: GraphCaps = { webgl2: false, floatTargets: false, floatBlend: false, maxTextureSize: 0 };

let cachedCaps: GraphCaps | null = null;

/** What this browser's GPU can do (asked once, on a throwaway canvas). */
export function probeCaps(make: () => HTMLCanvasElement | null = () => (typeof document === "undefined" ? null : document.createElement("canvas")), fresh = false): GraphCaps {
  if (cachedCaps && !fresh) return cachedCaps;
  let caps = NO_CAPS;
  try {
    const gl = make()?.getContext("webgl2") as WebGL2RenderingContext | null | undefined;
    if (gl) {
      caps = {
        webgl2: true,
        floatTargets: !!gl.getExtension("EXT_color_buffer_float"),
        floatBlend: !!gl.getExtension("EXT_float_blend"),
        maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0,
      };
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
    // why: a blocked or broken GPU reads as "no WebGL 2"; the switch below then picks another engine
    caps = NO_CAPS;
  }
  cachedCaps = caps;
  return caps;
}

/** The position texture's side for n nodes. */
export const textureSide = (n: number) => Math.max(1, Math.ceil(Math.sqrt(n)));

/** Can the GPU engine lay out n nodes and m links here? */
export function gpuCapable(caps: GraphCaps, n: number, m = 0): boolean {
  if (!caps.webgl2 || !caps.floatTargets || !caps.floatBlend) return false;
  // Positions and the neighbour list (2m entries) each fit one square texture.
  return textureSide(n) <= caps.maxTextureSize && textureSide(Math.max(1, 2 * m)) <= caps.maxTextureSize;
}

export interface EngineChoice {
  kind: GraphEngineKind;
  /** Why, for the status line and the tests: "auto-small", "auto-big", "no-webgl2", "pref". */
  reason: "auto-small" | "auto-big" | "no-webgl2" | "pref" | "pref-unavailable";
}

/**
 * The engine for a graph of n nodes and m links. `pref` is the user's choice
 * in the toolbar; "gpu" where the GPU can't do it falls back as "auto" would.
 */
export function chooseEngine(n: number, caps: GraphCaps, pref: GraphEnginePref = "auto", m = 0): EngineChoice {
  const gpuOk = gpuCapable(caps, n, m);
  if (pref === "list" || pref === "standard") return { kind: pref, reason: "pref" };
  if (pref === "gpu") return gpuOk ? { kind: "gpu", reason: "pref" } : { ...chooseEngine(n, caps, "auto", m), reason: "pref-unavailable" };
  if (n < GPU_THRESHOLD) return { kind: "standard", reason: "auto-small" };
  return gpuOk ? { kind: "gpu", reason: "auto-big" } : { kind: "list", reason: "no-webgl2" };
}

/** The GPU layout: its own chunk, fetched the first time a big graph opens. */
export const loadGpuLayout = () => import("./gpu/gpuLayout");

export interface EngineLayoutResult {
  positions: Float32Array;
  /** The engine that actually ran (the GPU one can fail at run time, e.g. a lost context). */
  ran: "gpu" | "standard";
  ms: number;
}

/**
 * Lay out with the chosen engine; `onFrame` gets positions while it settles.
 * A GPU failure (context lost, shader refused) falls back to the standard
 * layout instead of leaving an empty graph.
 */
export async function layoutWithEngine(
  kind: "gpu" | "standard",
  n: number,
  edges: Uint32Array,
  onFrame?: (positions: Float32Array) => void,
  opts: { signal?: AbortSignal; load?: typeof loadGpuLayout; fallback?: typeof runLayout } = {},
): Promise<EngineLayoutResult> {
  const now = () => (typeof performance === "undefined" ? Date.now() : performance.now());
  const t0 = now();
  const fallback = opts.fallback ?? runLayout;
  if (kind === "gpu") {
    try {
      const mod = await (opts.load ?? loadGpuLayout)();
      const positions = await mod.runGpuLayout(n, edges, { onFrame, signal: opts.signal });
      return { positions, ran: "gpu", ms: now() - t0 };
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      // why: the GPU engine failed here (no context, a refused shader): the CPU layout still draws the graph
    }
  }
  const positions = await fallback(n, edges, onFrame);
  return { positions, ran: "standard", ms: now() - t0 };
}
