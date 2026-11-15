/**
 * Shabbat and yom tov for automations (plan W12.U2): a rule marked "not on
 * Shabbat or a holiday" waits on those days. Built on the app's own Hebrew
 * calendar and the rest-day rule of Israeli time (W5.15): Shabbat, and every
 * yom tov (Rosh Hashana, Yom Kippur, the first and last days of Sukkot and
 * Pesach, Shavuot; two days each outside Israel). Yom HaAtzmaut, a statutory
 * holiday but not a Shabbat-like day, does not stop a rule.
 *
 * Days are civil dates: a run that waits over Shabbat runs on the first run
 * after the date changes (Saturday night after midnight, or the morning after
 * at the latest). The exact end of Shabbat (tzeit) needs sunset times for a
 * place, which plan W12.H8 adds.
 */
import { fixedOf, gregorianOf, holidaysOn, weekdayOf, SHABBAT } from "../daily/hebrewCalendar";

const iso = (fixed: number) => {
  const d = gregorianOf(fixed);
  return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
};

function parse(isoDate: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  return m ? fixedOf({ y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }) : null;
}

export interface RestDay {
  reason: "shabbat" | "yomTov";
  /** The holiday's id when it is a yom tov (`rosh-hashana-1`, `pesach-1`, …). */
  holiday?: string;
}

/** Why `isoDate` is Shabbat or a yom tov, or null for a weekday. */
export function restDayOf(isoDate: string, israel = true): RestDay | null {
  const fixed = parse(isoDate);
  if (fixed === null) return null;
  const yomTov = holidaysOn(gregorianOf(fixed), { israel }).find((h) => h.yomTov === true);
  if (yomTov) return { reason: "yomTov", holiday: yomTov.id };
  if (weekdayOf(fixed) === SHABBAT) return { reason: "shabbat" };
  return null;
}

/** The first date after `isoDate` that is neither Shabbat nor a yom tov. */
export function nextWorkday(isoDate: string, israel = true): string {
  const start = parse(isoDate);
  if (start === null) return isoDate;
  // The longest run is three days (Rosh Hashana on Thursday–Friday, then Shabbat), four in the diaspora.
  for (let f = start + 1; f < start + 10; f++) if (!restDayOf(iso(f), israel)) return iso(f);
  return iso(start + 1);
}
