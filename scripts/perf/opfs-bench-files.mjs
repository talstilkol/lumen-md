/**
 * W11.Q11: the files of the OPFS benchmark, shared by the driver
 * (opfs-bench.mjs, Node) and the page (opfs-bench.page.ts, bundled for the
 * browser), so both cut the same files from the same pool.
 */

/** File sizes: log-normal with the given median (bytes), from a fixed seed. */
export function sizes(n, median = 2048, sigma = 0.8, seed = 42) {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) + 0.5) / 2 ** 32;
  return Array.from({ length: n }, () => {
    const z = Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd());
    return Math.max(64, Math.round(median * Math.exp(sigma * z)));
  });
}

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/**
 * Where each file's text sits in the pool: a flat [start, length, start,
 * length, …] list. The page cuts the files itself from one copy of the pool
 * (opfs-bench.page.ts, `fileAt`), so a 10,000-file run sends 2.7 MB of pool
 * and 20,000 numbers to the page instead of 28 MB of file texts in one
 * page.evaluate message (the 10k run crashed the page in L8).
 */
export function spans(n, poolLength) {
  const out = new Array(n * 2);
  let at = 0;
  sizes(n).forEach((size, i) => {
    if (at + size > poolLength) at = 0;
    out[2 * i] = at;
    out[2 * i + 1] = Math.min(size, poolLength);
    at += size;
  });
  return out;
}

/** File `i` of a run: the same path and text on both sides. */
export function fileAt(pool, sp, i) {
  return { path: `f${i % 100}/note-${i}.md`, text: pool.slice(sp[2 * i], sp[2 * i] + sp[2 * i + 1]) };
}
