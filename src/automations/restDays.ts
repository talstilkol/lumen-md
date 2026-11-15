/**
 * Shabbat and yom tov for automations (plan W12.U2): a rule marked "not on
 * Shabbat or a holiday" waits on those days. Built on the app's own Hebrew
 * calendar and the rest-day rule of Israeli time (W5.15): Shabbat, and every
 * yom tov (Rosh Hashana, Yom Kippur, the first and last days of Sukkot and
 * Pesach, Shavuot; two days each outside Israel). Yom HaAtzmaut, a statutory
 * holiday but not a Shabbat-like day, does not stop a rule.
 *
 * Review Z7-M6: Shabbat and yom tov begin at sundown on the eve, not at
 * midnight. `restAt` answers "is it a day of rest now": with the city chosen
 * in the daily-notes settings, from candle lighting on the eve to the end of
 * the day (W12.H8's zmanim, ../daily/shabbatTimes.ts `restWindowOn`); without
 * a city, failing safe: the whole civil day of rest, and on the eve from
 * EVE_FALLBACK_HOUR (12:00, device time), well before any candle lighting.
 * `restDayOf` stays the civil-date answer (the calendar, `nextWorkday`).
 */
import { fixedOf, gregorianOf, holidaysOn, weekdayOf, SHABBAT } from "../daily/hebrewCalendar";
import { restWindowOn, type City } from "../daily/shabbatTimes";

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

/** Without a city, an eve counts as resting from this hour (device time): earlier than candle lighting anywhere. */
export const EVE_FALLBACK_HOUR = 12;

export interface RestAtOptions {
  /** Holidays as in Israel (default) or the diaspora. */
  israel?: boolean;
  /** The city of the daily-notes settings; null: unknown, so the fallback hour applies. */
  city?: City | null;
  /** Candle lighting, minutes before sunset (the user's setting); unset: the city's custom. */
  candles?: number;
}

/** The civil date of `ms` in time zone `tz` (YYYY-MM-DD). */
const dateIn = (ms: number, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);

/**
 * Is it Shabbat or a yom tov at `now` (epoch ms)? `today` is the device's civil date. With a city, by its zmanim:
 * from candle lighting on the eve to the end on the last day. Without one: the whole civil day of rest, and the eve
 * from EVE_FALLBACK_HOUR. `now` unknown: an eve counts as resting (fail safe).
 */
export function restAt(today: string, now: number | undefined, opts: RestAtOptions = {}): RestDay | null {
  const israel = opts.israel ?? true;
  const city = opts.city ?? null;
  if (city && now !== undefined) {
    const local = parse(dateIn(now, city.tz));
    if (local === null) return null;
    const w = restWindowOn(gregorianOf(local), city, { israel, ...(opts.candles !== undefined ? { candles: opts.candles } : {}) });
    if (!w || now < w.start || now >= w.end) return null;
    return w.why === "shabbat" ? { reason: "shabbat" } : { reason: "yomTov", holiday: w.why };
  }
  const day = restDayOf(today, israel);
  if (day) return day;
  const f = parse(today);
  if (f === null) return null;
  const eve = restDayOf(iso(f + 1), israel);
  if (!eve) return null;
  const hour = now === undefined ? 24 : new Date(now).getHours();
  return hour >= EVE_FALLBACK_HOUR ? eve : null;
}
