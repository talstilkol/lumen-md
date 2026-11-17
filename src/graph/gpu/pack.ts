/**
 * The GPU layout's data, packed for textures (plan W13.G1) — pure, so the
 * tests check it without a GPU — and a CPU mirror of one layout step, the
 * exact algorithm the fragment shader runs (./shaders.ts). The browser
 * check compares the two.
 *
 * The force model is Fruchterman–Reingold: repulsion k²·m / d, springs d² / k
 * along each link, a pull to the centre, and a step capped by a temperature
 * that cools. Repulsion is approximated with a multilevel density grid, the
 * way cosmos.gl does it: level 0 is an F × F grid of (count, Σx, Σy) over
 * the layout's square; each coarser level halves it. A node takes its 3 × 3
 * neighbourhood exactly from level 0's cells, and at every level the cells
 * of its parent's 3 × 3 neighbourhood that are not its own 3 × 3 — so every
 * cell of the square is counted once, at the coarsest level that is still
 * far enough away. About 9 + 27 · log₂F texel reads per node, instead of n.
 */

/** The links of every node in CSR form, laid out for two integer textures. */
export interface PackedAdjacency {
  /** Positions texture side: node i is texel (i mod side, ⌊i / side⌋). */
  side: number;
  /** RG32UI, side × side: (first index into `nbr`, degree) per node. */
  adj: Uint32Array;
  /** Neighbour list texture side. */
  nside: number;
  /** R32UI, nside × nside: the neighbours, node after node. */
  nbr: Uint32Array;
  /** The highest degree (the shader samples hubs above MAX_DEGREE_READS). */
  maxDegree: number;
}

/** Springs read per node and step; a hub above this is sampled evenly and weighted up. */
export const MAX_DEGREE_READS = 1024;

export function packAdjacency(n: number, edges: Uint32Array): PackedAdjacency {
  const side = Math.max(1, Math.ceil(Math.sqrt(n)));
  const deg = new Uint32Array(n);
  for (let e = 0; e < edges.length; e++) {
    const v = edges[e];
    if (v >= n) throw new RangeError(`edge to node ${v} of ${n}`);
    deg[v]++;
  }
  const start = new Uint32Array(n + 1);
  let maxDegree = 0;
  for (let i = 0; i < n; i++) {
    start[i + 1] = start[i] + deg[i];
    if (deg[i] > maxDegree) maxDegree = deg[i];
  }
  const total = start[n];
  const nside = Math.max(1, Math.ceil(Math.sqrt(total)));
  const nbr = new Uint32Array(nside * nside);
  const fill = start.slice(0, n);
  for (let e = 0; e < edges.length; e += 2) {
    const a = edges[e];
    const b = edges[e + 1];
    nbr[fill[a]++] = b;
    nbr[fill[b]++] = a;
  }
  const adj = new Uint32Array(side * side * 2);
  for (let i = 0; i < n; i++) {
    adj[2 * i] = start[i];
    adj[2 * i + 1] = deg[i];
  }
  return { side, adj, nside, nbr, maxDegree };
}

/**
 * The level-0 grid side: a power of two with cells about 1.5 ideal lengths
 * wide over the layout's square (8 … 1024), so a near cell holds a few nodes.
 */
export function gridSize(n: number, k = IDEAL): number {
  const want = (2 * domainRadius(n, k)) / (1.5 * k);
  let f = 8;
  while (f < want && f < 1024) f *= 2;
  return f;
}

/** Number of grid levels (F, F/2, …, 2). */
export const gridLevels = (f: number) => Math.round(Math.log2(f));

/** Ideal link length (world units), the same spacing the CPU layout starts with. */
export const IDEAL = 10;

/** Half the side of the layout's square: the spiral start fits well inside. */
export const domainRadius = (n: number, k = IDEAL) => Math.max(20 * k, 2.5 * k * Math.sqrt(Math.max(1, n)));

export interface GpuLayoutParams {
  n: number;
  k: number;
  R: number;
  F: number;
  gravity: number;
  iterations: number;
  t0: number;
  t1: number;
}

export function defaultParams(n: number, iterations?: number): GpuLayoutParams {
  const k = IDEAL;
  const R = domainRadius(n, k);
  return { n, k, R, F: gridSize(n, k), gravity: 0.5, iterations: iterations ?? defaultGpuIterations(n), t0: Math.max(4 * k, R / 8), t1: k / 20 };
}

/** Steps: the GPU can afford many more than the CPU layout's 60 at this size. */
export const defaultGpuIterations = (n: number) => (n > 200_000 ? 250 : n > 50_000 ? 300 : 400);

/** The temperature (largest move) at a step: exponential cooling from t0 to t1. */
export const temperatureAt = (step: number, p: GpuLayoutParams) => p.t0 * Math.pow(p.t1 / p.t0, Math.min(1, step / Math.max(1, p.iterations - 1)));

/* ─── CPU mirror of the shaders ──────────────────────────────────────── */

/** The density grid's levels: level l is (F >> l)² cells of (count, Σx, Σy). */
export function buildGrid(pos: Float32Array, n: number, p: Pick<GpuLayoutParams, "R" | "F">): Float32Array[] {
  const levels: Float32Array[] = [];
  const f = p.F;
  const g0 = new Float32Array(f * f * 3);
  for (let i = 0; i < n; i++) {
    const [cx, cy] = cellOf(pos[2 * i], pos[2 * i + 1], p.R, f);
    const o = 3 * (cy * f + cx);
    g0[o]++;
    g0[o + 1] += pos[2 * i];
    g0[o + 2] += pos[2 * i + 1];
  }
  levels.push(g0);
  for (let s = f >> 1; s >= 1; s >>= 1) {
    const prev = levels[levels.length - 1];
    const ps = s * 2;
    const g = new Float32Array(s * s * 3);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++)
        for (let c = 0; c < 4; c++) {
          const o = 3 * ((2 * y + (c >> 1)) * ps + 2 * x + (c & 1));
          const t = 3 * (y * s + x);
          g[t] += prev[o];
          g[t + 1] += prev[o + 1];
          g[t + 2] += prev[o + 2];
        }
    levels.push(g);
  }
  return levels;
}

/**
 * The near field's radius in cells: a node takes the (2·NEAR + 1)² cells
 * around it at each level. 2 keeps every far cell at least two cells away
 * (Barnes–Hut θ ≈ 0.5): (2·NEAR + 1)² + ((4·NEAR + 2)² − (2·NEAR + 1)²)·log₂F reads per node.
 */
export const NEAR = 1;

/** The level-0 cell of a point (the splat shader's pixel). */
export function cellOf(x: number, y: number, R: number, f: number): [number, number] {
  const gx = ((x + R) / (2 * R)) * f;
  const gy = ((y + R) / (2 * R)) * f;
  return [Math.min(f - 1, Math.max(0, Math.floor(gx))), Math.min(f - 1, Math.max(0, Math.floor(gy)))];
}

/** Repulsion on a node at (x, y) from the grid, excluding itself (the shader's far + near field). */
export function gridRepulsion(levels: Float32Array[], x: number, y: number, p: Pick<GpuLayoutParams, "R" | "F" | "k">, onCell?: (count: number) => void): [number, number] {
  const f = p.F;
  const k2 = p.k * p.k;
  const minR2 = k2 * 0.01;
  let fx = 0;
  let fy = 0;
  const add = (count: number, sx: number, sy: number) => {
    onCell?.(count);
    if (count <= 0.5) return;
    const dx = x - sx / count;
    const dy = y - sy / count;
    const r2 = Math.max(dx * dx + dy * dy, minR2);
    fx += (dx * k2 * count) / r2;
    fy += (dy * k2 * count) / r2;
  };
  const [cx, cy] = cellOf(x, y, p.R, f);
  const g0 = levels[0];
  const r = NEAR;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const qx = cx + dx;
      const qy = cy + dy;
      if (qx < 0 || qy < 0 || qx >= f || qy >= f) continue;
      const o = 3 * (qy * f + qx);
      if (dx === 0 && dy === 0) add(g0[o] - 1, g0[o + 1] - x, g0[o + 2] - y);
      else add(g0[o], g0[o + 1], g0[o + 2]);
    }
  for (let l = 0, s = f; s >= 2; l++, s >>= 1) {
    const g = levels[l];
    const lx = cx >> l;
    const ly = cy >> l;
    const px = lx >> 1;
    const py = ly >> 1;
    for (let oy = -2 * r; oy <= 2 * r + 1; oy++)
      for (let ox = -2 * r; ox <= 2 * r + 1; ox++) {
        const qx = 2 * px + ox;
        const qy = 2 * py + oy;
        if (qx < 0 || qy < 0 || qx >= s || qy >= s) continue;
        if (Math.abs(qx - lx) <= r && Math.abs(qy - ly) <= r) continue;
        const o = 3 * (qy * s + qx);
        add(g[o], g[o + 1], g[o + 2]);
      }
  }
  return [fx, fy];
}

/** One layout step on the CPU, exactly as the shader does it (the reference for the browser check). */
export function referenceStep(pos: Float32Array, packed: PackedAdjacency, p: GpuLayoutParams, step: number): Float32Array {
  const n = p.n;
  const levels = buildGrid(pos, n, p);
  const out = new Float32Array(2 * n);
  const temp = temperatureAt(step, p);
  for (let i = 0; i < n; i++) {
    const x = pos[2 * i];
    const y = pos[2 * i + 1];
    let [fx, fy] = gridRepulsion(levels, x, y, p);
    const start = packed.adj[2 * i];
    const deg = packed.adj[2 * i + 1];
    const stride = Math.max(1, Math.ceil(deg / MAX_DEGREE_READS));
    for (let r = 0; r < MAX_DEGREE_READS && r * stride < deg; r++) {
      const j = packed.nbr[start + r * stride];
      const dx = pos[2 * j] - x;
      const dy = pos[2 * j + 1] - y;
      const d = Math.hypot(dx, dy);
      fx += (dx * d * stride) / p.k;
      fy += (dy * d * stride) / p.k;
    }
    // A pull to the centre that grows with the distance: the picture settles
    // at a radius of about k·√(n / gravity) whatever the graph.
    fx -= x * p.gravity;
    fy -= y * p.gravity;
    const len = Math.hypot(fx, fy);
    const move = len > 1e-9 ? Math.min(len, temp) / len : 0;
    const lim = p.R * 0.98;
    out[2 * i] = Math.max(-lim, Math.min(lim, x + fx * move));
    out[2 * i + 1] = Math.max(-lim, Math.min(lim, y + fy * move));
  }
  return out;
}

/** Exact O(n²) repulsion on node i (to check the grid's approximation in tests). */
export function exactRepulsion(pos: Float32Array, n: number, i: number, k: number): [number, number] {
  const k2 = k * k;
  let fx = 0;
  let fy = 0;
  for (let j = 0; j < n; j++) {
    if (j === i) continue;
    const dx = pos[2 * i] - pos[2 * j];
    const dy = pos[2 * i + 1] - pos[2 * j + 1];
    const r2 = Math.max(dx * dx + dy * dy, k2 * 0.01);
    fx += (dx * k2) / r2;
    fy += (dy * k2) / r2;
  }
  return [fx, fy];
}
