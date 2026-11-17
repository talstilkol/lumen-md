/**
 * Workers and the privacy ledger (plan W13.P2). A worker's requests reach the
 * ledger only when it imports src/ai/workerLedgerInstall.ts first (2.4,
 * W10.D22). The suite used to find workers by file name (*.worker.ts), so a
 * worker named otherwise — the Argon2id one, argon2Worker.ts — was never
 * checked. Here a worker is found by what it is, not what it is called:
 *
 *   source  every file a `new Worker(new URL("…", import.meta.url))` or
 *           `new SharedWorker(…)` in src/ starts, plus every *.worker.ts;
 *           each must import the bridge before anything else;
 *   build   every JS file in dist/assets/ whose content is a worker (a
 *           message handler on the worker's global scope, or
 *           importScripts) and that makes a network call (fetch,
 *           WebSocket, EventSource, XMLHttpRequest, importScripts,
 *           sendBeacon) must carry the bridge (its channel name,
 *           "lumen-privacy-ledger", survives minification) — whatever the
 *           file is called.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { isProductionSource } from "./prGate.mjs";

export const BRIDGE_MODULE = "src/ai/workerLedgerInstall.ts";
export const BRIDGE_MARKER = "lumen-privacy-ledger";

function walk(root, dir, out = []) {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(root, rel, out);
    else out.push(rel);
  }
  return out;
}

const WORKER_CTOR = /new\s+(?:Shared)?Worker\(\s*new\s+URL\(\s*["'`]([^"'`]+)["'`]\s*,\s*import\.meta\.url/g;

/** Every worker entry in src/: [{ file, startedBy }] (file relative to root). */
export function workerSources(root) {
  const files = walk(root, "src").filter(isProductionSource);
  const out = new Map();
  for (const f of files) if (/\.worker\.[cm]?[jt]s$/.test(f)) out.set(f, "*.worker.ts");
  for (const f of files) {
    const text = readFileSync(join(root, f), "utf8");
    for (const m of text.matchAll(WORKER_CTOR)) {
      let target = normalize(join(dirname(f), m[1])).replace(/\\/g, "/");
      if (!/\.[cm]?[jt]sx?$/.test(target)) target += ".ts";
      if (existsSync(join(root, target)) && !out.has(target)) out.set(target, f);
    }
  }
  return [...out].map(([file, startedBy]) => ({ file, startedBy })).sort((a, b) => (a.file < b.file ? -1 : 1));
}

/** Worker sources whose first import is not the ledger bridge, or with code before it. */
export function workerSourceGaps(root) {
  const gaps = [];
  for (const { file, startedBy } of workerSources(root)) {
    const text = readFileSync(join(root, file), "utf8");
    const first = text.split("\n").find((l) => /^import\s/.test(l));
    let want = relative(dirname(file), BRIDGE_MODULE.replace(/\.ts$/, "")).replace(/\\/g, "/");
    if (!want.startsWith(".")) want = `./${want}`;
    if (first?.trim().split(";")[0] !== `import "${want}"`) gaps.push({ file, why: `worker (started by ${startedBy}) does not import the ledger bridge first: add import "${want}";` });
    const before = text.slice(0, first ? text.indexOf(first) : text.length).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    if (/\bimport\(|\bfetch\(/.test(before)) gaps.push({ file, why: "code runs before the ledger bridge" });
  }
  return gaps;
}

/** Is this built JS file a worker? By its content: a handler on the worker scope, or importScripts. */
export function isWorkerBundle(js) {
  return /\b(?:self|globalThis)\.(?:onmessage\s*=|addEventListener\(\s*["']message["'])|(?:^|[;\n{}])\s*onmessage\s*=|\bimportScripts\(/.test(js);
}

export const BUNDLE_NETWORK = /\bfetch\(|\bnew\s+WebSocket\(|\bnew\s+EventSource\(|\bXMLHttpRequest\b|\bimportScripts\(|\bsendBeacon\(/;

/** Built worker files that can reach the network without the bridge: [{ file, why }]. Null when there is no build. */
export function builtWorkerGaps(distDir) {
  const assets = join(distDir, "assets");
  if (!existsSync(assets)) return null;
  const gaps = [];
  let workers = 0;
  for (const name of readdirSync(assets).filter((n) => /\.[cm]?js$/.test(n)).sort()) {
    const js = readFileSync(join(assets, name), "utf8");
    if (!isWorkerBundle(js)) continue;
    workers++;
    if (BUNDLE_NETWORK.test(js) && !js.includes(BRIDGE_MARKER)) gaps.push({ file: `dist/assets/${name}`, why: `a worker that makes network calls (${js.match(BUNDLE_NETWORK)[0]}) without the ledger bridge` });
  }
  return { gaps, workers };
}
