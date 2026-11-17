/**
 * W13.G10 — the optional 3D graph:
 * - lift3d keeps the 2D layout (x, y) and adds a depth that is finite,
 *   spread, deterministic, and keeps linked nodes closer in depth than
 *   unlinked ones; 10k nodes in well under a second;
 * - the camera: the centre projects to the middle of the screen, nearer
 *   points have smaller depth, orbit keeps the pitch within ±85°, picking
 *   finds the node under the pointer;
 * - off by default and never under prefers-reduced-motion: the entity graph
 *   offers "3D" only when motion is allowed, and the view refuses to start
 *   when it is not; the 3D view is only ever imported lazily (its own
 *   chunk), so the startup budget does not grow;
 * - the keyboard: ] / [ step through nodes (most connected first) with a
 *   live announcement, Enter opens, without WebGL it says so.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createElement as h } from "react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fitCamera, lift3d, orbit, pick3d, project, viewProjection } from "../graph/graph3d";
import { layoutGraph } from "../graph/layout";
import { Graph3DView } from "../ui/graph/Graph3DView";
import { EntityGraphView } from "../ui/EntityGraphView";
import { entityId, type Edge, type Entity } from "../entities/model";

function ring(n: number): { pos: Float32Array; edges: Uint32Array } {
  const edges = new Uint32Array(n * 2);
  for (let i = 0; i < n; i++) (edges[2 * i] = i), (edges[2 * i + 1] = (i + 1) % n);
  return { pos: layoutGraph(n, edges, { iterations: 30 }), edges };
}

const realMatchMedia = window.matchMedia;
function motion(reduce: boolean) {
  window.matchMedia = ((q: string) => ({ matches: reduce && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
}
afterEach(() => {
  window.matchMedia = realMatchMedia;
});

describe("W13.G10 lift3d", () => {
  it("keeps x, y; adds a finite, spread, deterministic depth where links pull together", () => {
    const { pos, edges } = ring(300);
    const a = lift3d(pos, edges);
    const b = lift3d(pos, edges);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a.every(Number.isFinite)).toBe(true);
    // x, y are the 2D layout's, centred.
    const cx = Array.from({ length: 300 }, (_, i) => pos[2 * i]).reduce((s, x) => s + x, 0) / 300;
    expect(a[0]).toBeCloseTo(pos[0] - cx, 3);
    const z = Array.from({ length: 300 }, (_, i) => a[3 * i + 2]);
    const mean = z.reduce((s, x) => s + x, 0) / z.length;
    const sd = Math.sqrt(z.reduce((s, x) => s + (x - mean) ** 2, 0) / z.length);
    expect(sd).toBeGreaterThan(0.5);
    let linked = 0, random = 0;
    for (let i = 0; i < 300; i++) {
      linked += Math.abs(z[i] - z[(i + 1) % 300]);
      random += Math.abs(z[i] - z[(i * 97 + 41) % 300]);
    }
    expect(linked).toBeLessThan(random * 0.6);
  });

  it("10,000 nodes in well under a second; empty and one node are fine", () => {
    const n = 10_000;
    const edges = new Uint32Array(n * 4);
    for (let i = 0; i < n * 2; i++) (edges[2 * i] = i % n), (edges[2 * i + 1] = (i * 7919 + 13) % n);
    const pos = new Float32Array(2 * n).map((_, i) => Math.sin(i * 12.9898) * 500);
    const t0 = performance.now();
    const p = lift3d(pos, edges);
    const ms = performance.now() - t0;
    console.log(`[W13.G10] lift3d 10k nodes, 20k links: ${ms.toFixed(0)} ms`);
    expect(p.every(Number.isFinite)).toBe(true);
    expect(ms).toBeLessThan(1000);
    expect(lift3d(new Float32Array(), new Uint32Array())).toHaveLength(0);
    expect(Array.from(lift3d(new Float32Array([5, 5]), new Uint32Array()))).toEqual([0, 0, expect.any(Number)]);
  });
});

describe("W13.G10 camera", () => {
  it("projects the centre to the middle; nearer is shallower; pitch is bounded; picking", () => {
    const cam = fitCamera(100);
    const m = viewProjection(cam, 800 / 600);
    const c = project(m, 0, 0, 0, 800, 600);
    expect(c.x).toBeCloseTo(400, 3);
    expect(c.y).toBeCloseTo(300, 3);
    expect(c.depth).toBeCloseTo(cam.distance, 3);
    // The camera sits on the +z side after the orbit: a point towards it is nearer.
    const toward = viewProjection({ ...cam, yaw: 0, pitch: 0 }, 1);
    expect(project(toward, 0, 0, 50, 800, 800).depth).toBeLessThan(project(toward, 0, 0, -50, 800, 800).depth);
    expect(orbit(cam, 0, 10).pitch).toBeLessThanOrEqual(1.48);
    expect(orbit(cam, 0, -10).pitch).toBeGreaterThanOrEqual(-1.48);
    const p3 = new Float32Array([0, 0, 0, 60, 0, 0]);
    const s = project(m, 60, 0, 0, 800, 600);
    expect(pick3d(m, p3, s.x + 3, s.y, 800, 600)).toBe(1);
    expect(pick3d(m, p3, 5, 5, 800, 600)).toBe(-1);
  });
});

const ent = (name: string): Entity => ({ id: entityId("person", name), type: "person", name, aliases: [] });
const A = ent("אברהם"), B = ent("שרה"), C = ent("יצחק");
const prov = { note: "a.md", anchor: "a1", quote: "q", paragraphHash: `sha256:${"0".repeat(64)}`, extractor: "user", model: null, date: "2026-11-01T00:00:00Z" };
const e = (s: Entity, o: Entity): Edge => ({ id: `${s.id}>${o.id}`, subject: s.id, predicate: "child", object: o.id, provenance: prov, confidence: 1, status: "approved" });

describe("W13.G10 off by default, never with reduced motion", () => {
  it("the entity graph offers 3D only when motion is allowed, and never starts in it", () => {
    motion(false);
    const { unmount } = render(h(EntityGraphView, { entities: [A, B, C], edges: [e(A, C), e(B, C)], notes: new Map(), initialMode: "table" }));
    const mode = screen.getByTestId("entity-graph-mode") as HTMLSelectElement;
    expect([...mode.options].map((o) => o.value)).toContain("3d");
    expect(mode.value).toBe("table");
    unmount();
    motion(true);
    render(h(EntityGraphView, { entities: [A, B, C], edges: [e(A, C), e(B, C)], notes: new Map(), initialMode: "3d" as never }));
    const m2 = screen.getByTestId("entity-graph-mode") as HTMLSelectElement;
    expect([...m2.options].map((o) => o.value)).not.toContain("3d");
    expect(m2.value).not.toBe("3d");
    expect(screen.queryByTestId("graph-3d")).toBeNull();
  });

  it("the view itself refuses to start under reduced motion", () => {
    motion(true);
    render(h(Graph3DView, { labels: ["a"], edges: new Uint32Array(), positions: new Float32Array([0, 0]), colors: new Float32Array(4), sizes: new Float32Array([4]), neighbors: () => [], onOpen: () => {}, ariaLabel: "g" }));
    expect(screen.getByTestId("graph-3d-reduced")).toBeTruthy();
    expect(screen.queryByRole("application")).toBeNull();
  });

  it("is only ever imported lazily (its own chunk; the startup bundle does not grow)", () => {
    const src = join(__dirname, "..");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const f = join(d, n);
        if (statSync(f).isDirectory()) n !== "__tests__" && walk(f);
        else if (/\.tsx?$/.test(n)) files.push(f);
      }
    };
    walk(src);
    const statics = files.filter((f) => /^\s*import\s+(?!type\b)[^;]*from\s+["'][^"']*\/Graph3DView["']/m.test(readFileSync(f, "utf8")));
    expect(statics).toEqual([]);
    const lazies = files.filter((f) => /import\(["'][^"']*\/Graph3DView["']\)/.test(readFileSync(f, "utf8")));
    expect(lazies.length).toBeGreaterThan(0);
  });
});

describe("W13.G10 keyboard and fallback", () => {
  it("] / [ step from the most connected node with a live announcement; Enter opens; no WebGL is said", async () => {
    motion(false);
    const opened: number[] = [];
    const { pos, edges } = ring(5);
    const nb = (i: number) => (i === 2 ? [1, 3, 4] : [(i + 1) % 5, (i + 4) % 5]);
    render(h(Graph3DView, { labels: ["א", "ב", "ג", "ד", "ה"], edges, positions: pos, colors: new Float32Array(20).fill(1), sizes: new Float32Array(5).fill(4), neighbors: nb, onOpen: (i: number) => opened.push(i), ariaLabel: "גרף" }));
    const surface = screen.getByRole("application");
    await act(async () => void fireEvent.focus(surface));
    expect(screen.getByTestId("graph-3d-focused").textContent).toContain("ג");
    fireEvent.keyDown(surface, { key: "]" });
    expect(surface.getAttribute("data-focus")).toBe("0");
    fireEvent.keyDown(surface, { key: "[" });
    expect(surface.getAttribute("data-focus")).toBe("2");
    fireEvent.keyDown(surface, { key: "Enter" });
    expect(opened).toEqual([2]);
    for (const key of ["ArrowLeft", "ArrowUp", "+", "-", "0", "Home"]) fireEvent.keyDown(surface, { key });
    expect(surface.getAttribute("data-focus")).toBe("2");
    // happy-dom has no WebGL: the view says so instead of drawing nothing.
    expect(screen.getByTestId("graph-3d-nogl")).toBeTruthy();
  });
});
