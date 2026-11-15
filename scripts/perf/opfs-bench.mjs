#!/usr/bin/env node
/**
 * W11.Q11 (research R5.12): OPFS through the vault-io worker (sync access
 * handles, atomic saves: W11.Q10) against a plain IndexedDB key-value store,
 * 10,000 files with a median of 2 KB, in Chromium, Firefox and WebKit.
 *
 *   node scripts/perf/opfs-bench.mjs                       # all three engines, 10,000 files
 *   node scripts/perf/opfs-bench.mjs --engines chromium --files 2000
 *   node scripts/perf/opfs-bench.mjs --selftest            # the real worker's atomic save, end to end
 *   node scripts/perf/opfs-bench.mjs --report reports/perf/opfs-bench.json
 *
 * Per engine: write all (the worker for OPFS; one transaction per file for
 * IndexedDB, as one save each), read every file one by one (as opening each
 * note), OPFS read both ways: `opfsRead` on the main thread one file at a
 * time, and `opfsReadWorker` through the vault-io worker in batches
 * (READ_BATCH per message, the app's path since the #856 follow-up),
 * IndexedDB getAll, and the main thread's long tasks (over 50 ms)
 * while importing (Chromium only: the others have no longtask entries).
 * Targets (W11.Q11, measured on the Mac in W11.M8): reading 10,000 files
 * ≤ 1.5 s in Chromium, and 0 long tasks over 50 ms during the import.
 *
 * Lumen has no IndexedDB vault backend; the IndexedDB side here is the
 * plainest one (an object store of path → text), the baseline R5.12 names.
 * The text is this repo's own docs, cut to the file sizes; the sizes follow
 * a log-normal around 2 KB, from a fixed seed.
 *
 * PW_CHROMIUM / PW_FIREFOX / PW_WEBKIT point at browser binaries where
 * Playwright's own are not installed.
 */
import { createServer } from "node:http";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir, cpus, platform, release, arch, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const TARGETS = Object.freeze({ chromiumReadMs: 1500, longTasks: 0 });

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

/** Real text to cut the files from: the repo's docs, concatenated. */
function textPool() {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.mdx?$/.test(e)) out.push(readFileSync(p, "utf8"));
    }
  };
  walk(join(ROOT, "docs", "src", "content", "docs"));
  return out.join("\n\n");
}

export function makeFiles(n, pool = textPool()) {
  let at = 0;
  return sizes(n).map((size, i) => {
    if (at + size > pool.length) at = 0;
    const text = pool.slice(at, at + size);
    at += size;
    return { path: `f${i % 100}/note-${i}.md`, text };
  });
}

async function bundle(dir) {
  const esbuild = await import("esbuild");
  await esbuild.build({ entryPoints: [join(ROOT, "src/storage/vault/vault-io.worker.ts")], bundle: true, format: "esm", outfile: join(dir, "vault-io.worker.js"), logLevel: "error" });
  await esbuild.build({ entryPoints: [join(ROOT, "scripts/perf/opfs-bench.page.ts")], bundle: true, format: "esm", outfile: join(dir, "page.js"), logLevel: "error" });
  writeFileSync(join(dir, "index.html"), '<!doctype html><meta charset="utf-8"><script type="module" src="./page.js"></script>');
}

function serve(dir) {
  const types = { ".js": "text/javascript", ".html": "text/html" };
  const server = createServer((req, res) => {
    const file = join(dir, (req.url ?? "/").split("?")[0] === "/" ? "index.html" : (req.url ?? "").split("?")[0].slice(1));
    try {
      const body = readFileSync(file);
      res.writeHead(200, { "content-type": types[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream", "cross-origin-opener-policy": "same-origin" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (k, d) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : d;
  };
  const engines = opt("engines", "chromium,firefox,webkit").split(",");
  const n = Number(opt("files", "10000"));
  const dir = mkdtempSync(join(tmpdir(), "opfs-bench-"));
  await bundle(dir);
  const server = await serve(dir);
  const url = `http://127.0.0.1:${server.address().port}/`;
  const pw = await import("playwright");
  const files = argv.includes("--selftest") ? [] : makeFiles(n);
  const results = {};
  for (const engine of engines) {
    const exe = process.env[`PW_${engine.toUpperCase()}`];
    let browser;
    try {
      browser = await pw[engine].launch(exe ? { executablePath: exe } : {});
    } catch (e) {
      results[engine] = { error: `could not start ${engine}: ${String(e.message).split("\n")[0]}` };
      continue;
    }
    const page = await browser.newPage();
    await page.goto(url);
    await page.waitForFunction(() => typeof window.opfsBench === "function");
    try {
      results[engine] = argv.includes("--selftest") ? await page.evaluate(() => window.opfsSelftest()) : await page.evaluate((a) => window.opfsBench(a), { files, concurrency: 8 });
      results[engine].version = browser.version();
    } catch (e) {
      results[engine] = { error: String(e.message).split("\n")[0] };
    }
    await browser.close();
  }
  server.close();
  const c = cpus();
  const report = {
    date: new Date().toISOString(),
    files: files.length,
    medianBytes: files.length ? median(files.map((f) => f.text.length)) : null,
    machine: { platform: platform(), release: release(), arch: arch(), cpu: c[0]?.model, cores: c.length, memGB: Math.round(totalmem() / 2 ** 30) },
    targets: TARGETS,
    results,
  };
  console.log(JSON.stringify(report, null, 2));
  const out = opt("report", null);
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(resolve(out), `${JSON.stringify(report, null, 2)}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => {
  console.error(e);
  process.exit(1);
});
