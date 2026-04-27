/**
 * Minimal opt-out error telemetry. Forwards `log.error` payloads to a Sentry
 * project via the Sentry envelope HTTP API — no SDK dependency.
 *
 * Wire-up:
 * 1. Set `VITE_SENTRY_DSN` (e.g. `https://abcdef@o123.ingest.sentry.io/4567`).
 * 2. Call `initTelemetry()` once at startup (in `main.tsx`).
 * 3. The user can opt out by setting `localStorage["lumen.telemetry.optOut"] = "1"`.
 *
 * If the DSN is missing or the user opted out, the sink is a no-op.
 */

import { setErrorSink } from "./logger";

const OPT_OUT_KEY = "lumen.telemetry.optOut";

interface DsnComponents {
  publicKey: string;
  host: string;
  projectId: string;
  protocol: string;
}

function parseDsn(dsn: string): DsnComponents | null {
  // dsn format: <protocol>://<publicKey>@<host>/<projectId>
  const match = /^(https?):\/\/([^@]+)@([^/]+)\/(\d+)$/.exec(dsn.trim());
  if (!match) return null;
  return {
    protocol: match[1],
    publicKey: match[2],
    host: match[3],
    projectId: match[4],
  };
}

function isOptedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

/** Public toggle — use from a Settings UI. */
export function setTelemetryOptOut(value: boolean): void {
  try {
    if (value) localStorage.setItem(OPT_OUT_KEY, "1");
    else localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    // private mode — silently ignore; telemetry will fall back to disabled
  }
}

export function getTelemetryOptOut(): boolean {
  return isOptedOut();
}

function readEnvDsn(): string | undefined {
  try {
    const env = (
      import.meta as ImportMeta & { env?: { VITE_SENTRY_DSN?: string } }
    ).env;
    return env?.VITE_SENTRY_DSN;
  } catch {
    return undefined;
  }
}

function buildEnvelope(
  components: DsnComponents,
  payload: unknown,
): { url: string; body: string } {
  const eventId =
    crypto.randomUUID?.().replace(/-/g, "") ??
    Math.random().toString(16).slice(2).padEnd(32, "0");
  const sentAt = new Date().toISOString();

  const headers = JSON.stringify({
    event_id: eventId,
    sent_at: sentAt,
    sdk: { name: "lumen.telemetry", version: "0.1.0" },
  });
  const itemHeader = JSON.stringify({ type: "event" });
  const body =
    headers + "\n" + itemHeader + "\n" + JSON.stringify(payload) + "\n";

  const url =
    `${components.protocol}://${components.host}/api/${components.projectId}/envelope/?` +
    `sentry_key=${components.publicKey}&sentry_version=7&sentry_client=lumen.telemetry/0.1.0`;

  return { url, body };
}

function shapeError(args: unknown[]): Record<string, unknown> {
  const first = args.find((a) => a instanceof Error) as Error | undefined;
  const messageArgs = args.filter((a) => a !== first);

  return {
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: "error",
    logger: "lumen",
    message: messageArgs.map((a) => formatArg(a)).join(" "),
    exception: first
      ? {
          values: [
            {
              type: first.name || "Error",
              value: first.message,
              stacktrace: first.stack ? { frames: parseStack(first.stack) } : undefined,
            },
          ],
        }
      : undefined,
    request: typeof location !== "undefined" ? { url: location.href } : undefined,
    release: "lumen@0.1.0",
  };
}

function formatArg(a: unknown): string {
  if (a == null) return String(a);
  if (typeof a === "string") return a;
  if (a instanceof Error) return a.message;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

function parseStack(stack: string): { filename: string; lineno?: number; colno?: number; function?: string }[] {
  return stack
    .split("\n")
    .slice(1, 30)
    .map((line) => {
      const m = /at\s+(?:(.+?)\s+\()?([^)]+):(\d+):(\d+)\)?/.exec(line.trim());
      if (!m) return { filename: line.trim() };
      return {
        function: m[1] || undefined,
        filename: m[2],
        lineno: Number(m[3]),
        colno: Number(m[4]),
      };
    })
    .filter((f) => f.filename);
}

let initialized = false;

/** Wire telemetry into the logger error sink. Safe to call multiple times. */
export function initTelemetry(): void {
  if (initialized) return;
  initialized = true;

  const dsn = readEnvDsn();
  if (!dsn) return; // no DSN = no telemetry, that's fine
  const parsed = parseDsn(dsn);
  if (!parsed) return;

  setErrorSink((...args: unknown[]) => {
    if (isOptedOut()) return;
    try {
      const payload = shapeError(args);
      const { url, body } = buildEnvelope(parsed, payload);
      // Use sendBeacon when available so errors flush during unload; fall back to fetch.
      const blob = new Blob([body], { type: "application/x-sentry-envelope" });
      if (navigator.sendBeacon?.(url, blob)) return;
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-sentry-envelope" },
        body,
        keepalive: true,
      }).catch(() => {
        // network failure → drop; never recurse into error logging
      });
    } catch {
      // never let telemetry failure crash the app
    }
  });
}
