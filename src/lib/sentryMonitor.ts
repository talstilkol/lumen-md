/**
 * The Sentry / GlitchTip monitor (plan 12.4). Imported by `telemetry.ts`
 * only after the user turned error reports on AND the build has a DSN — so
 * a default build never loads `@sentry/browser`.
 *
 * - Every request goes through the privacy ledger (`guardedFetch`, category
 *   "monitoring"): listed in the ledger panel, refused under local-only.
 *   Sentry's own fetch transport would use a pristine `fetch` taken from an
 *   iframe and bypass the ledger, so the transport is given ours.
 * - `beforeSend` rebuilds each event from an allowlist (`scrubEvent`): no
 *   note content, titles, paths, request URL, user, breadcrumbs or tags.
 * - No session replay, no tracing, no session tracking, no breadcrumbs:
 *   default integrations are off; only uncaught errors, error causes and
 *   de-duplication are kept.
 */
import * as Sentry from "@sentry/browser";
import { guardedFetch, MONITORING_REASON } from "../ai/privacyLedger";
import { setErrorSink } from "./logger";
import { getMonitoringConsent } from "./telemetry";
import { scrubEvent, scrubText } from "./monitoringScrub";

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
      // why: consent is re-read for every event — turning the pill off stops reports at once
      beforeSend: (event) => (getMonitoringConsent() ? scrubEvent(event) : null),
    });
  }
  setErrorSink((...args: unknown[]) => {
    if (!getMonitoringConsent()) return;
    const err = args.find((a): a is Error => a instanceof Error);
    const first = args[0];
    // why: only the Error goes out; the logger's other arguments may hold note text
    if (err) Sentry.captureException(err);
    else if (typeof first === "string") Sentry.captureMessage(scrubText(first), "error");
  });
}

/** Send what is queued (tests, and before the page closes). */
export function flushMonitoring(timeoutMs = 2000): Promise<boolean> {
  return Sentry.flush(timeoutMs);
}
