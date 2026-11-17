/**
 * The optional 3D graph (plan W13.G10): the math, without the DOM.
 *
 * - `lift3d`: depth for a graph that is already laid out in 2D (the same
 *   W1.10 layout every other view uses, so the 3D view shows the same model
 *   and the same filters): z starts from a deterministic spread and relaxes
 *   — springs pull linked nodes to the same depth, a spatial hash pushes
 *   close nodes apart — O(n + m) per step, so 10k nodes stay fast.
 * - An orbit camera: yaw, pitch and distance around the graph's centre, a
 *   perspective projection to the screen, depth for drawing order.
 *
 * Why not 3d-force-graph (MIT, named in the plan): it brings three.js and
 * d3-force-3d (several hundred KB), cannot be installed in this offline
 * build, and would add a second layout model; this keeps one model and no
 * new dependency. The view is WebGL with a 2D label overlay (Graph3DView).
 */

export interface Camera {
  /** Rotation around the vertical axis, radians. */
  yaw: number;
  /** Rotation up/down, radians, kept within ±85°. */
  pitch: number;
  /** Distance from the centre, in layout units. */
  distance: number;
  /** Field of view, radians. */
  fov: number;
}

/** A stable pseudo-random in [−1, 1) for node `i` (no Math.random: the same graph looks the same). */
const hash = (i: number) => {
  let x = (i + 1) * 0x9e3779b1;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  return ((x >>> 0) / 0x100000000) * 2 - 1;
};

/** Bounding radius of 2D positions around their centre. */
export function extent(p2: ArrayLike<number>): { cx: number; cy: number; r: number } {
  const n = p2.length / 2;
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) (cx += p2[2 * i]), (cy += p2[2 * i + 1]);
  cx /= n || 1;
  cy /= n || 1;
  let r = 0;
  for (let i = 0; i < n; i++) r = Math.max(r, Math.hypot(p2[2 * i] - cx, p2[2 * i + 1] - cy));
  return { cx, cy, r: r || 1 };
}

/**
 * x, y, z per node from 2D positions and the edges (pairs of indices),
 * centred on 0. Depth spans about the graph's radius.
 */
export function lift3d(p2: ArrayLike<number>, edges: ArrayLike<number>, opts: { steps?: number } = {}): Float32Array {
  const n = p2.length / 2;
  const out = new Float32Array(3 * n);
  if (!n) return out;
  const { cx, cy, r } = extent(p2);
  const depth = r * 0.8;
  const z = new Float32Array(n);
  for (let i = 0; i < n; i++) z[i] = hash(i) * depth;
  const deg = new Float32Array(n);
  for (let e = 0; e < edges.length; e++) deg[edges[e]]++;
  const steps = opts.steps ?? 40;
  const cell = Math.max(1e-6, (2 * r) / Math.max(4, Math.round(Math.sqrt(n))));
  const sum = new Float32Array(n);
  for (let s = 0; s < steps; s++) {
    // Springs: towards the mean depth of the neighbours.
    sum.fill(0);
    for (let e = 0; e + 1 < edges.length; e += 2) {
      const a = edges[e], b = edges[e + 1];
      sum[a] += z[b];
      sum[b] += z[a];
    }
    const cool = 1 - s / steps;
    for (let i = 0; i < n; i++) if (deg[i]) z[i] += (sum[i] / deg[i] - z[i]) * 0.3 * cool;
    // Repulsion between nodes that share a 2D cell: spread them in depth.
    const grid = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const key = Math.floor((p2[2 * i] - cx) / cell) * 73856093 ^ Math.floor((p2[2 * i + 1] - cy) / cell) * 19349663;
      (grid.get(key) ?? grid.set(key, []).get(key)!).push(i);
    }
    for (const list of grid.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => z[a] - z[b]);
      const gap = (cell * 0.6) * cool + cell * 0.1;
      for (let k = 1; k < list.length; k++) if (z[list[k]] - z[list[k - 1]] < gap) z[list[k]] = z[list[k - 1]] + gap;
    }
    // Keep the depth centred and within the graph's size.
    let mz = 0;
    for (let i = 0; i < n; i++) mz += z[i];
    mz /= n;
    for (let i = 0; i < n; i++) z[i] = Math.max(-depth * 1.5, Math.min(depth * 1.5, z[i] - mz));
  }
  for (let i = 0; i < n; i++) {
    out[3 * i] = p2[2 * i] - cx;
    out[3 * i + 1] = p2[2 * i + 1] - cy;
    out[3 * i + 2] = z[i];
  }
  return out;
}

/** A camera that shows the whole graph of radius `r`. */
export const fitCamera = (r: number): Camera => ({ yaw: 0.6, pitch: 0.35, distance: Math.max(1, r) * 2.6, fov: Math.PI / 4 });

/** Column-major 4×4: perspective × view (orbit), for the vertex shader. */
export function viewProjection(c: Camera, aspect: number): Float32Array {
  const f = 1 / Math.tan(c.fov / 2);
  const near = c.distance * 0.01;
  const far = c.distance * 10;
  const proj = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
  // view = translate(0,0,−d) · rotX(pitch) · rotY(yaw)
  const view = [cy, sp * sy, -cp * sy, 0, 0, cp, sp, 0, sy, -sp * cy, cp * cy, 0, 0, 0, -c.distance, 1];
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += proj[k * 4 + row] * view[col * 4 + k];
      out[col * 4 + row] = v;
    }
  return out;
}

/** Screen x, y (px) and depth (larger = farther; < 0 = behind the camera) of a point. */
export function project(m: Float32Array, x: number, y: number, z: number, w: number, h: number): { x: number; y: number; depth: number; scale: number } {
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (cw <= 1e-6) return { x: NaN, y: NaN, depth: -1, scale: 0 };
  return { x: (cx / cw * 0.5 + 0.5) * w, y: (1 - (cy / cw * 0.5 + 0.5)) * h, depth: cw, scale: 1 / cw };
}

/** Orbit by a drag or an arrow key (radians), pitch kept within ±85°. */
export const orbit = (c: Camera, dyaw: number, dpitch: number): Camera => ({ ...c, yaw: c.yaw + dyaw, pitch: Math.max(-1.48, Math.min(1.48, c.pitch + dpitch)) });
export const zoom = (c: Camera, factor: number, r: number): Camera => ({ ...c, distance: Math.max(r * 0.2, Math.min(r * 20, c.distance * factor)) });

/** The node nearest to a screen point within `radius` px (front-most wins a tie), or −1. */
export function pick3d(m: Float32Array, p3: Float32Array, sx: number, sy: number, w: number, h: number, radius = 12): number {
  let best = -1, bestD = radius * radius, bestDepth = Infinity;
  for (let i = 0; i < p3.length / 3; i++) {
    const p = project(m, p3[3 * i], p3[3 * i + 1], p3[3 * i + 2], w, h);
    if (p.depth < 0) continue;
    const d = (p.x - sx) ** 2 + (p.y - sy) ** 2;
    if (d < bestD || (d === bestD && p.depth < bestDepth)) (best = i), (bestD = d), (bestDepth = p.depth);
  }
  return best;
}
