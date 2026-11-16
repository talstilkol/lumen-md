/**
 * A task's due date from its free text (plan R12.6, the "due date in a task"
 * use of hebrewDates.ts; audit r3: suggestDueDate was used nowhere), in
 * Hebrew and English:
 *   - a full date the text names: "עד 1/2/2027", "by December 3, 2026", "2026-12-05"
 *     (hebrewDates.extractDates, its rules: no day-and-month without a year);
 *   - a relative day: היום / מחר / מחרתיים, today / tonight / tomorrow /
 *     the day after tomorrow;
 *   - a weekday after a word that makes it a deadline: "ביום חמישי",
 *     "עד יום שישי", "בשבת", "on Friday", "by Monday", "next Tuesday",
 *     "this Sunday" — the next such day after today (today itself when the
 *     text says "today").
 * Past days are not suggested ("אתמול" is not a deadline). The result is a
 * suggestion: the stored form stays the obsidian-tasks `📅 YYYY-MM-DD`.
 */
import { suggestDueDate } from "../daily/hebrewDates";

const DAY_MS = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const at = (day: string) => Date.parse(`${day}T00:00:00Z`);

const EN_RELATIVE: Array<[RegExp, number]> = [
  [/\b(?:the\s+)?day\s+after\s+tomorrow\b/i, 2],
  [/\btomorrow\b/i, 1],
  [/\b(?:today|tonight)\b/i, 0],
];
const EN_DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const HE_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const EN_WEEKDAY = new RegExp(`\\b(?:on|by|before|until|till|next|this|due|coming)\\s+(${EN_DAYS.join("|")})\\b`, "i");
// "ביום חמישי", "עד יום שישי", "ליום ראשון", "בשבת", "עד שבת" — not "יום שני של החודש" style counts.
const HE_WEEKDAY = new RegExp(`(?:^|[\\s(])(?:(?:ב|ל|עד\\s+|לפני\\s+)יום\\s+(${HE_DAYS.slice(0, 6).join("|")})|(?:ב|עד\\s+)(שבת))(?=$|[\\s.,;:!?)])`, "u");

/** The next `weekday` (0 = Sunday) strictly after `today`. */
function nextWeekday(today: string, weekday: number): string {
  const t = at(today);
  const now = new Date(t).getUTCDay();
  const ahead = ((weekday - now + 7) % 7) || 7;
  return iso(t + ahead * DAY_MS);
}

/** The due date `description` names, as YYYY-MM-DD, or null. `today` is YYYY-MM-DD. */
export function dueFromText(description: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || Number.isNaN(at(today))) return null;
  const notPast = (d: string | null) => (d && at(d) >= at(today) ? d : null);
  const full = notPast(suggestDueDate(description, today));
  if (full) return full;
  for (const [re, off] of EN_RELATIVE) if (re.test(description)) return iso(at(today) + off * DAY_MS);
  const en = EN_WEEKDAY.exec(description);
  if (en) return nextWeekday(today, EN_DAYS.indexOf(en[1].toLowerCase()));
  const he = HE_WEEKDAY.exec(description);
  if (he) return nextWeekday(today, he[1] ? HE_DAYS.indexOf(he[1]) : 6);
  return null;
}
