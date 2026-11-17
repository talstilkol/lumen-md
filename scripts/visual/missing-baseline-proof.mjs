#!/usr/bin/env node
/**
 * Plan W10.B16 — proof that a visual run without a baseline fails and
 * writes nothing, using the repo's own rule (scripts/lib/visualGate.mjs),
 * not a copy of it.
 *
 *   node scripts/visual/missing-baseline-proof.mjs [--json out.json]
 *
 * A throwaway Playwright project in a temp folder: one test that screenshots
 * a static page and compares it with a baseline that does not exist. It runs
 * twice, as a local run and as a gate run (LUMEN_GATE=1). Both must fail and
 * neither may leave a baseline behind. It also checks that no Playwright
 * config or e2e spec in the repo turns baseline writing on for itself
 * (only scripts/visual-approve.mjs may, through LUMEN_VISUAL_APPROVE).
 *
 * Prints one JSON line ({ ok, runs, selfApproving }) and exits 0 only when ok.
 * Needs Playwright's Chromium; no app, no dev server.
 */
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const jsonOut = argv.includes("--json") ? argv[argv.indexOf("--json") + 1] : null;

/** Files under `dir` (recursive), relative names. */
function walk(dir, out = [], base = dir) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out, base);
    else out.push(p.slice(base.length + 1));
  }
  return out;
}

/** Configs and specs that would let a run write its own baselines. */
export function selfApproving(root = ROOT) {
  const files = [
    ...readdirSync(root).filter((f) => /^playwright.*\.config\.[cm]?[jt]s$/.test(f)),
    ...walk(join(root, "e2e")).filter((f) => /\.spec\.[cm]?[jt]s$/.test(f)).map((f) => join("e2e", f)),
    ...walk(join(root, "visual")).filter((f) => /\.(spec|config)\.[cm]?[jt]s$/.test(f)).map((f) => join("visual", f)),
  ];
  const bad = [];
  for (const f of files) {
    const text = readFileSync(join(root, f), "utf8");
    if (/updateSnapshots\s*:\s*["'](all|changed|missing)["']/.test(text) || /--update-snapshots|\bupdateSnapshots\s*=\s*["']/.test(text)) bad.push(f);
  }
  return bad;
}

function run(env) {
  const dir = mkdtempSync(join(tmpdir(), "lumen-visual-proof-"));
  try {
    const nm = join(ROOT, "node_modules");
    if (existsSync(nm)) symlinkSync(nm, join(dir, "node_modules"), "dir");
    writeFileSync(
      join(dir, "pw.config.mjs"),
      `import { defineConfig } from "@playwright/test";
import { snapshotUpdateMode } from ${JSON.stringify(pathToFileURL(join(ROOT, "scripts/lib/visualGate.mjs")).href)};
export default defineConfig({ testDir: "./t", updateSnapshots: snapshotUpdateMode(process.env), reporter: [["json", { outputFile: "out.json" }]], projects: [{ name: "chromium", use: { browserName: "chromium" } }] });
`,
    );
    mkdirSync(join(dir, "t"));
    writeFileSync(
      join(dir, "t", "v.spec.mjs"),
      `import { test, expect } from "@playwright/test";
test("no baseline", async ({ page }) => { await page.setContent("<p>visual proof</p>"); await expect(page).toHaveScreenshot("proof.png"); });
`,
    );
    const r = spawnSync("npx", ["playwright", "test", "-c", "pw.config.mjs"], { cwd: dir, env: { ...process.env, ...env, LUMEN_VISUAL_APPROVE: "" }, encoding: "utf8", timeout: 180_000 });
    let stats = null;
    try {
      stats = JSON.parse(readFileSync(join(dir, "out.json"), "utf8")).stats;
    } catch {
      /* why: no report means Playwright did not run; reported as such below */
    }
    const baselines = walk(join(dir, "t")).filter((f) => f.endsWith(".png"));
    const missingMsg = /snapshot doesn't exist|A snapshot doesn't exist/i.test(`${r.stdout}${r.stderr}`);
    return { env: Object.keys(env).join(",") || "local", exit: r.status, unexpected: stats?.unexpected ?? null, missingBaselineError: missingMsg, wroteBaseline: baselines.length > 0, ok: r.status !== 0 && stats?.unexpected === 1 && missingMsg && baselines.length === 0 };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const runs = [run({}), run({ LUMEN_GATE: "1" })];
  const bad = selfApproving();
  const result = { id: "W10.B16", ok: runs.every((r) => r.ok) && bad.length === 0, runs, selfApproving: bad };
  const line = JSON.stringify(result);
  if (jsonOut) writeFileSync(jsonOut, `${line}\n`);
  console.log(line);
  process.exit(result.ok ? 0 : 1);
}
