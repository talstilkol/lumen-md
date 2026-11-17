/**
 * Dates, times and numbers in the UI language (plan W13.I3), with the
 * user's calendar: Gregorian, or the Hebrew calendar (plan W2.10) through
 * `-u-ca-hebrew`. `formatNumber` (src/i18n/index.ts) writes numbers with the
 * chosen digits. Every screen formats through here, never through
 * `toLocaleString()` without a locale (that is the browser's language, not
 * the app's: a Hebrew UI in an English browser showed "11/17/2026").
 */
import { getLocale, numberLocale } from "./index";

export type DateCalendar = "gregory" | "hebrew";
const KEY = "lumen-date-calendar";
const listeners = new Set<() => void>();

export function dateCalendar(): DateCalendar {
  try {
    return globalThis.localStorage?.getItem(KEY) === "hebrew" ? "hebrew" : "gregory";
  } catch {
    return "gregory";
  }
}

export function setDateCalendar(c: DateCalendar): void {
  try {
    if (c === "hebrew") globalThis.localStorage?.setItem(KEY, "hebrew");
    else globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* why: storage blocked — the choice lasts for this session only */
  }
  cache.clear();
  for (const l of listeners) l();
}

export function onDateCalendarChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The BCP 47 tag for dates: the UI language, the digits and the calendar. */
export function dateLocale(): string {
  const base = numberLocale();
  if (dateCalendar() !== "hebrew") return base;
  return base.includes("-u-") ? `${base}-ca-hebrew` : `${base}-u-ca-hebrew`;
}

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const tag = dateLocale();
  const id = `${tag}|${JSON.stringify(opts)}`;
  let f = cache.get(id);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(tag, opts);
    } catch {
      f = new Intl.DateTimeFormat(getLocale(), opts);
    }
    cache.set(id, f);
  }
  return f;
}

const asDate = (d: Date | number | string) => (d instanceof Date ? d : new Date(d));

/** "17 Nov 2026" / "17 בנוב׳ 2026" / "ו׳ בכסלו תשפ״ז". */
export function formatDate(d: Date | number | string, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }): string {
  const date = asDate(d);
  return Number.isNaN(date.getTime()) ? "" : fmt(opts).format(date);
}

/** "14:05" in the UI language. */
export function formatTime(d: Date | number | string, opts: Intl.DateTimeFormatOptions = { timeStyle: "short" }): string {
  const date = asDate(d);
  return Number.isNaN(date.getTime()) ? "" : fmt(opts).format(date);
}

export function formatDateTime(d: Date | number | string, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }): string {
  const date = asDate(d);
  return Number.isNaN(date.getTime()) ? "" : fmt(opts).format(date);
}
