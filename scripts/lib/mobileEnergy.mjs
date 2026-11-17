/**
 * W13.V4: the mobile energy report (docs/perf/mobile-energy.md) is present,
 * filled in for an iPhone and a Pixel in both modes, and within budget:
 * Lumen ≤ 1.5 × the phone's own notes app in the same script.
 */
export const ENERGY_RATIO = 1.5;
export const ENERGY_ROWS = [
  ["iPhone", "airplane"],
  ["iPhone", "sync on"],
  ["Pixel", "airplane"],
  ["Pixel", "sync on"],
];

/** Problems with the report's results table (empty = ready and within budget). */
export function energyProblems(markdown) {
  if (!markdown) return ["docs/perf/mobile-energy.md is missing"];
  const rows = markdown
    .split("\n")
    .filter((l) => /^\|\s*(iPhone|Pixel)\s*\|/.test(l))
    .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
  const problems = [];
  for (const [device, mode] of ENERGY_ROWS) {
    const r = rows.find((x) => x[0] === device && x[2] === mode);
    if (!r) {
      problems.push(`${device}, ${mode}: no row`);
      continue;
    }
    const [, os, , lumen, notes, , date, by] = r;
    const L = Number(lumen.replace(",", "."));
    const N = Number(notes.replace(",", "."));
    if (!os || !date || !by || !Number.isFinite(L) || !Number.isFinite(N) || !lumen || !notes) {
      problems.push(`${device}, ${mode}: not measured yet (OS, both values, the date and who measured)`);
      continue;
    }
    if (N <= 0) problems.push(`${device}, ${mode}: the notes app's value must be above 0`);
    else if (L > N * ENERGY_RATIO) problems.push(`${device}, ${mode}: Lumen ${L} mAh > ${ENERGY_RATIO} × notes ${N} mAh`);
  }
  return problems;
}
