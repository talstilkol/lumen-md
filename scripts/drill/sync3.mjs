/**
 * The three-device sync drill (plan W13.S7), for `npm run drill:data-safety -- --report <file>`.
 *
 *   --report <file>               run the simulated drill (src/__tests__/sync3Devices.test.ts: the
 *                                 real engine, three devices, 1,000 edits) and write its counters there
 *   --report <file> --real <json> check the counters the owner filled in on the real devices
 *                                 (scripts/drill/sync-3-devices.md) and write them as the report
 *   --runner <cmd>                how to run one vitest file (default: npx vitest run)
 *
 * Exit 0 only when no edit was lost and the three vault hashes are the same.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** The verdict on a report: problems, or [] when it passes. */
export function judge(r) {
  const problems = [];
  if (!r || !Array.isArray(r.devices) || r.devices.length !== 3) problems.push("needs exactly three devices");
  if (!(Number(r?.edits) >= 1000)) problems.push(`needs at least 1,000 edits (got ${r?.edits})`);
  if (r?.lost !== 0) problems.push(`edits lost: ${r?.lost}`);
  const hashes = Object.values(r?.hashes ?? {});
  if (hashes.length !== 3 || new Set(hashes).size !== 1 || !hashes.every((h) => /^[0-9a-f]{64}$/.test(String(h)))) problems.push("the three vault hashes differ or are missing");
  for (const d of r?.devices ?? []) if (!["merge", "file"].includes(d.conflictMode)) problems.push(`${d.name}: conflictMode must be merge or file`);
  return problems;
}

export function syncThreeDevices(repo, reportPath, { real = null, runner = null } = {}) {
  let report;
  if (real) {
    report = { ...JSON.parse(readFileSync(real, "utf8")), simulated: false };
  } else {
    const env = { ...process.env, DRILL_REPORT: reportPath };
    const cmd = runner ? `${runner} src/__tests__/sync3Devices.test.ts` : "npx vitest run src/__tests__/sync3Devices.test.ts";
    const run = spawnSync(cmd, { cwd: repo, env, shell: true, stdio: "inherit" });
    if (run.status !== 0 || !existsSync(reportPath)) {
      console.error("sync-3-devices: the simulated drill failed");
      return 1;
    }
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  }
  const problems = judge(report);
  report.verdict = problems.length ? { ok: false, problems } : { ok: true };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`sync-3-devices (${report.simulated ? "simulated" : "real devices"}): ${report.edits} edits, ${report.lost} lost, same hash: ${!problems.some((p) => p.includes("hash"))} → ${problems.length ? "FAIL: " + problems.join("; ") : "ok"}`);
  return problems.length ? 1 : 0;
}
