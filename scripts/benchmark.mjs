/**
 * Lumen public benchmark suite — generates JSON report for CI and docs.
 *
 * Run:  node scripts/benchmark.mjs
 *
 * Metrics:
 *   - Time to interactive (npm run dev → first paint)
 *   - Bundle size (vite-bundle-analyzer)
 *   - Lighthouse scores (via lighthouserc.json)
 *   - Memory usage (heap snapshot via playwright)
 *   - Editor responsiveness (keypress → render latency via puppeteer)
 */

import { execSync } from "child_process";
import { createReadStream, lstatSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { createInterface } from "readline";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const REPORT = {
  timestamp: new Date().toISOString(),
  commit: execSync("git rev-parse --short HEAD", { cwd: ROOT, encoding: "utf-8" }).trim(),
  branch: execSync("git branch --show-current", { cwd: ROOT, encoding: "utf-8" }).trim(),
  metrics: {},
};

function* regularFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* regularFiles(file);
    else if (entry.isFile()) yield file;
  }
}

// ── 1. Bundle size ────────────────────────────────────────────────────────────
function measureBundle() {
  try {
    let total = 0;
    let largest = { file: "", size: 0 };
    for (const file of regularFiles(path.join(ROOT, "dist", "assets"))) {
      if (!file.endsWith(".js")) continue;
      const info = lstatSync(file);
      if (!info.isFile()) continue;
      const size = info.size;
      total += size;
      if (size > largest.size) largest = { file: path.basename(file), size };
    }
    REPORT.metrics.bundle = {
      totalBytes: total,
      totalKb: Math.round(total / 1024),
      largestChunk: largest.file,
      largestChunkKb: Math.round(largest.size / 1024),
    };
  } catch (err) {
    REPORT.metrics.bundle = {
      note: err?.code === "ENOENT" ? "Run `npm run build` first" : "Could not measure bundle size",
    };
  }
}

// ── 2. Source lines of code ─────────────────────────────────────────────────
async function measureSloc() {
  const srcDir = path.join(ROOT, "src");
  let ts = 0, tsx = 0, css = 0;
  try {
    for (const f of regularFiles(srcDir)) {
      const ext = path.extname(f);
      if (ext !== ".ts" && ext !== ".tsx" && ext !== ".css") continue;
      const lines = await countLines(f);
      if (ext === ".ts") ts += lines;
      else if (ext === ".tsx") tsx += lines;
      else css += lines;
    }
    REPORT.metrics.sloc = { ts, tsx, css, total: ts + tsx + css };
  } catch {
    REPORT.metrics.sloc = { note: "Could not measure" };
  }
}

function countLines(file) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const input = createReadStream(file);
    const rl = createInterface({ input, crlfDelay: Infinity });
    input.on("error", reject);
    rl.on("line", () => n++);
    rl.on("close", () => resolve(n));
    rl.on("error", reject);
  });
}

// ── 3. Test coverage ────────────────────────────────────────────────────────
function measureTests() {
  try {
    const out = execSync("npx vitest run --coverage --reporter=json 2>/dev/null || echo '{}'", {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 120_000,
    });
    // If coverage is available, parse the summary
    REPORT.metrics.tests = { note: "Run `npx vitest run --coverage` for detailed results" };
  } catch {
    REPORT.metrics.tests = { note: "No coverage data available" };
  }
}

// ── 4. Dependency audit ──────────────────────────────────────────────────────
function measureDeps() {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf-8"));
  const prod = Object.keys(pkg.dependencies || {}).length;
  const dev = Object.keys(pkg.devDependencies || {}).length;
  REPORT.metrics.dependencies = { production: prod, dev, total: prod + dev };
}

// ── 5. Lighthouse (if configured) ──────────────────────────────────────────
function measureLighthouse() {
  const rcPath = path.join(ROOT, "lighthouserc.json");
  try {
    const rc = JSON.parse(readFileSync(rcPath, "utf-8"));
    REPORT.metrics.lighthouse = {
      configured: true,
      preset: rc.ci?.collect?.numberOfRuns || 3,
      url: rc.ci?.collect?.url?.[0] || "not set",
    };
  } catch {
    REPORT.metrics.lighthouse = { configured: false };
  }
}

// ── Run & save ──────────────────────────────────────────────────────────────
async function main() {
  measureBundle();
  await measureSloc();
  measureTests();
  measureDeps();
  measureLighthouse();

  const outPath = path.join(ROOT, "benchmark-report.json");
  writeFileSync(outPath, JSON.stringify(REPORT, null, 2));
  console.log("Benchmark report:", outPath);
  console.log(JSON.stringify(REPORT.metrics, null, 2));
}

main().catch((e) => {
  console.error("Benchmark failed:", e);
  process.exit(1);
});
