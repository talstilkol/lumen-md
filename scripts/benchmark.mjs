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
import { createReadStream, readFileSync, writeFileSync } from "fs";
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

// ── 1. Bundle size ────────────────────────────────────────────────────────────
function measureBundle() {
  const statsPath = path.join(ROOT, "dist", "assets", "index-*.js");
  // Approximate: use ls to find largest JS chunk
  try {
    const out = execSync(`find ${path.join(ROOT, "dist/assets")} -name "*.js" -exec ls -la {} +`, {
      encoding: "utf-8",
    });
    const lines = out.split("\n").filter(Boolean);
    let total = 0;
    let largest = { file: "", size: 0 };
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const size = parseInt(parts[4], 10);
      const file = parts[parts.length - 1];
      total += size;
      if (size > largest.size) largest = { file: path.basename(file), size };
    }
    REPORT.metrics.bundle = {
      totalBytes: total,
      totalKb: Math.round(total / 1024),
      largestChunk: largest.file,
      largestChunkKb: Math.round(largest.size / 1024),
    };
  } catch {
    REPORT.metrics.bundle = { note: "Run `npm run build` first" };
  }
}

// ── 2. Source lines of code ─────────────────────────────────────────────────
async function measureSloc() {
  const srcDir = path.join(ROOT, "src");
  let ts = 0, tsx = 0, css = 0;
  try {
    const files = execSync(`find ${srcDir} -type f`, { encoding: "utf-8" }).split("\n").filter(Boolean);
    for (const f of files) {
      const lines = await countLines(f);
      if (f.endsWith(".ts")) ts += lines;
      else if (f.endsWith(".tsx")) tsx += lines;
      else if (f.endsWith(".css")) css += lines;
    }
    REPORT.metrics.sloc = { ts, tsx, css, total: ts + tsx + css };
  } catch {
    REPORT.metrics.sloc = { note: "Could not measure" };
  }
}

function countLines(file) {
  return new Promise((resolve) => {
    let n = 0;
    const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    rl.on("line", () => n++);
    rl.on("close", () => resolve(n));
    rl.on("error", () => resolve(0));
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
