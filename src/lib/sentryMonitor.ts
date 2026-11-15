/**
 * The Sentry / GlitchTip monitor (plan 12.4). Imported by `telemetry.ts`
 * only after the user turned error reports on AND the build has a DSN — so
 * a default build never loads `@sentry/browser`.
 *
 * - Every request goes through the privacy ledger (`guardedFetch`, category
 *   "monitoring"): listed in the ledger panel, refused under local-only.
 *   Sentry's own fetch transport would use a pristine `fetch` taken from an
 *   iframe and bypass the ledger, so the transport is given ours.
 * - `beforeSend` rebuilds each event from an allowlist (`scrubEvent`): the
 *   error's class and stack frames only — no message text, request URL,
 *   user, breadcrumbs or tags.
 * - No session replay, no tracing, no session tracking, no breadcrumbs:
 *   default integrations are off; only uncaught errors, error causes and
 *   de-duplication are kept.
 */
import * as Sentry from "@sentry/browser";
import { guardedFetch, MONITORING_REASON } from "../ai/privacyLedger";
import { setErrorSink } from "./logger";
import { getMonitoringConsent, getPerformanceConsent } from "./telemetry";
import { isVitalsEvent, redactEvent, scrubEvent, scrubVitalsEvent, vitalsBuckets } from "./monitoringScrub";
import { vitalsSnapshot } from "./webVitals";

/** `fetch` for the transport: recorded by the ledger as monitoring traffic. */
export const ledgerFetch: typeof fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return guardedFetch(url, init ?? {}, { category: "monitoring", reason: MONITORING_REASON });
};

let initialized = false;

/** Initialise the SDK once and route `log.error` to it. */
export async function startSentry(dsn: string): Promise<void> {
  if (!initialized) {
    initialized = true;
    Sentry.init({
      dsn,
      release: "lumen@0.1.0",
      defaultIntegrations: false,
      integrations: [Sentry.globalHandlersIntegration(), Sentry.linkedErrorsIntegration(), Sentry.dedupeIntegration()],
      transport: (options) => Sentry.makeFetchTransport(options, ledgerFetch),
      sendDefaultPii: false,
      sendClientReports: false,
      enableLogs: false,
      enableMetrics: false,
      maxBreadcrumbs: 0,
      beforeBreadcrumb: () => null,
      // why: consent is re-read for every event — turning a switch off stops its reports at once.
      // W11.S19: error reports and performance reports have separate consents; whatever is left after
      // the allowlist goes through the secret and PII redactor too.
      beforeSend: (event) => (isVitalsEvent(event) ? (getPerformanceConsent() ? scrubVitalsEvent(event) : null) : getMonitoringConsent() ? redactEvent(scrubEvent(event)) : null),
    });
    // Performance reports: once, when the page is hidden, the session's web-vitals buckets.
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") reportVitalsBuckets();
      });
  }
  setErrorSink((...args: unknown[]) => {
    if (!getMonitoringConsent()) return;
    const err = args.find((a): a is Error => a instanceof Error);
    // why: only an Error's class and stack go out (scrubEvent); the logger's other arguments may hold note text.
    // A log.error without an Error is reported by where it was logged.
    Sentry.captureException(err ?? new Error("log.error"));
  });
}

let vitalsSent = false;

/**
 * Send this session's web vitals as counts per rating (W11.S19), once, and
 * only with performance consent. No value and no page address leave.
 */
export function reportVitalsBuckets(snapshot = vitalsSnapshot()): boolean {
  if (vitalsSent || !getPerformanceConsent()) return false;
  const buckets = vitalsBuckets(Object.values(snapshot).filter((s): s is NonNullable<typeof s> => !!s));
  if (!Object.keys(buckets).length) return false;
  vitalsSent = true;
  Sentry.captureEvent({ message: "web-vitals", level: "info", extra: { lumenVitals: buckets } });
  return true;
}

/** Send what is queued (tests, and before the page closes). */
export function flushMonitoring(timeoutMs = 2000): Promise<boolean> {
  return Sentry.flush(timeoutMs);
}
