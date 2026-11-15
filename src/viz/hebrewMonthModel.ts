/**
 * The Hebrew-calendar view (plan W12.V5): a month of the Hebrew calendar as
 * a grid — Tishrei to Elul, Adar I and Adar II in a leap year — with each
 * day's holidays and Shabbat reading, and an activity heatmap by Hebrew
 * month (rows) × day of the month (columns).
 *
 * ECharts' `calendar` coordinate is Gregorian only, so none of it is used:
 * the month grid is our own table, and the heatmap is a cartesian heatmap
 * through ./chartModel.ts, where right to left puts day 1 on the right.
 *
 * All dates come from src/daily/hebrewCalendar.ts (our own arithmetic,
 * checked against ICU and, through W10.E76, against Hebcal's table). Pure.
 */

import {
  daysInMonth,
  fixedOf,
  fixedOfHebrew,
  gregorianOf,
  hebrewOfFixed,
  holidaysOfHebrewYear,
  isLeapYear,
  monthsOfYear,
  readingsOfHebrewYear,
  weekdayOf,
  type Holiday,
} from "../daily/hebrewCalendar";
import { holidayLabel, monthName, readingName, type NameLang } from "../daily/hebrewCalendarNames";
import { gematria } from "../daily/gematria";
import type { HeatmapData } from "./chartModel";

const pad = (n: number) => String(n).padStart(2, "0");
export const isoOfFixed = (fixed: number) => {
  const g = gregorianOf(fixed);
  return `${g.y}-${pad(g.m)}-${pad(g.d)}`;
};
export const fixedOfIso = (iso: string) => fixedOf({ y: +iso.slice(0, 4), m: +iso.slice(5, 7), d: +iso.slice(8, 10) });

export interface HebrewMonthInfo {
  month: number;
  name: string;
  days: number;
  /** RD and ISO day of the 1st. */
  first: number;
  firstIso: string;
}

/** The months of a Hebrew year in order (13 in a leap year), each with its length and first day. */
export function hebrewYearMonths(year: number, lang: NameLang): HebrewMonthInfo[] {
  return monthsOfYear(year).map((month) => {
    const first = fixedOfHebrew({ year, month, day: 1 });
    return { month, name: monthName(month, year, lang), days: daysInMonth(month, year), first, firstIso: isoOfFixed(first) };
  });
}

export interface HebrewDayCell {
  day: number;
  /** "א׳" … "ל׳" in Hebrew, "1" … "30" otherwise. */
  dayLabel: string;
  fixed: number;
  iso: string;
  weekday: number;
  holidays: string[];
  /** Shabbat: the reading (a portion, or the holiday read instead). */
  reading?: string;
}

export interface HebrewMonthGrid {
  year: number;
  month: number;
  name: string;
  yearLabel: string;
  /** Weeks from Sunday; null before the 1st and after the last day. */
  weeks: Array<Array<HebrewDayCell | null>>;
  cells: HebrewDayCell[];
}

/** The Hebrew year as it is written: תשפ״ז (Hebrew), 5787 otherwise. */
export const hebrewYearLabel = (year: number, lang: NameLang) => (lang === "he" ? gematria(year % 1000) : String(year));
export const hebrewDayLabel = (day: number, lang: NameLang) => (lang === "he" ? gematria(day) : String(day));

export function hebrewMonthGrid(year: number, month: number, opts: { israel: boolean; lang: NameLang }): HebrewMonthGrid {
  const first = fixedOfHebrew({ year, month, day: 1 });
  const days = daysInMonth(month, year);
  const holidays = new Map<number, Holiday[]>();
  for (const h of holidaysOfHebrewYear(year, { israel: opts.israel })) {
    if (h.fixed < first || h.fixed >= first + days || h.kind === "erev") continue;
    holidays.set(h.fixed, [...(holidays.get(h.fixed) ?? []), h]);
  }
  const readings = new Map(readingsOfHebrewYear(year, { israel: opts.israel }).map((r) => [r.fixed, r]));
  const cells: HebrewDayCell[] = [];
  for (let d = 1; d <= days; d++) {
    const fixed = first + d - 1;
    const r = readings.get(fixed);
    const reading = r ? readingName(r, opts.lang) : "";
    cells.push({
      day: d,
      dayLabel: hebrewDayLabel(d, opts.lang),
      fixed,
      iso: isoOfFixed(fixed),
      weekday: weekdayOf(fixed),
      holidays: (holidays.get(fixed) ?? []).map((h) => holidayLabel(h, opts.lang)),
      ...(reading ? { reading } : {}),
    });
  }
  const weeks: Array<Array<HebrewDayCell | null>> = [];
  let week: Array<HebrewDayCell | null> = Array.from({ length: cells[0].weekday }, () => null);
  for (const c of cells) {
    week.push(c);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length) weeks.push([...week, ...Array.from({ length: 7 - week.length }, () => null)]);
  return { year, month, name: monthName(month, year, opts.lang), yearLabel: hebrewYearLabel(year, opts.lang), weeks, cells };
}

/** The month before or after, across the year boundary (Elul → Tishrei of the next year). */
export function stepMonth(year: number, month: number, by: number): { year: number; month: number } {
  let y = year;
  let list = monthsOfYear(y);
  let i = list.indexOf(month) + by;
  while (i < 0) {
    y -= 1;
    list = monthsOfYear(y);
    i += list.length;
  }
  while (i >= list.length) {
    i -= list.length;
    y += 1;
    list = monthsOfYear(y);
  }
  return { year: y, month: list[i] };
}

/** The Hebrew year and month of an ISO day. */
export function hebrewMonthOf(iso: string): { year: number; month: number; day: number } {
  return hebrewOfFixed(fixedOfIso(iso));
}

/**
 * Activity by Hebrew month: rows are the months of the year (13 in a leap
 * year), columns the days 1–30, the value the count (or sum) of the ISO
 * days that fall there. It is a HeatmapData, so the chart and its table
 * come from ./chartModel.ts like every other heatmap.
 */
export function hebrewActivity(byDay: ReadonlyMap<string, number>, year: number, lang: NameLang): HeatmapData {
  const months = hebrewYearMonths(year, lang);
  const xs = Array.from({ length: 30 }, (_, i) => hebrewDayLabel(i + 1, lang));
  const start = months[0].first;
  const end = months[months.length - 1].first + months[months.length - 1].days;
  const acc = new Map<string, number>();
  for (const [iso, v] of byDay) {
    const f = fixedOfIso(iso);
    if (f < start || f >= end) continue;
    const h = hebrewOfFixed(f);
    const yi = months.findIndex((m) => m.month === h.month);
    const k = `${h.day - 1},${yi}`;
    acc.set(k, (acc.get(k) ?? 0) + v);
  }
  const cells: Array<[number, number, number]> = [];
  months.forEach((_, yi) => {
    for (let xi = 0; xi < 30; xi++) {
      const v = acc.get(`${xi},${yi}`);
      if (v !== undefined) cells.push([xi, yi, v]);
    }
  });
  const values = cells.map((c) => c[2]);
  return { kind: "heatmap", xs, ys: months.map((m) => m.name), cells, min: values.length ? Math.min(...values) : 0, max: values.length ? Math.max(...values) : 0 };
}

export { isLeapYear };
