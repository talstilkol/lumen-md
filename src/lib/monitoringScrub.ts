/**
 * What an error report may carry (plan 12.4). Loaded only with the Sentry
 * monitor, never on the startup path.
 *
 * Allowlist, not blocklist: the event is rebuilt from the few fields that
 * describe *the code* — the error's class name and stack frames of the
 * app's own scripts — and everything else is dropped. That includes every
 * free-text message: an error message can embed a title or note text
 * without quotes ("Failed to save Quarterly plan"), and no pattern can tell
 * that apart from the app's own words. The stack trace says where it
 * happened; the class name says what kind of error it was.
 */
import type { ErrorEvent, Exception, StackFrame } from "@sentry/browser";
import { findPatterns } from "../ai/pii";

const MAX_FRAMES = 50;

/**
 * An error class name (`TypeError`, `WorkspaceConflictError`, `DOMException`),
 * or "Error" for anything else. W11.S19: CamelCase letters and digits only,
 * with no run of 4 digits, so an identifier-shaped secret or number
 * (`ghp_…`, `user_example_com`, `_972_52_555_0199`) can't pass as a class.
 */
export function scrubType(type: string | undefined): string {
  return type && /^[A-Z][A-Za-z0-9]{0,60}$/.test(type) && !/\d{4}/.test(type) ? type : "Error";
}

/** How the SDK caught it (`generic`, `onerror`, `auto.browser.global_handlers.onunhandledrejection`), or "generic". */
export function scrubMechanism(type: string | undefined): string {
  return type && /^[a-z][a-z0-9_.]{0,80}$/.test(type) && !/\d{4}/.test(type) ? type : "generic";
}

/** A script URL reduced to its file name (no origin, path, query or hash). */
export function scrubFilename(name: string | undefined): string | undefined {
  if (!name) return name;
  const noQuery = name.split(/[?#]/)[0];
  const base = noQuery.split(/[/\\]/).pop() ?? "";
  return /^[\w.@-]{1,120}$/.test(base) ? base : "[file]";
}

function scrubFrame(f: StackFrame): StackFrame {
  const out: StackFrame = {};
  const filename = scrubFilename(f.filename);
  if (filename !== undefined) out.filename = filename;
  if (f.function && /^[\w$.<>@ -]{1,120}$/.test(f.function)) out.function = f.function;
  if (typeof f.lineno === "number") out.lineno = f.lineno;
  if (typeof f.colno === "number") out.colno = f.colno;
  if (typeof f.in_app === "boolean") out.in_app = f.in_app;
  return out;
}

function scrubException(e: Exception): Exception {
  // why: no `value` — the message is free text and may hold the user's words
  const out: Exception = { type: scrubType(e.type) };
  if (e.mechanism) out.mechanism = { type: scrubMechanism(e.mechanism.type), handled: e.mechanism.handled };
  const frames = e.stacktrace?.frames;
  // why: Sentry lists frames oldest-first; the newest ones (the end) are where the error happened
  if (frames?.length) out.stacktrace = { frames: frames.slice(-MAX_FRAMES).map(scrubFrame) };
  return out;
}

/**
 * The event as it may leave the device. Returns a new object; fields that
 * aren't listed here are not sent. An event with no exception (a bare
 * message) has nothing left to send and is dropped (null).
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  const values = event.exception?.values;
  if (!values?.length) return null;
  const out: ErrorEvent = { type: undefined, exception: { values: values.map(scrubException) } };
  if (event.event_id) out.event_id = event.event_id;
  if (event.timestamp !== undefined) out.timestamp = event.timestamp;
  if (event.level) out.level = event.level;
  if (event.platform) out.platform = event.platform;
  // W11.S19: only the shapes the app itself sets.
  if (event.release && /^lumen@\d+\.\d+\.\d+(?:-[A-Za-z0-9.]{1,30})?$/.test(event.release)) out.release = event.release;
  if (event.environment && /^[a-z]{1,20}$/.test(event.environment)) out.environment = event.environment;
  // why: SDK metadata only; its settings carry infer_ip "never" (no IP address stored)
  if (event.sdk) out.sdk = event.sdk;
  return out;
}

/* ─── After the allowlist: secrets and PII (plan W11.S19) ─────────────── */

/**
 * Secret shapes that could still sit in a kept string (a function or file
 * name, the release): API keys, tokens, JWTs, long hex or base64 runs.
 */
const SECRET_PATTERNS: RegExp[] = [
  /sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\b[0-9a-fA-F]{32,}\b/g,
  /[A-Za-z0-9+/_-]{40,}={0,2}/g,
  // A number of 9 digits or more, whatever separates them (phone, ID, card, IBAN digits).
  /\d(?:[\s_.-]?\d){8,}/g,
];

/** A string with every secret shape and every PII pattern (pii.ts) replaced by "[redacted]". */
export function redactString(s: string): string {
  let out = s;
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[redacted]");
  const spans = findPatterns(out).sort((a, b) => b.start - a.start);
  for (const sp of spans) out = `${out.slice(0, sp.start)}[redacted]${out.slice(sp.end)}`;
  return out;
}

/** Every string in a (scrubbed) event through `redactString`. */
export function redactEvent<T>(event: T): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return redactString(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return event === null ? event : (walk(event) as T);
}

/* ─── Performance reports: web-vitals buckets only ─────────────────── */

const VITALS = ["LCP", "FCP", "TTFB", "INP", "CLS"] as const;
const RATINGS = ["good", "needs-improvement", "poor"] as const;
export type VitalsBuckets = Partial<Record<(typeof VITALS)[number], Partial<Record<(typeof RATINGS)[number], number>>>>;

/** Counts per metric per rating, from samples ({ name, value, rating }): the values themselves are dropped. */
export function vitalsBuckets(samples: ReadonlyArray<{ name: string; rating: string }>): VitalsBuckets {
  const out: VitalsBuckets = {};
  for (const s of samples) {
    const name = VITALS.find((v) => v === s.name);
    const rating = RATINGS.find((r) => r === s.rating);
    if (!name || !rating) continue;
    const m = (out[name] ??= {});
    m[rating] = (m[rating] ?? 0) + 1;
  }
  return out;
}

/** Is this the performance report (`reportVitalsBuckets`)? */
export function isVitalsEvent(event: ErrorEvent): boolean {
  return !!(event.extra as { lumenVitals?: unknown } | undefined)?.lumenVitals && !event.exception;
}

/** The performance report as it may leave: "web-vitals" and the bucket counts, rebuilt; nothing else. */
export function scrubVitalsEvent(event: ErrorEvent): ErrorEvent | null {
  const raw = (event.extra as { lumenVitals?: unknown }).lumenVitals as Record<string, Record<string, unknown>> | undefined;
  if (!raw || typeof raw !== "object") return null;
  const buckets: VitalsBuckets = {};
  for (const name of VITALS) {
    const m = raw[name];
    if (!m || typeof m !== "object") continue;
    for (const r of RATINGS) {
      const n = m[r];
      if (Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 1000) (buckets[name] ??= {})[r] = n as number;
    }
  }
  if (!Object.keys(buckets).length) return null;
  const out: ErrorEvent = { type: undefined, message: "web-vitals", level: "info", extra: { lumenVitals: buckets } };
  if (event.event_id) out.event_id = event.event_id;
  if (event.timestamp !== undefined) out.timestamp = event.timestamp;
  if (event.release) out.release = redactString(event.release);
  if (event.sdk) out.sdk = event.sdk;
  return out;
}
