#!/usr/bin/env node
/**
 * Deterministic source maps (plan W4.16, W10.D21): rewrite every `.map`
 * under a folder so that two builds of the same commit give the same bytes,
 * whatever machine, checkout path or temporary folder built them.
 *
 *   node scripts/supply-chain/normalize-maps.mjs <dir> [--root <repo>]
 *
 * For each map:
 *  - `sources` become forward-slash paths relative to the map's folder;
 *    `sourceRoot` is folded into them and dropped. An absolute path inside
 *    `--root` (the checkout) becomes relative; one outside it keeps only
 *    what follows its last `node_modules/` (another machine's cache), or
 *    becomes `<external>/<name>` (a temporary folder).
 *  - `sources` are sorted, `sourcesContent` follows them, and the
 *    `mappings` are rewritten for the new source order; `names` are sorted
 *    the same way. What each generated position points at does not change.
 *  - `file` is the map's own basename without `.map`, and the keys are
 *    written in one fixed order.
 *
 * A release ships no maps (plan 11.5); this is for LUMEN_SOURCEMAP=1 builds,
 * and for repro-check's `--sourcemap` mode, which compares them byte by byte.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { filesUnder } from "./lib.mjs";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));

/** Base64 VLQ (the source-map v3 encoding) → integers. */
export function decodeVlq(s) {
  const out = [];
  let value = 0;
  let shift = 0;
  for (const ch of s) {
    const d = B64_INDEX.get(ch);
    if (d === undefined) throw new Error(`not base64 VLQ: ${JSON.stringify(ch)}`);
    value += (d & 31) << shift;
    if (d & 32) {
      shift += 5;
      continue;
    }
    out.push(value & 1 ? -(value >>> 1) : value >>> 1);
    value = 0;
    shift = 0;
  }
  if (shift) throw new Error("truncated VLQ");
  return out;
}

/** Integers → base64 VLQ. */
export function encodeVlq(values) {
  let out = "";
  for (const v of values) {
    let n = v < 0 ? (-v << 1) | 1 : v << 1;
    do {
      let d = n & 31;
      n >>>= 5;
      if (n) d |= 32;
      out += B64[d];
    } while (n);
  }
  return out;
}

/** `mappings` → lines of absolute segments [genCol, src?, line?, col?, name?]. */
export function decodeMappings(mappings) {
  const lines = [];
  let src = 0;
  let line = 0;
  let col = 0;
  let name = 0;
  for (const l of mappings.split(";")) {
    const segs = [];
    let gen = 0;
    if (l)
      for (const s of l.split(",")) {
        const v = decodeVlq(s);
        gen += v[0];
        if (v.length >= 4) {
          src += v[1];
          line += v[2];
          col += v[3];
          if (v.length >= 5) {
            name += v[4];
            segs.push([gen, src, line, col, name]);
          } else segs.push([gen, src, line, col]);
        } else segs.push([gen]);
      }
    lines.push(segs);
  }
  return lines;
}

/** Lines of absolute segments → `mappings`. */
export function encodeMappings(lines) {
  let src = 0;
  let line = 0;
  let col = 0;
  let name = 0;
  return lines
    .map((segs) => {
      let gen = 0;
      return segs
        .map((s) => {
          const v = [s[0] - gen];
          gen = s[0];
          if (s.length >= 4) {
            v.push(s[1] - src, s[2] - line, s[3] - col);
            src = s[1];
            line = s[2];
            col = s[3];
            if (s.length >= 5) {
              v.push(s[4] - name);
              name = s[4];
            }
          }
          return encodeVlq(v);
        })
        .join(",");
    })
    .join(";");
}

const toPosix = (p) => p.split("\\").join("/");

/**
 * One source path, made machine-independent. `mapDir` and `root` are
 * absolute paths on this machine.
 */
export function normalizeSource(source, { mapDir, root, sourceRoot = "" }) {
  let s = toPosix(String(source ?? ""));
  if (s.startsWith("file://")) s = toPosix(fileURLToPath(s));
  if (sourceRoot && !/^[a-z]+:|^\//i.test(s)) s = posix.join(toPosix(sourceRoot), s);
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[a-z]:\//i.test(s)) return s; // webpack://, data:, http: stay as they are
  const abs = isAbsolute(s) || /^[a-z]:\//i.test(s) ? resolve(s) : resolve(mapDir, s);
  const rel = toPosix(relative(root, abs));
  if (!rel.startsWith("../") && rel !== ".." && !isAbsolute(rel)) return toPosix(relative(mapDir, abs)) || basename(abs);
  // Outside the checkout: another machine's package cache, or a temporary folder.
  const nm = toPosix(abs).lastIndexOf("/node_modules/");
  if (nm >= 0) return toPosix(abs).slice(nm + 1);
  return `<external>/${basename(abs)}`;
}

/** A map object rewritten deterministically (see the header). */
export function normalizeMap(map, { mapPath, root }) {
  const mapDir = dirname(resolve(mapPath));
  const sources = (map.sources ?? []).map((s) => normalizeSource(s, { mapDir, root: resolve(root), sourceRoot: map.sourceRoot ?? "" }));
  const contents = map.sourcesContent ?? null;
  const order = sources.map((_, i) => i).sort((a, b) => (sources[a] < sources[b] ? -1 : sources[a] > sources[b] ? 1 : a - b));
  const srcIndex = new Map(order.map((old, i) => [old, i]));
  const names = map.names ?? [];
  const nameOrder = names.map((_, i) => i).sort((a, b) => (names[a] < names[b] ? -1 : names[a] > names[b] ? 1 : a - b));
  const nameIndex = new Map(nameOrder.map((old, i) => [old, i]));
  const lines = decodeMappings(map.mappings ?? "").map((segs) =>
    segs.map((s) => (s.length === 1 ? s : s.length === 4 ? [s[0], srcIndex.get(s[1]), s[2], s[3]] : [s[0], srcIndex.get(s[1]), s[2], s[3], nameIndex.get(s[4])])),
  );
  const out = {
    version: 3,
    file: basename(mapPath).replace(/\.map$/, ""),
    sources: order.map((i) => sources[i]),
    ...(contents ? { sourcesContent: order.map((i) => contents[i] ?? null) } : {}),
    names: nameOrder.map((i) => names[i]),
    mappings: encodeMappings(lines),
  };
  if (Array.isArray(map.ignoreList)) out.ignoreList = map.ignoreList.map((i) => srcIndex.get(i)).filter((i) => i !== undefined).sort((a, b) => a - b);
  return out;
}

/** Normalise every `.map` under `dir` in place; returns the paths rewritten (relative to `dir`). */
export function normalizeMapsIn(dir, root = process.cwd()) {
  const changed = [];
  for (const p of filesUnder(dir).filter((f) => f.endsWith(".map"))) {
    const file = join(dir, ...p.split("/"));
    const before = readFileSync(file, "utf8");
    let map;
    try {
      map = JSON.parse(before);
    } catch {
      continue; // not JSON: left alone (and repro-check will show it if it differs)
    }
    const after = JSON.stringify(normalizeMap(map, { mapPath: file, root }));
    if (after !== before) {
      writeFileSync(file, after);
      changed.push(p);
    }
  }
  return changed;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
  const args = process.argv.slice(2);
  const ri = args.indexOf("--root");
  const root = ri >= 0 ? args[ri + 1] : process.cwd();
  const dir = args.find((a, i) => !a.startsWith("--") && i !== ri + 1) ?? "dist";
  const changed = normalizeMapsIn(resolve(dir), resolve(root));
  console.log(`normalize-maps: ${changed.length} map(s) rewritten under ${dir}${sep === "\\" ? " (Windows paths made posix)" : ""}`);
}
