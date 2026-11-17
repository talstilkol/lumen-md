/**
 * Plan W11.S19 (research R5.14): error reports and performance reports have
 * separate consents (both off by default), the user can set their own
 * tracker (a GlitchTip DSN), whatever survives the allowlist goes through
 * the secret and PII redactor, and web vitals leave only as rating counts.
 *
 * The fuzz below plants SYNTHETIC secrets (made-up keys in real formats) in
 * every field of a Sentry event and checks that none survive.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/browser";
import { __resetTelemetry, __setMonitoringDsnForTesting, getMonitoringConsent, getPerformanceConsent, getUserDsn, initTelemetry, monitoringDsn, monitoringEndpoint, setMonitoringConsent, setPerformanceConsent, setUserDsn } from "../lib/telemetry";
import { isVitalsEvent, redactEvent, redactString, scrubEvent, scrubVitalsEvent, vitalsBuckets } from "../lib/monitoringScrub";

const BUILD_DSN = "https://buildkey@o1.ingest.example.com/42";
const USER = "https://userkey@glitchtip.example.org/7";

beforeEach(() => {
  localStorage.clear();
  __resetTelemetry();
  __setMonitoringDsnForTesting(null);
});
afterEach(() => __setMonitoringDsnForTesting(null));

describe("two consents, both off by default (Settings → Security)", () => {
  it("nothing loads by default, with a DSN or without", async () => {
    let loads = 0;
    const load = async () => (loads++, { startSentry: async () => undefined });
    expect(getMonitoringConsent()).toBe(false);
    expect(getPerformanceConsent()).toBe(false);
    __setMonitoringDsnForTesting(BUILD_DSN);
    expect(await initTelemetry(load)).toBe(false);
    expect(loads).toBe(0);
  });

  it("either switch with a tracker starts the monitor; a switch without a tracker doesn't", async () => {
    let loads = 0;
    const load = async () => (loads++, { startSentry: async () => undefined });
    setPerformanceConsent(true);
    expect(await initTelemetry(load)).toBe(false);
    __setMonitoringDsnForTesting(BUILD_DSN);
    expect(await initTelemetry(load)).toBe(true);
    setPerformanceConsent(false);
    expect(getPerformanceConsent()).toBe(false);
    expect(await initTelemetry(load)).toBe(false);
    setMonitoringConsent(true);
    expect(await initTelemetry(load)).toBe(true);
    expect(getPerformanceConsent()).toBe(false);
  });
});

describe("the user's own tracker (GlitchTip DSN)", () => {
  it("takes precedence over the build's; invalid ones are refused; empty clears it", () => {
    __setMonitoringDsnForTesting(BUILD_DSN);
    expect(monitoringDsn()).toBe(BUILD_DSN);
    expect(setUserDsn(USER)).toBe(true);
    expect(getUserDsn()).toBe(USER);
    expect(monitoringDsn()).toBe(USER);
    expect(monitoringEndpoint()).toBe("https://glitchtip.example.org/api/7/");
    for (const bad of ["http://key@glitchtip.example.org/7", "https://glitchtip.example.org/7", "https://key@glitchtip.example.org/", "not a url"]) expect(setUserDsn(bad), bad).toBe(false);
    expect(monitoringDsn()).toBe(USER);
    expect(setUserDsn("")).toBe(true);
    expect(monitoringDsn()).toBe(BUILD_DSN);
  });
});

/* ─── fuzz: planted secrets in every field ─────────────────────────── */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Synthetic secrets in the formats real ones have (none of them is a live key). */
const SECRETS = (r: () => number) => {
  const hex = (n: number) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(r() * 16)]).join("");
  const b62 = (n: number) => Array.from({ length: n }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(r() * 62)]).join("");
  return [
    `sk-proj-${b62(40)}`,
    `sk-ant-${b62(32)}`,
    `ghp_${b62(36)}`,
    `github_pat_${b62(30)}`,
    `AKIA${b62(16).toUpperCase().replace(/[^A-Z0-9]/g, "Q")}`,
    `xoxb-${hex(12)}-${hex(12)}`,
    `AIza${b62(35)}`,
    `eyJ${b62(20)}.eyJ${b62(30)}.${b62(40)}`,
    hex(64),
    `user${hex(4)}@example.com`,
    "+972-52-555-0199",
    "4111 1111 1111 1111",
    "IL62 0108 0000 0009 9999 999",
  ];
};

const PLACES: Array<(e: Record<string, unknown>, s: string) => void> = [
  (e, s) => ((e.exception as { values: Array<{ value: string }> }).values[0].value = `Failed for ${s}`),
  (e, s) => ((e.exception as { values: Array<{ type: string }> }).values[0].type = s.replace(/[^\w$]/g, "_")),
  (e, s) => ((e.exception as { values: Array<{ stacktrace: { frames: Array<Record<string, unknown>> } }> }).values[0].stacktrace.frames[0].function = s),
  (e, s) => ((e.exception as { values: Array<{ stacktrace: { frames: Array<Record<string, unknown>> } }> }).values[0].stacktrace.frames[0].filename = `https://app.example/${s}.js`),
  (e, s) => ((e.exception as { values: Array<{ stacktrace: { frames: Array<Record<string, unknown>> } }> }).values[0].stacktrace.frames[0].vars = { key: s }),
  (e, s) => (e.message = s),
  (e, s) => (e.breadcrumbs = [{ message: s, data: { token: s } }]),
  (e, s) => (e.request = { url: `https://app.example/?k=${s}`, headers: { Authorization: `Bearer ${s}` }, cookies: { s } }),
  (e, s) => (e.user = { email: s, ip_address: "203.0.113.7" }),
  (e, s) => (e.tags = { note: s }),
  (e, s) => (e.extra = { body: s }),
  (e, s) => (e.contexts = { app: { name: s } }),
  (e, s) => (e.release = `lumen@${s}`),
  (e, s) => (e.environment = s),
];

function event(): Record<string, unknown> {
  return {
    event_id: "e0",
    timestamp: 1,
    level: "error",
    platform: "javascript",
    release: "lumen@0.1.0",
    exception: { values: [{ type: "TypeError", value: "x", mechanism: { type: "onerror", handled: false }, stacktrace: { frames: [{ filename: "https://app.example/assets/index-abc123.js", function: "save", lineno: 10, colno: 2, in_app: true }] } }] },
    sdk: { name: "sentry.javascript.browser", version: "9.0.0" },
  };
}

describe("fuzz: secrets planted in every field (W11.S19 acceptance 2)", () => {
  it("0 leaks in 1,000 events through the allowlist and the redactor", () => {
    const r = rng(20261115);
    let planted = 0;
    const leaks: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const e = event();
      const secrets = SECRETS(r);
      const used: string[] = [];
      for (let k = 0; k < 1 + Math.floor(r() * 4); k++) {
        const s = secrets[Math.floor(r() * secrets.length)];
        const place = PLACES[Math.floor(r() * PLACES.length)];
        place(e, s);
        used.push(s, s.replace(/[^\w$]/g, "_"));
        planted++;
      }
      const out = JSON.stringify(redactEvent(scrubEvent(e as unknown as ErrorEvent)));
      for (const s of used) if (s.length >= 8 && out.includes(s)) leaks.push(`event ${i}: ${s.slice(0, 12)}…`);
      // Digits of a card or phone number must not survive with their separators dropped either.
      for (const s of used) if (/^[\d +-]{12,}$/.test(s) && out.includes(s.replace(/\D/g, ""))) leaks.push(`event ${i}: digits of ${s}`);
    }
    expect(planted).toBeGreaterThan(1500);
    expect(leaks).toEqual([]);
  });

  it("what the code needs survives: class name, frames, file names, line numbers", () => {
    const out = redactEvent(scrubEvent(event() as unknown as ErrorEvent))!;
    expect(out.exception!.values![0]).toMatchObject({ type: "TypeError", stacktrace: { frames: [{ filename: "index-abc123.js", function: "save", lineno: 10, colno: 2 }] } });
    expect(redactString("chunk-3f2a9b1c.js")).toBe("chunk-3f2a9b1c.js");
  });
});

describe("performance reports: web-vitals buckets only (W11.S19 step 3)", () => {
  it("counts per metric per rating; values, names it doesn't know and everything else are dropped", () => {
    const b = vitalsBuckets([
      { name: "LCP", value: 2310, rating: "good" } as never,
      { name: "LCP", value: 5100, rating: "poor" } as never,
      { name: "INP", value: 120, rating: "good" } as never,
      { name: "XYZ", value: 1, rating: "good" } as never,
    ]);
    expect(b).toEqual({ LCP: { good: 1, poor: 1 }, INP: { good: 1 } });
    const raw = { event_id: "v1", message: "web-vitals https://app.example/notes/secret", level: "info", extra: { lumenVitals: { ...b, LCP: { good: 1, poor: 1, value: 2310 }, url: "https://app.example/notes/secret" }, other: "x" }, request: { url: "https://app.example/notes/secret" }, tags: { a: "b" } } as unknown as ErrorEvent;
    expect(isVitalsEvent(raw)).toBe(true);
    const out = scrubVitalsEvent(raw)!;
    expect(out).toEqual({ type: undefined, event_id: "v1", message: "web-vitals", level: "info", extra: { lumenVitals: { LCP: { good: 1, poor: 1 }, INP: { good: 1 } } } });
    expect(JSON.stringify(out)).not.toMatch(/secret|2310|app\.example/);
    expect(isVitalsEvent(event() as unknown as ErrorEvent)).toBe(false);
    expect(scrubVitalsEvent({ extra: { lumenVitals: { LCP: { good: -1 } } } } as unknown as ErrorEvent)).toBeNull();
  });
});
