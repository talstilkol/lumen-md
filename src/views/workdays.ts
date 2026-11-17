/**
 * Working days in formulas and rollups (plan W5.15 step 3, W10.C26): the
 * same count as the deadline hint in date cells (`workingDaysUntil`,
 * daily/israeliTime.ts), so a table, a base and a cell agree. A working day
 * is one that is neither a weekend day of the work week nor a holiday
 * (Israel's holidays, one day of yom tov). The work week is Sunday–Thursday
 * unless the formula says "mon-fri".
 *
 * The count is of the working days after `from`, up to and including `to`
 * (tomorrow, if it is a working day, is 1); negative when `to` is earlier.
 */
import { dayOfValue, workingDaysUntil, type WorkWeek } from "../daily/israeliTime";

function weekOf(w: unknown): WorkWeek | null {
  if (w === undefined || w === null || w === "") return "sun-thu";
  return w === "sun-thu" || w === "mon-fri" ? w : null;
}

/** workdays(from, to[, "sun-thu" | "mon-fri"]); null when a date is missing or not a date. */
export function workdaysBetween(from: unknown, to: unknown, week?: unknown): number | null {
  const a = dayOfValue(from);
  const b = dayOfValue(to);
  const workWeek = weekOf(week);
  if (!a || !b || !workWeek) return null;
  return workingDaysUntil(a, b, { israel: workWeek === "sun-thu", workWeek });
}

/** Working days from `now`'s day (UTC, as the formulas' today()) until `to`. */
export function workdaysUntil(to: unknown, now: Date, week?: unknown): number | null {
  return workdaysBetween(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), to, week);
}
