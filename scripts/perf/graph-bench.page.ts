/**
 * W13.G13 — the page graph-100k.mjs loads in each browser: a synthetic
 * graph laid out with the app's own layout (src/graph/layout.ts, the code
 * the layout worker runs), drawn with the app's renderer
 * (src/graph/renderer.ts) as the graph view draws it: a still frame with
 * every link, frames in motion with the sampled links (MOTION_EDGES), and
 * zoom and pan driven frame by frame for a fixed time.
 */
import { layoutGraph } from "../../src/graph/layout";
import { createRenderer, fitView, shuffledPairs, type GraphView } from "../../src/graph/renderer";
import { syntheticGraph } from "./graphSynth";

/** The graph view's sample size while zooming or panning (ui/graph/GraphCanvas.tsx). */
const MOTION_EDGES = 8000;

interface BenchArgs {
  nodes: number;
  edges: number;
  seconds: number;
  /** Layout steps; default: the app's own default for the size. */
  iterations?: number;
}

function heapMB(): number | null {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return m ? Math.round(m.usedJSHeapSize / 1e6) : null;
}

async function frames(seconds: number, step: (t: number) => void): Promise<{ fps: number; p95FrameMs: number; frames: number }> {
  const times: number[] = [];
  const t0 = performance.now();
  let last = t0;
  await new Promise<void>((done) => {
    const tick = (now: number) => {
      step((now - t0) / 1000);
      times.push(now - last);
      last = now;
      if (now - t0 < seconds * 1000) requestAnimationFrame(tick);
      else done();
    };
    requestAnimationFrame(tick);
  });
  const sorted = times.slice(1).sort((a, b) => a - b);
  return { fps: Math.round((times.length / seconds) * 10) / 10, p95FrameMs: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0), frames: times.length };
}

async function graphBench(a: BenchArgs) {
  const heap0 = heapMB();
  const t0 = performance.now();
  const g = syntheticGraph(a.nodes, a.edges);
  const buildMs = performance.now() - t0;
  const t1 = performance.now();
  const positions = layoutGraph(a.nodes, g.edges, a.iterations ? { iterations: a.iterations } : {});
  const layoutMs = performance.now() - t1;
  const canvas = document.createElement("canvas");
  const w = 1280, h = 800;
  canvas.width = w;
  canvas.height = h;
  canvas.style.cssText = `width:${w}px;height:${h}px`;
  document.body.append(canvas);
  const r = createRenderer(canvas);
  if (!r) throw new Error("no renderer");
  r.resize(w, h, 1);
  const colors = new Float32Array(a.nodes * 4);
  for (let i = 0; i < a.nodes; i++) colors.set([((i * 37) % 255) / 255, 0.45, 0.8, 1], i * 4);
  const sizes = new Float32Array(a.nodes).fill(3);
  const t2 = performance.now();
  r.setData({ positions, edges: shuffledPairs(g.edges), colors, sizes, edgeColor: [0.4, 0.45, 0.5, 0.2] });
  const uploadMs = performance.now() - t2;
  const fit = fitView(positions, w, h);
  const t3 = performance.now();
  r.draw(fit);
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  gl?.finish();
  const stillFrameMs = performance.now() - t3;
  // Zoom in and out, then pan in a circle: the frames the user sees while moving the graph.
  const zoom = await frames(a.seconds / 2, (s) => {
    const v: GraphView = { ...fit, scale: fit.scale * (1 + 2.5 * Math.abs(Math.sin(s * 1.2))) };
    r.draw(v, undefined, MOTION_EDGES);
  });
  const pan = await frames(a.seconds / 2, (s) => {
    const v: GraphView = { x: fit.x + Math.cos(s * 2) * (w / fit.scale) * 0.2, y: fit.y + Math.sin(s * 2) * (h / fit.scale) * 0.2, scale: fit.scale * 2 };
    r.draw(v, undefined, MOTION_EDGES);
  });
  const dbg = gl?.getExtension("WEBGL_debug_renderer_info");
  return {
    nodes: a.nodes,
    edges: g.edges.length / 2,
    renderer: r.kind,
    gpu: gl && dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : gl ? String(gl.getParameter(gl.RENDERER)) : null,
    buildMs: Math.round(buildMs),
    layoutMs: Math.round(layoutMs),
    uploadMs: Math.round(uploadMs),
    stillFrameMs: Math.round(stillFrameMs),
    zoom,
    pan,
    fps: Math.min(zoom.fps, pan.fps),
    heapMB: heapMB() !== null && heap0 !== null ? heapMB()! - heap0 : null,
  };
}

(window as unknown as { graphBench: typeof graphBench }).graphBench = graphBench;
