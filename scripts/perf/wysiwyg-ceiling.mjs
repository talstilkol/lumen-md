#!/usr/bin/env node
/**
 * W11.Q4: set the WYSIWYG ceiling from a measurement instead of research
 * alone ("300 KB or 5,000 blocks (calibrate by measurement)").
 *
 * e2e/wysiwyg-ceiling-calibrate.spec.ts (`npm run perf:wysiwyg-ceiling`, in
 * Chromium with the CPU 4× slower, as the INP budget) opens notes of growing
 * size in WYSIWYG (past the ceiling with "open anyway"). For each size it
 * measures:
 * - the time from the open event to the first ProseMirror paint;
 * - keypress → paint p95 over 60 keystrokes at the end.
 * It writes reports/perf/wysiwyg-ceiling.json. This script reads that file
 * and says which ceiling the numbers support:
 *
 *   node scripts/perf/wysiwyg-ceiling.mjs [--report <file>] [--check]
 *
 * A size is fit for WYSIWYG when typing stays under the INP budget's
 * keypress → paint p95 (33 ms, the 2 MB budget of e2e/inp-budget.spec.ts)
 * and opening takes under 1.5 s. The supported ceiling is the largest
 * measured size below the first unfit size; the block ceiling scales with it
 * at the measured notes' bytes per block.
 *
 * --check exits 1 when the ceiling in src/editor/wysiwygCeiling.ts is above
 * what the measurement supports (too loose: large notes would freeze). A
 * ceiling far below it is reported but not failed: moving it up is a
 * product decision. Without the report it says what is owed, and --check
 * exits 1 (review 11, L13: a check with nothing to check is not green).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const KEY_TO_PAINT_P95_MS = 33;
export const OPEN_MS = 1500;
export const REPORT = "reports/perf/wysiwyg-ceiling.json";

/**
 * @param {{ cpuSlowdown: number, points: Array<{ bytes: number, blocks: number, openMs: number, keyToPaintP95: number }> }} report
 * @returns {{ bytes: number | null, blocks: number | null, firstUnfit: { bytes: number, why: string } | null, fit: number[] }}
 */
export function supportedCeiling(report, limits = { keyToPaintP95: KEY_TO_PAINT_P95_MS, openMs: OPEN_MS }) {
  if (!report || !Array.isArray(report.points) || !report.points.length) throw new Error("wysiwyg-ceiling: the report has no points");
  for (const p of report.points) {
    for (const k of ["bytes", "blocks", "openMs", "keyToPaintP95"]) if (!(typeof p[k] === "number" && p[k] >= 0 && Number.isFinite(p[k]))) throw new Error(`wysiwyg-ceiling: point ${JSON.stringify(p)} has no valid ${k}`);
  }
  const pts = [...report.points].sort((a, b) => a.bytes - b.bytes);
  const fit = [];
  let firstUnfit = null;
  for (const p of pts) {
    const why = p.keyToPaintP95 >= limits.keyToPaintP95 ? `keypress → paint p95 ${p.keyToPaintP95} ms ≥ ${limits.keyToPaintP95}` : p.openMs >= limits.openMs ? `open ${p.openMs} ms ≥ ${limits.openMs}` : null;
    if (why) {
      firstUnfit = { bytes: p.bytes, why };
      break;
    }
    fit.push(p.bytes);
  }
  if (!fit.length) return { bytes: null, blocks: null, firstUnfit, fit };
  const last = pts.find((p) => p.bytes === fit[fit.length - 1]);
  // Blocks scale with the bytes at the measured notes' density (bytes per block).
  return { bytes: last.bytes, blocks: last.blocks, firstUnfit, fit };
}

function currentCeiling() {
  const src = readFileSync(join(ROOT, "src/editor/wysiwygCeiling.ts"), "utf8");
  const num = (name) => {
    const m = new RegExp(`export const ${name} = ([\\d_ *]+);`).exec(src);
    if (!m) throw new Error(`wysiwyg-ceiling: ${name} not found in src/editor/wysiwygCeiling.ts`);
    return m[1].replace(/_/g, "").split("*").reduce((a, b) => a * Number(b.trim()), 1);
  };
  return { bytes: num("WYSIWYG_MAX_BYTES"), blocks: num("WYSIWYG_MAX_BLOCKS") };
}

function main(argv) {
  const at = argv.indexOf("--report");
  const file = resolve(ROOT, at >= 0 ? argv[at + 1] : REPORT);
  const cur = currentCeiling();
  if (!existsSync(file)) {
    console.log(`wysiwyg-ceiling: no ${file}. The calibration is owed: npm run perf:wysiwyg-ceiling (Chromium with Milkdown installed). Current ceiling: ${cur.bytes} B / ${cur.blocks} blocks (research R5.6).`);
    if (argv.includes("--check")) {
      console.error("✖ --check without a report: nothing was measured, so the ceiling is not checked");
      return 1;
    }
    return 0;
  }
  const report = JSON.parse(readFileSync(file, "utf8"));
  const s = supportedCeiling(report);
  console.log(`wysiwyg-ceiling: measured at CPU ${report.cpuSlowdown}× slower, ${report.points.length} sizes`);
  for (const p of [...report.points].sort((a, b) => a.bytes - b.bytes)) console.log(`  ${Math.round(p.bytes / 1024)} KB, ${p.blocks} blocks: open ${p.openMs} ms, keypress → paint p95 ${p.keyToPaintP95} ms${s.fit.includes(p.bytes) ? "" : "  ← unfit"}`);
  console.log(s.bytes === null ? "  no measured size is fit for WYSIWYG" : `  supported ceiling: ${s.bytes} B / ${s.blocks} blocks${s.firstUnfit ? ` (first unfit: ${s.firstUnfit.bytes} B, ${s.firstUnfit.why})` : " (every measured size was fit)"}`);
  console.log(`  current ceiling: ${cur.bytes} B / ${cur.blocks} blocks`);
  if (!argv.includes("--check")) return 0;
  const tooLoose = s.bytes === null || cur.bytes > s.bytes || cur.blocks > s.blocks;
  if (tooLoose) {
    console.error(`✖ the ceiling is above what the measurement supports: lower WYSIWYG_MAX_BYTES/BLOCKS to ≤ ${s.bytes ?? 0} B / ${s.blocks ?? 0} blocks`);
    return 1;
  }
  if (s.firstUnfit === null || cur.bytes * 2 < s.bytes) console.log("  note: the ceiling is well below what the measurement supports; raising it is a product decision");
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
