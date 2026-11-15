/**
 * An academic study plan (plan W12.H5): a syllabus as the semester's
 * teaching weeks, each with its readings and deadlines, laid on the
 * institution's academic calendar (the ICS feed of W7.8 / W7.20).
 *
 *  - The weeks come from the calendar: the semester's first and last day
 *    (events named for them, or given), minus the breaks it publishes
 *    ("no classes", "חופשת …", "אין לימודים"). A week that is all break is
 *    not a teaching week; one with a holiday in it is, and lists the days
 *    off (our Hebrew calendar, W2.10, and the work week, W5.15).
 *  - A deadline on Shabbat or a chag gets a suggested day (W5.15
 *    adjustDeadline); the date as written is not changed.
 *  - Readings are task items in the syllabus note; marking one read checks
 *    its box and nothing else.
 *
 * Pure: the ICS text in, weeks and markdown out. No network.
 */
import { parseEvents, type CalEvent } from "../calendar/ical";
import { fixedOf, gregorianOf, weekdayOf, type GDay } from "../daily/hebrewCalendar";
import { adjustDeadline, dayStatus, type TimeOptions } from "../daily/israeliTime";

const pad2 = (n: number) => String(n).padStart(2, "0");
export const isoOf = (d: GDay) => `${d.y}-${pad2(d.m)}-${pad2(d.d)}`;
export const parseIso = (s: string): GDay | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
};

export interface DayRange {
  /** First and last day, inclusive (YYYY-MM-DD). */
  from: string;
  to: string;
  name: string;
}

export interface SemesterCalendar {
  start: string;
  end: string;
  breaks: DayRange[];
}

/** Words that name a break in an academic calendar (Hebrew and English). */
const BREAK = /(חופש|אין לימודים|לא יתקיימו לימודים|הפסקת לימודים|no (?:classes|teaching)|break|recess|vacation|holiday)/i;
const START = /(פתיחת (?:ה)?סמסטר|תחילת (?:ה)?סמסטר|תחילת הלימודים|first day of (?:classes|semester)|semester (?:begins|starts)|classes begin)/i;
const END = /(סיום (?:ה)?סמסטר|סוף (?:ה)?סמסטר|סיום הלימודים|last day of (?:classes|semester)|semester ends|classes end)/i;

const lastDay = (e: CalEvent): string => {
  if (!e.end) return e.start.date;
  const exclusive = e.allDay || e.end.time === "00:00";
  if (!exclusive) return e.end.date;
  const d = parseIso(e.end.date)!;
  const f = fixedOf(d) - 1;
  return f < fixedOf(parseIso(e.start.date)!) ? e.start.date : isoOf(gregorianOf(f));
};

/**
 * The semester from an academic calendar's ICS: its start and end (events
 * named for them, the first of each after `after`), and the breaks inside it.
 * `start` / `end` given override what the calendar says.
 */
export function semesterFromIcs(ics: string, opts: { after?: string; start?: string; end?: string } = {}): SemesterCalendar | null {
  const events = parseEvents(ics).filter((e) => !e.rrule);
  events.sort((a, b) => a.start.date.localeCompare(b.start.date));
  const after = opts.after ?? "0000-00-00";
  const start = opts.start ?? events.find((e) => e.start.date >= after && START.test(e.summary))?.start.date;
  if (!start) return null;
  const endEvent = events.find((e) => e.start.date >= start && END.test(e.summary));
  const end = opts.end ?? (endEvent ? lastDay(endEvent) : undefined);
  if (!end) return null;
  const breaks = events
    .filter((e) => BREAK.test(e.summary) && !START.test(e.summary) && !END.test(e.summary))
    .map((e) => ({ from: e.start.date, to: lastDay(e), name: e.summary }))
    .filter((b) => b.to >= start && b.from <= end);
  return { start, end, breaks };
}

/**
 * Every semester the calendar names, in order (one per start event), and
 * the one for `today`: the first that has not ended yet.
 */
export function semestersFromIcs(ics: string): SemesterCalendar[] {
  const starts = parseEvents(ics)
    .filter((e) => !e.rrule && START.test(e.summary))
    .map((e) => e.start.date)
    .sort();
  const out: SemesterCalendar[] = [];
  for (const d of starts) {
    const sem = semesterFromIcs(ics, { after: d });
    if (sem && !out.some((x) => x.start === sem.start)) out.push(sem);
  }
  return out;
}
export const semesterFor = (ics: string, today: string): SemesterCalendar | null => semestersFromIcs(ics).find((s) => s.end >= today) ?? null;

export interface TeachingWeek {
  n: number;
  /** The week's first and last day in the semester (YYYY-MM-DD). */
  from: string;
  to: string;
  /** Working days of the week that are breaks or days off, with why. */
  off: Array<{ day: string; why: string }>;
}

/**
 * The teaching weeks: from the semester's start, week by week (a week starts
 * on the work week's first day: Sunday in Israel), to its end. A week whose
 * every working day is a break or a day off is skipped and not counted.
 */
export function teachingWeeks(sem: SemesterCalendar, opts: TimeOptions): TeachingWeek[] {
  const first = fixedOf(parseIso(sem.start)!);
  const last = fixedOf(parseIso(sem.end)!);
  const weekStart = opts.workWeek === "sun-thu" ? 0 : 1;
  const inBreak = (iso: string) => sem.breaks.find((b) => iso >= b.from && iso <= b.to);
  const out: TeachingWeek[] = [];
  let f = first - ((weekdayOf(first) - weekStart + 7) % 7);
  for (; f <= last; f += 7) {
    const from = Math.max(f, first);
    const to = Math.min(f + 6, last);
    const off: TeachingWeek["off"] = [];
    let teaching = 0;
    for (let d = from; d <= to; d++) {
      const day = gregorianOf(d);
      const st = dayStatus(day, opts);
      const weekend = st.off.some((o) => o.kind === "weekend");
      if (weekend) continue;
      const b = inBreak(isoOf(day));
      if (b) off.push({ day: isoOf(day), why: b.name });
      else if (!st.working) off.push({ day: isoOf(day), why: st.off.map((o) => (o.kind === "holiday" ? o.holiday.id : "weekend")).join(", ") });
      else teaching++;
    }
    if (teaching === 0) continue;
    out.push({ n: out.length + 1, from: isoOf(gregorianOf(from)), to: isoOf(gregorianOf(to)), off });
  }
  return out;
}

// ── The syllabus note ───────────────────────────────────────────────────

export interface SyllabusWeek {
  n: number;
  topic: string;
  readings: Array<{ text: string; read: boolean; line: number }>;
  deadlines: Array<{ date: string; text: string; line: number }>;
}

const WEEK_HEADING = /^##\s+(?:שבוע|Week)\s+(\d+)\s*(?:[:·—–-]\s*(.*))?$/i;
const READING = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/;
const DEADLINE = /^\s*[-*]\s+(?:דדליין|הגשה|Deadline|Due):?\s+(\d{4}-\d{2}-\d{2})\s+(.+)$/i;

/** The weeks of a syllabus note: `## שבוע 3: topic`, then `- [ ] reading` and `- דדליין: 2026-11-20 …` lines. */
export function parseSyllabus(md: string): SyllabusWeek[] {
  const out: SyllabusWeek[] = [];
  md.split(/\r?\n/).forEach((l, line) => {
    const h = WEEK_HEADING.exec(l);
    if (h) {
      out.push({ n: Number(h[1]), topic: (h[2] ?? "").trim(), readings: [], deadlines: [] });
      return;
    }
    const w = out.at(-1);
    if (!w) return;
    const d = DEADLINE.exec(l);
    if (d) {
      w.deadlines.push({ date: d[1], text: d[2].trim(), line });
      return;
    }
    const r = READING.exec(l);
    if (r) w.readings.push({ text: r[2].trim(), read: r[1] !== " ", line });
  });
  return out;
}

/** A new syllabus note for the teaching weeks: one heading per week with its dates and the days off. */
export function syllabusTemplate(weeks: readonly TeachingWeek[], lang: "he" | "en", title: string): string {
  const dm = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}`;
  const lines = [`# ${title}`, ""];
  for (const w of weeks) {
    lines.push(`## ${lang === "he" ? "שבוע" : "Week"} ${w.n}: `, `${dm(w.from)}–${dm(w.to)}${w.off.length ? ` · ${lang === "he" ? "אין לימודים" : "no classes"}: ${w.off.map((o) => dm(o.day)).join(", ")}` : ""}`, "- [ ] ", "");
  }
  return lines.join("\n");
}

/** The note with the reading on `line` marked read (or not); only its box changes. */
export function markReading(md: string, line: number, read = true): string {
  const nl = md.includes("\r\n") ? "\r\n" : "\n";
  const ls = md.split(/\r?\n/);
  if (!READING.test(ls[line] ?? "")) return md;
  ls[line] = ls[line].replace(/\[[ xX]\]/, read ? "[x]" : "[ ]");
  return ls.join(nl);
}

export interface DeadlineCheck {
  week: number;
  date: string;
  text: string;
  /** A suggested day when it falls on Shabbat or a chag (the note keeps its date). */
  suggest: string | null;
  /** The teaching week the deadline falls in, or null outside the semester. */
  inWeek: number | null;
}

/** Each deadline: the suggested day when it falls on a day off, and the teaching week it is in. */
export function checkDeadlines(md: string, weeks: readonly TeachingWeek[], opts: TimeOptions & { move?: "next" | "previous" }): DeadlineCheck[] {
  return parseSyllabus(md).flatMap((w) =>
    w.deadlines.map((d) => {
      const day = parseIso(d.date)!;
      const a = adjustDeadline(day, opts);
      const inWeek = weeks.find((t) => d.date >= t.from && d.date <= t.to)?.n ?? null;
      return { week: w.n, date: d.date, text: d.text, suggest: a.moved ? isoOf(a.due) : null, inWeek };
    }),
  );
}
