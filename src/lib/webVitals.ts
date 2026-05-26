/**
 * Web Vitals reporter — in-house implementation using the PerformanceObserver
 * API directly so we don't pull in the `web-vitals` npm package (~3 KB
 * gzipped, but every byte counts for a markdown editor's main bundle).
 *
 * Reports three Core Web Vitals:
 *   - **LCP** (Largest Contentful Paint) — when the largest above-the-fold
 *     element renders. Good: < 2.5s.
 *   - **CLS** (Cumulative Layout Shift) — sum of unexpected layout shifts.
 *     Good: < 0.1.
 *   - **INP** (Interaction to Next Paint) — slowest interaction during the
 *     session. Good: < 200ms. Approximated here via PerformanceEventTiming.
 *
 * Honors the same opt-out as `telemetry.ts`: if the user set
 * `lumen.telemetry.optOut = "1"`, no observers are installed.
 *
 * The reporter is a no-op in browsers without PerformanceObserver. It
 * does NOT send anywhere by default — the consumer wires a sink via
 * `reportWebVitals(sink)`. The Sentry/telemetry layer can adopt it.
 */

export interface VitalsSample {
  /** Metric name. */
  name: "LCP" | "CLS" | "INP";
  /** Metric value (ms for LCP/INP, unitless score for CLS). */
  value: number;
  /** Rating against Web Vitals thresholds. */
  rating: "good" | "needs-improvement" | "poor";
  /** Page URL at the time of measurement. */
  url: string;
}

const OPT_OUT_KEY = "lumen.telemetry.optOut";

function isOptedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

function rate(name: VitalsSample["name"], v: number): VitalsSample["rating"] {
  if (name === "LCP") {
    if (v <= 2500) return "good";
    if (v <= 4000) return "needs-improvement";
    return "poor";
  }
  if (name === "CLS") {
    if (v <= 0.1) return "good";
    if (v <= 0.25) return "needs-improvement";
    return "poor";
  }
  // INP
  if (v <= 200) return "good";
  if (v <= 500) return "needs-improvement";
  return "poor";
}

let installed = false;
const observers: PerformanceObserver[] = [];

/**
 * Install Web Vitals observers. Idempotent. Safe to call from main.tsx.
 *
 * @param sink invoked once per metric event. Caller decides where to send.
 */
export function reportWebVitals(sink: (sample: VitalsSample) => void): void {
  if (installed) return;
  if (typeof window === "undefined") return;
  if (typeof PerformanceObserver === "undefined") return;
  if (isOptedOut()) return;
  installed = true;

  const url = () => window.location.href;

  // LCP — the largest contentful paint entry. Multiple entries may fire
  // as bigger elements render; the latest is the canonical value.
  try {
    const lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1] as
        | PerformanceEntry & { renderTime: number; loadTime: number }
        | undefined;
      if (!last) return;
      const value = last.renderTime || last.loadTime || 0;
      sink({ name: "LCP", value, rating: rate("LCP", value), url: url() });
    });
    lcpObserver.observe({
      type: "largest-contentful-paint",
      buffered: true,
    } as PerformanceObserverInit);
    observers.push(lcpObserver);
  } catch {
    /* not supported (older browser) */
  }

  // CLS — accumulate non-input-triggered layout shifts.
  try {
    let clsValue = 0;
    const clsObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
        };
        if (!e.hadRecentInput) clsValue += e.value;
      }
      sink({
        name: "CLS",
        value: clsValue,
        rating: rate("CLS", clsValue),
        url: url(),
      });
    });
    clsObserver.observe({
      type: "layout-shift",
      buffered: true,
    } as PerformanceObserverInit);
    observers.push(clsObserver);
  } catch {
    /* not supported */
  }

  // INP — slowest event-timing entry seen this session.
  try {
    let worstINP = 0;
    const inpObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEventTiming;
        if (e.duration > worstINP) {
          worstINP = e.duration;
          sink({
            name: "INP",
            value: worstINP,
            rating: rate("INP", worstINP),
            url: url(),
          });
        }
      }
    });
    inpObserver.observe({
      type: "event",
      buffered: true,
      durationThreshold: 16,
    } as PerformanceObserverInit);
    observers.push(inpObserver);
  } catch {
    /* not supported */
  }
}

/**
 * Tear down all observers. Used by tests; production never needs this.
 */
export function disposeWebVitals(): void {
  for (const o of observers) {
    try {
      o.disconnect();
    } catch {
      /* ignore */
    }
  }
  observers.length = 0;
  installed = false;
}
