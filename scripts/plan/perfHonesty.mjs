/**
 * Honest speed thresholds (plan R12.14): a time limit judges the code only
 * when the time was measured in isolation. Wall time on a loaded machine
 * measures the load: a test that is over its limit only there is flagged
 * ("load"), not red, until it is measured as CPU time or alone.
 *
 *   judgePerf({ wallMs, limitMs, cpuMs?, solo?, load1?, cpus? })
 *     → { verdict: "pass" | "fail" | "load", basis: "cpu" | "solo" | "wall-idle" | "wall-loaded", why }
 *
 * - CPU time (process.cpuUsage) is the measurement when there is one: over
 *   the limit there is a real fail.
 * - A run alone (`solo`, e.g. a perf job run by itself) counts its wall time.
 * - Otherwise wall time counts only on an idle machine (1-minute load per
 *   CPU under 0.7); a loaded machine's "fail" is "load".
 *
 * Clean reimplementation (design reference only: israelconnect's perf
 * honesty check, AGPL; no code taken).
 */
import { availableParallelism, loadavg } from "node:os";

export const IDLE_LOAD_PER_CPU = 0.7;

export function judgePerf({ wallMs, limitMs, cpuMs, solo = false, load1 = loadavg()[0], cpus = availableParallelism() }) {
  if (typeof cpuMs === "number") return cpuMs <= limitMs ? { verdict: "pass", basis: "cpu", why: `CPU ${cpuMs} ms ≤ ${limitMs} ms` } : { verdict: "fail", basis: "cpu", why: `CPU ${cpuMs} ms > ${limitMs} ms` };
  const perCpu = load1 / Math.max(1, cpus);
  const basis = solo ? "solo" : perCpu < IDLE_LOAD_PER_CPU ? "wall-idle" : "wall-loaded";
  if (wallMs <= limitMs) return { verdict: "pass", basis, why: `${wallMs} ms ≤ ${limitMs} ms` };
  if (basis === "wall-loaded") return { verdict: "load", basis, why: `${wallMs} ms > ${limitMs} ms with load ${load1.toFixed(1)} on ${cpus} CPUs: measure CPU time or run alone before calling it slow` };
  return { verdict: "fail", basis, why: `${wallMs} ms > ${limitMs} ms (${basis === "solo" ? "run alone" : "idle machine"})` };
}

/** Time `fn` with both clocks: { wallMs, cpuMs } (CPU = user + system of this process). */
export async function measure(fn) {
  const c0 = process.cpuUsage();
  const t0 = performance.now();
  await fn();
  const wallMs = performance.now() - t0;
  const c = process.cpuUsage(c0);
  return { wallMs, cpuMs: (c.user + c.system) / 1000 };
}
