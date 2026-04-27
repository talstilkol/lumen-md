/**
 * Lightweight logger that gates debug/info output to development mode and
 * forwards warnings/errors in production. The Sentry hook is wired here once
 * `src/lib/telemetry.ts` registers itself, so any `log.error` reaches both the
 * console and the error tracker without scattering Sentry imports.
 */

type Args = unknown[];
type Sink = (...args: Args) => void;

const isDev = (() => {
  try {
    return Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
})();

let errorSink: Sink | null = null;

/** Telemetry layers (e.g. Sentry) call this to receive `log.error` payloads. */
export function setErrorSink(sink: Sink | null): void {
  errorSink = sink;
}

const tag = "[lumen]";

export const log = {
  debug: (...args: Args) => {
    if (isDev) console.log(tag, ...args);
  },
  info: (...args: Args) => {
    if (isDev) console.info(tag, ...args);
  },
  warn: (...args: Args) => {
    console.warn(tag, ...args);
  },
  error: (...args: Args) => {
    console.error(tag, ...args);
    if (errorSink) {
      try {
        errorSink(...args);
      } catch {
        // ignore — sink failures must never crash the app
      }
    }
  },
};

export type Logger = typeof log;
