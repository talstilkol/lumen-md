/**
 * W13.G13 — a synthetic vault graph for the graph performance day: `n`
 * notes in folders of ~200 (communities), `m` links, 85 % inside a folder
 * and the rest across, degrees skewed like a real vault (a few hubs), from
 * a fixed seed — the same graph in every browser and on every run.
 */
export interface SynthGraph {
  /** Pairs of node indices, no self-links. */
  edges: Uint32Array;
  /** Folder (community) of each node. */
  folder: Uint16Array;
}

export function syntheticGraph(n: number, m: number, seed = 1337): SynthGraph {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const size = 200;
  const folders = Math.max(1, Math.ceil(n / size));
  const folder = new Uint16Array(n);
  for (let i = 0; i < n; i++) folder[i] = Math.min(folders - 1, Math.floor(i / size));
  const edges = new Uint32Array(m * 2);
  let k = 0;
  while (k < m && n > 1) {
    const a = Math.floor(rnd() * n);
    // Skewed targets: hubs (low indices of each folder) are linked more.
    const local = rnd() < 0.85;
    const base = local ? folder[a] * size : Math.floor(rnd() * folders) * size;
    const span = Math.max(1, Math.min(size, n - base));
    const b = base + Math.floor(span * rnd() ** 2.2);
    if (b === a || b >= n) continue;
    edges[2 * k] = a;
    edges[2 * k + 1] = b;
    k++;
  }
  return { edges, folder };
}
