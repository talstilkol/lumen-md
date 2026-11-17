/**
 * The Gantt model (plan W13.G5): ranges, not points, from the same time
 * model as the R12.7 timeline — a claim's start and end are TimeSpans, so a
 * "1948" claim is a bar over the whole year and "March 1948" over the month
 * (the range in days follows the precision) — plus dependencies drawn as
 * arrows: a claim's `after` (the text says it came later) and a task's
 * ⛔ depends-on (Obsidian Tasks ids, W12.T6).
 *
 * Positions are fractions 0…1 of the time axis from the earliest day; the
 * view mirrors them in RTL, so the right end is the earliest. Pure.
 */
import type { TimelineClaim, Precision } from "../../entities/temporal";
import type { Task } from "../../tasks/taskParser";

export interface GanttItem {
  id: string;
  label: string;
  /** Inclusive ISO days. */
  start: string;
  end: string;
  precision: Precision;
  /** A row group (the subject, the note). */
  group?: string;
  /** Items this one comes after (arrows from their end to this one's start). */
  deps: string[];
  /** Where it was read (opens on Enter). */
  source?: { note: string; anchor: string | null };
  /** One day or less: drawn as a diamond, not a bar. */
  milestone: boolean;
  done?: boolean;
}

export interface GanttRow {
  item: GanttItem;
  /** Fractions of the axis (0 = the earliest day, 1 = the day after the latest). */
  x0: number;
  x1: number;
}

export interface GanttArrow {
  from: number;
  to: number;
  /** The later item starts before the earlier one ends. */
  conflict: boolean;
}

export interface GanttTick {
  at: number;
  day: string;
  unit: "week" | "month" | "year" | "decade";
}

export interface GanttLayout {
  rows: GanttRow[];
  arrows: GanttArrow[];
  ticks: GanttTick[];
  /** First and last day on the axis. */
  from: string;
  to: string;
  /** Items without a usable date (listed, never placed). */
  undated: GanttItem[];
  /** Dependencies on items that are not there. */
  missing: Array<{ item: string; dep: string }>;
  /** Items on a dependency cycle. */
  cycle: string[];
}

const DAY = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const dayNumber = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY);
export const dayString = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
const valid = (s: string | null | undefined): s is string => !!s && ISO.test(s) && dayString(dayNumber(s)) === s;

/** Timeline claims as Gantt items: the range from the start span's first day to the end span's last day. */
export function ganttFromClaims(claims: readonly TimelineClaim[], names?: ReadonlyMap<string, string>): GanttItem[] {
  return claims.map((c) => {
    const s = c.start ?? c.end;
    const e = c.end ?? c.start;
    const ok = !!s && !!e && valid(s.from) && valid(e.to) && s.from <= e.to;
    return {
      id: c.id,
      label: c.value,
      start: ok ? s!.from : "",
      end: ok ? e!.to : "",
      precision: (c.end ?? c.start)?.precision ?? "day",
      group: names?.get(c.subject) ?? c.subject,
      deps: c.after ? [c.after] : [],
      source: { note: c.source.note, anchor: c.source.anchor ?? null },
      milestone: ok && s!.from === e!.to,
    };
  });
}

/** Tasks (Obsidian Tasks format) as Gantt items: 🛫 start (else ⏳ scheduled, else 📅 due) to 📅 due; ⛔ ids are the arrows. */
export function ganttFromTasks(tasks: readonly Task[]): GanttItem[] {
  const idOf = (t: Task) => t.id || `${t.path}:${t.line}`;
  return tasks.map((t) => {
    const start = [t.start, t.scheduled, t.due].find(valid) ?? "";
    const end = [t.due, t.scheduled, t.start].find(valid) ?? "";
    const ok = !!start && !!end && start <= end;
    return {
      id: idOf(t),
      label: t.description,
      start: ok ? start : "",
      end: ok ? end : "",
      precision: "day" as const,
      group: t.path.replace(/^.*\//, "").replace(/\.md$/i, ""),
      deps: t.dependsOn,
      source: { note: t.path, anchor: t.blockLink || null },
      milestone: ok && start === end,
      done: t.status === "DONE",
    };
  });
}

/** Lay the items out: sorted by start (then end, then id), ticks for the span, arrows for the dependencies. */
export function ganttLayout(items: readonly GanttItem[]): GanttLayout {
  const placed = items.filter((i) => valid(i.start) && valid(i.end) && i.start <= i.end);
  const undated = items.filter((i) => !placed.includes(i));
  placed.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.end < b.end ? -1 : a.end > b.end ? 1 : a.id < b.id ? -1 : 1));
  const empty: GanttLayout = { rows: [], arrows: [], ticks: [], from: "", to: "", undated, missing: [], cycle: [] };
  if (!placed.length) return empty;
  let lo = Infinity;
  let hi = -Infinity;
  for (const i of placed) {
    lo = Math.min(lo, dayNumber(i.start));
    hi = Math.max(hi, dayNumber(i.end) + 1);
  }
  // A little air on both ends, and never a zero-length axis.
  const pad = Math.max(1, Math.round((hi - lo) * 0.02));
  lo -= pad;
  hi += pad;
  const span = hi - lo;
  const x = (d: number) => (d - lo) / span;
  const rows = placed.map((item) => ({ item, x0: x(dayNumber(item.start)), x1: x(dayNumber(item.end) + 1) }));
  const index = new Map(rows.map((r, k) => [r.item.id, k]));
  const arrows: GanttArrow[] = [];
  const missing: GanttLayout["missing"] = [];
  for (let k = 0; k < rows.length; k++)
    for (const dep of rows[k].item.deps) {
      const from = index.get(dep);
      if (from === undefined) {
        if (!undated.some((u) => u.id === dep)) missing.push({ item: rows[k].item.id, dep });
        continue;
      }
      arrows.push({ from, to: k, conflict: rows[k].item.start <= rows[from].item.end });
    }
  return { rows, arrows, ticks: ticksFor(lo, hi), from: dayString(lo), to: dayString(hi - 1), undated, missing, cycle: cycleOf(items) };
}

/** Axis ticks: weeks, months, years or decades, whichever gives 3–14 of them. */
export function ticksFor(lo: number, hi: number): GanttTick[] {
  const span = hi - lo;
  const unit: GanttTick["unit"] = span <= 70 ? "week" : span <= 900 ? "month" : span <= 365 * 25 ? "year" : "decade";
  const out: GanttTick[] = [];
  const first = new Date(lo * DAY);
  let y = first.getUTCFullYear();
  let m = first.getUTCMonth();
  if (unit === "week") {
    // Sundays (the Hebrew week starts on Sunday; ISO weeks differ, but a tick is a tick).
    let d = lo + ((7 - new Date(lo * DAY).getUTCDay()) % 7);
    for (; d < hi; d += 7) out.push({ at: (d - lo) / span, day: dayString(d), unit });
    return out;
  }
  const step = unit === "month" ? (span > 450 ? 3 : 1) : 1;
  if (unit === "decade") y = Math.ceil(y / 10) * 10;
  for (;;) {
    let d: number;
    if (unit === "month") {
      d = Math.floor(Date.UTC(y, m, 1) / DAY);
      m += step;
      if (m > 11) {
        y += Math.floor(m / 12);
        m %= 12;
      }
    } else {
      d = Math.floor(Date.UTC(y, 0, 1) / DAY);
      y += unit === "decade" ? 10 : span > 365 * 12 ? 2 : 1;
    }
    if (d >= hi) break;
    if (d >= lo) out.push({ at: (d - lo) / span, day: dayString(d), unit });
    if (out.length > 60) break;
  }
  return out;
}

/** Ids on a dependency cycle (each listed once). */
function cycleOf(items: readonly GanttItem[]): string[] {
  const deps = new Map(items.map((i) => [i.id, i.deps]));
  const state = new Map<string, 1 | 2>();
  const out = new Set<string>();
  const stack: string[] = [];
  const visit = (id: string) => {
    const s = state.get(id);
    if (s === 2) return;
    if (s === 1) {
      for (const x of stack.slice(stack.indexOf(id))) out.add(x);
      return;
    }
    state.set(id, 1);
    stack.push(id);
    for (const d of deps.get(id) ?? []) if (deps.has(d)) visit(d);
    stack.pop();
    state.set(id, 2);
  };
  for (const i of items) visit(i.id);
  return [...out];
}
