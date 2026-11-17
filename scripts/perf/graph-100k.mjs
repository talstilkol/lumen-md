#!/usr/bin/env node
/**
 * W13.G13 — the graph's performance day: 100,000 nodes and 500,000 links in
 * Chromium, Firefox and WebKit (Safari's engine), with the app's own layout
 * and renderer (./graph-bench.page.ts), measured on the machine it runs on
 * — the owner's MacBook Air (integrated GPU) is the reference.
 *
 *   npm run perf:vault100k -- --graph                       # 100k / 500k, all three engines
 *   npm run perf:vault100k -- --graph --nodes 20000 --edges 100000 --engines chromium
 *   npm run perf:vault100k -- --graph --report reports/perf/graph-100k.json
 *   npm run perf:vault100k -- --graph --strict              # exit 1 when a target is missed
 *
 * Per engine: layout time (the layout worker's code, on the page's main
 * thread so it is timed alone), the first still frame with every link, fps
 * and the 95th-percentile frame while zooming and while panning (frames in
 * motion draw a sample of the links, as the graph view does), JS heap
 * (Chromium), the GPU the browser reports, and the network requests while
 * the graph runs with the context offline (airplane mode): 0.
 *
 * Targets (W13.G13): ≥ 30 fps and layout ≤ 10 s in Chromium; a miss is
 * printed as an open finding (and is an error with --strict). The offline
 * map (PMTiles, W13.G3) is measured when its module exists in this tree;
 * until then the report says it is pending.
 *
 * PW_CHROMIUM / PW_FIREFOX / PW_WEBKIT point at browser binaries where
 * Playwright's own are not installed.
 */
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir, cpus, platform, release, arch, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const TARGETS = Object.freeze({ chromiumFps: 30, chromiumLayoutMs: 10_000, offlineRequests: 0 });

/** Targets missed, as one line each (an open finding, not a crash). */
export function findingsOf(results, targets = TARGETS) {
  const out = [];
  const c = results.chromium;
  if (!c || c.error) out.push(`chromium: no measurement (${c?.error ?? "not run"})`);
  else {
    if (c.fps < targets.chromiumFps) out.push(`chromium: ${c.fps} fps < ${targets.chromiumFps}`);
    if (c.layoutMs > targets.chromiumLayoutMs) out.push(`chromium: layout ${c.layoutMs} ms > ${targets.chromiumLayoutMs}`);
  }
  for (const [engine, r] of Object.entries(results)) if (r && !r.error && r.offlineRequests > targets.offlineRequests) out.push(`${engine}: ${r.offlineRequests} requests offline`);
  return out;
}

export function parseArgs(argv) {
  const opt = (k, d) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : d;
  };
  return {
    nodes: Number(opt("nodes", "100000")),
    edges: Number(opt("edges", "500000")),
    seconds: Number(opt("seconds", "6")),
    iterations: opt("iterations", null) === null ? undefined : Number(opt("iterations", null)),
    engines: opt("engines", "chromium,firefox,webkit").split(","),
    report: opt("report", null),
    strict: argv.includes("--strict"),
  };
}

async function bundle(dir) {
  let esbuild;
  try {
    esbuild = await import("esbuild");
  } catch {
    esbuild = await import("/opt/npm-tools/node_modules/esbuild/lib/main.js");
  }
  await esbuild.build({ entryPoints: [join(ROOT, "scripts/perf/graph-bench.page.ts")], bundle: true, format: "esm", outfile: join(dir, "page.js"), logLevel: "error" });
  writeFileSync(join(dir, "index.html"), '<!doctype html><meta charset="utf-8"><body style="margin:0"><script type="module" src="./page.js"></script>');
}

function serve(dir) {
  const types = { ".js": "text/javascript", ".html": "text/html" };
  const server = createServer((req, res) => {
    const file = join(dir, (req.url ?? "/").split("?")[0] === "/" ? "index.html" : (req.url ?? "").split("?")[0].slice(1));
    try {
      const body = readFileSync(file);
      res.writeHead(200, { "content-type": types[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

/** The offline map's measurement, once W13.G3 has put its module in the tree. */
function mapStatus() {
  const candidates = ["src/geo/pmtiles.ts", "src/maps/pmtiles.ts", "src/graph/map/pmtiles.ts"];
  const found = candidates.find((p) => existsSync(join(ROOT, p)));
  return found ? { module: found, status: "present: measure it with its own harness (W13.G3)" } : { status: "pending: the offline PMTiles map (W13.G3) is not in this tree yet" };
}

export async function main(argv = process.argv.slice(2)) {
  const a = parseArgs(argv);
  const dir = mkdtempSync(join(tmpdir(), "graph-100k-"));
  await bundle(dir);
  const server = await serve(dir);
  const url = `http://127.0.0.1:${server.address().port}/`;
  let pw;
  try {
    pw = await import("playwright");
  } catch {
    pw = await import("/opt/npm-tools/node_modules/playwright/index.mjs");
  }
  const results = {};
  for (const engine of a.engines) {
    const exe = process.env[`PW_${engine.toUpperCase()}`];
    let browser;
    try {
      browser = await pw[engine].launch({ ...(exe ? { executablePath: exe } : {}), ...(engine === "chromium" ? { args: ["--enable-precise-memory-info", "--disable-gpu-vsync", "--disable-frame-rate-limit"] } : {}) });
    } catch (e) {
      results[engine] = { error: `could not start ${engine}: ${String(e.message).split("\n")[0]}` };
      continue;
    }
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForFunction(() => typeof window.graphBench === "function");
    // Airplane mode from here on: the graph must not touch the network.
    let requests = 0;
    page.on("request", () => requests++);
    await context.setOffline(true);
    try {
      results[engine] = await page.evaluate((x) => window.graphBench(x), { nodes: a.nodes, edges: a.edges, seconds: a.seconds, iterations: a.iterations });
      results[engine].offlineRequests = requests;
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
    task: "W13.G13",
    graph: { nodes: a.nodes, edges: a.edges, seconds: a.seconds },
    machine: { platform: platform(), release: release(), arch: arch(), cpu: c[0]?.model, cores: c.length, memGB: Math.round(totalmem() / 2 ** 30) },
    targets: TARGETS,
    results,
    map: mapStatus(),
    findings: findingsOf(results),
  };
  console.log(JSON.stringify(report, null, 2));
  if (a.report) {
    mkdirSync(dirname(resolve(a.report)), { recursive: true });
    writeFileSync(resolve(a.report), `${JSON.stringify(report, null, 2)}\n`);
  }
  if (report.findings.length) console.error(`graph-100k: open findings — ${report.findings.join("; ")}`);
  return a.strict && report.findings.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
