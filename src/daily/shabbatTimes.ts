/**
 * Shabbat and yom tov times on the device (plan W12.H8): sunset by NOAA's
 * solar calculator equations (public domain:
 * gml.noaa.gov/grad/solcalc/calcdetails.html, after Meeus, "Astronomical
 * Algorithms"), candle lighting a set number of minutes before sunset
 * (18; 40 in Jerusalem and 30 in Haifa by local custom; the user can
 * change it), and the end of Shabbat when the sun is a set angle below the
 * horizon (8.5° by default, three small stars).
 *
 * Location: a city the user picks from the list below, never the device's
 * position. No network: everything here is arithmetic.
 *
 * Times are minutes after the civil day's 00:00 UTC (they can be negative
 * or above 1,440 for cities far from Greenwich), turned into a local clock
 * time with Intl in the city's time zone.
 */
import { fixedOf, gregorianOf, holidaysOn, weekdayOf, SHABBAT, type GDay } from "./hebrewCalendar";

export interface City {
  id: string;
  he: string;
  en: string;
  lat: number;
  /** East positive. */
  lon: number;
  tz: string;
  /** Candle lighting, minutes before sunset, by the city's custom. */
  candles: number;
  israel: boolean;
}

/** The cities to pick from (coordinates of the city centre). */
export const CITIES: readonly City[] = [
  { id: "jerusalem", he: "ירושלים", en: "Jerusalem", lat: 31.7683, lon: 35.2137, tz: "Asia/Jerusalem", candles: 40, israel: true },
  { id: "tel-aviv", he: "תל אביב", en: "Tel Aviv", lat: 32.0853, lon: 34.7818, tz: "Asia/Jerusalem", candles: 18, israel: true },
  { id: "haifa", he: "חיפה", en: "Haifa", lat: 32.794, lon: 34.9896, tz: "Asia/Jerusalem", candles: 30, israel: true },
  { id: "beer-sheva", he: "באר שבע", en: "Beersheba", lat: 31.252, lon: 34.7915, tz: "Asia/Jerusalem", candles: 18, israel: true },
  { id: "eilat", he: "אילת", en: "Eilat", lat: 29.5577, lon: 34.9519, tz: "Asia/Jerusalem", candles: 18, israel: true },
  { id: "tzfat", he: "צפת", en: "Safed", lat: 32.9646, lon: 35.496, tz: "Asia/Jerusalem", candles: 18, israel: true },
  { id: "bnei-brak", he: "בני ברק", en: "Bnei Brak", lat: 32.0807, lon: 34.8338, tz: "Asia/Jerusalem", candles: 18, israel: true },
  { id: "ashdod", he: "אשדוד", en: "Ashdod", lat: 31.8044, lon: 34.6553, tz: "Asia/Jerusalem", candles: 18, israel: true },
  { id: "netanya", he: "נתניה", en: "Netanya", lat: 32.3215, lon: 34.8532, tz: "Asia/Jerusalem", candles: 18, israel: true },
  { id: "tiberias", he: "טבריה", en: "Tiberias", lat: 32.7922, lon: 35.5312, tz: "Asia/Jerusalem", candles: 18, israel: true },
  { id: "new-york", he: "ניו יורק", en: "New York", lat: 40.7128, lon: -74.006, tz: "America/New_York", candles: 18, israel: false },
  { id: "los-angeles", he: "לוס אנג׳לס", en: "Los Angeles", lat: 34.0522, lon: -118.2437, tz: "America/Los_Angeles", candles: 18, israel: false },
  { id: "toronto", he: "טורונטו", en: "Toronto", lat: 43.6532, lon: -79.3832, tz: "America/Toronto", candles: 18, israel: false },
  { id: "london", he: "לונדון", en: "London", lat: 51.5074, lon: -0.1278, tz: "Europe/London", candles: 18, israel: false },
  { id: "paris", he: "פריז", en: "Paris", lat: 48.8566, lon: 2.3522, tz: "Europe/Paris", candles: 18, israel: false },
  { id: "moscow", he: "מוסקבה", en: "Moscow", lat: 55.7558, lon: 37.6173, tz: "Europe/Moscow", candles: 18, israel: false },
  { id: "buenos-aires", he: "בואנוס איירס", en: "Buenos Aires", lat: -34.6037, lon: -58.3816, tz: "America/Argentina/Buenos_Aires", candles: 18, israel: false },
  { id: "johannesburg", he: "יוהנסבורג", en: "Johannesburg", lat: -26.2041, lon: 28.0473, tz: "Africa/Johannesburg", candles: 18, israel: false },
  { id: "melbourne", he: "מלבורן", en: "Melbourne", lat: -37.8136, lon: 144.9631, tz: "Australia/Melbourne", candles: 18, israel: false },
];
export const cityById = (id: string | undefined | null): City | null => CITIES.find((c) => c.id === id) ?? null;

// ── NOAA ────────────────────────────────────────────────────────────────

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const julianDay = (day: GDay) => Date.UTC(day.y, day.m - 1, day.d) / 86_400_000 + 2_440_587.5;

/** Declination (degrees) and the equation of time (minutes) at Julian century `t`. */
function sun(t: number): { decl: number; eqTime: number } {
  const l0 = (((280.46646 + t * (36000.76983 + 0.0003032 * t)) % 360) + 360) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c = Math.sin(rad(m)) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(rad(2 * m)) * (0.019993 - 0.000101 * t) + Math.sin(rad(3 * m)) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const meanObliq = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(rad(omega));
  const decl = deg(Math.asin(Math.sin(rad(obliq)) * Math.sin(rad(lambda))));
  const y = Math.tan(rad(obliq / 2)) ** 2;
  const eqTime =
    4 * deg(y * Math.sin(2 * rad(l0)) - 2 * e * Math.sin(rad(m)) + 4 * e * y * Math.sin(rad(m)) * Math.cos(2 * rad(l0)) - 0.5 * y * y * Math.sin(4 * rad(l0)) - 1.25 * e * e * Math.sin(2 * rad(m)));
  return { decl, eqTime };
}

/**
 * When the sun's centre reaches `zenith` degrees from the zenith, in the
 * morning ("rise") or the evening ("set"): minutes after 00:00 UTC of the
 * civil day, or null when it doesn't that day (polar day or night).
 * 90.833° is sunrise/sunset (refraction and the sun's radius).
 */
export function solarEventUtc(day: GDay, lat: number, lon: number, zenith: number, which: "rise" | "set"): number | null {
  const jd = julianDay(day);
  let minutes = 720 - 4 * lon; // solar noon, first guess
  for (let i = 0; i < 3; i++) {
    const { decl, eqTime } = sun((jd + minutes / 1440 - 2_451_545) / 36_525);
    const cosHa = Math.cos(rad(zenith)) / (Math.cos(rad(lat)) * Math.cos(rad(decl))) - Math.tan(rad(lat)) * Math.tan(rad(decl));
    if (cosHa > 1 || cosHa < -1) return null;
    const ha = deg(Math.acos(cosHa)) * (which === "rise" ? 1 : -1);
    minutes = 720 - 4 * (lon + ha) - eqTime;
  }
  return minutes;
}

export const SUNSET_ZENITH = 90.833;
export const sunsetUtc = (day: GDay, city: Pick<City, "lat" | "lon">) => solarEventUtc(day, city.lat, city.lon, SUNSET_ZENITH, "set");

// ── Shabbat and yom tov ─────────────────────────────────────────────────

export interface ShabbatOptions {
  /** Minutes before sunset; unset: the city's custom. */
  candles?: number;
  /** The end: the sun this many degrees below the horizon (default 8.5), or a fixed number of minutes after sunset. */
  end?: { degrees: number } | { minutes: number };
  /** Holidays as in Israel; unset: the city's country. */
  israel?: boolean;
}

/** An instant as epoch milliseconds, from minutes after the day's 00:00 UTC. */
const instant = (day: GDay, minutes: number) => Date.UTC(day.y, day.m - 1, day.d) + Math.round(minutes * 60_000);

/** Candle lighting on `day` (epoch ms), or null when there is no sunset. */
export function candleLighting(day: GDay, city: City, opts: ShabbatOptions = {}): number | null {
  const s = sunsetUtc(day, city);
  return s === null ? null : instant(day, s - (opts.candles ?? city.candles));
}

/**
 * The time to light on `day` for the rest day that follows: before sunset
 * on an ordinary eve, at the end of the first day when the day is itself a
 * rest day (the second day of yom tov, or yom tov after Shabbat).
 */
export function candlesOn(day: GDay, city: City, opts: ShabbatOptions = {}): number | null {
  return isRestDay(day, opts.israel ?? city.israel) ? restEnds(day, city, opts) : candleLighting(day, city, opts);
}

/** The end of Shabbat or yom tov on `day` (epoch ms). */
export function restEnds(day: GDay, city: City, opts: ShabbatOptions = {}): number | null {
  const end = opts.end ?? { degrees: 8.5 };
  if ("minutes" in end) {
    const s = sunsetUtc(day, city);
    return s === null ? null : instant(day, s + end.minutes);
  }
  const t = solarEventUtc(day, city.lat, city.lon, 90 + end.degrees, "set");
  return t === null ? null : instant(day, t);
}

/** Is the day itself Shabbat or a yom tov (a day of rest)? */
export function isRestDay(day: GDay, israel: boolean): boolean {
  return weekdayOf(fixedOf(day)) === SHABBAT || holidaysOn(day, { israel }).some((h) => h.yomTov === true);
}

/** Start of the day in the city's time zone, as epoch ms (found by stepping Intl; no library). */
export function localMidnight(day: GDay, tz: string): number {
  const guess = Date.UTC(day.y, day.m - 1, day.d);
  const offset = (t: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(t).map((x) => [x.type, x.value]));
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute)) - t;
  };
  let t = guess - offset(guess);
  t = guess - offset(t);
  return t;
}

export interface RestWindow {
  /** Epoch ms. */
  start: number;
  end: number;
  /** "shabbat" or the yom tov's id. */
  why: string;
}

/**
 * The part of the civil `day` (in the city's time zone) that is Shabbat or
 * yom tov: from candle lighting on the eve, to the end on the last day.
 * Null when none of the day is.
 */
export function restWindowOn(day: GDay, city: City, opts: ShabbatOptions = {}): RestWindow | null {
  const israel = opts.israel ?? city.israel;
  const f = fixedOf(day);
  const next = gregorianOf(f + 1);
  const today = isRestDay(day, israel);
  const tomorrow = isRestDay(next, israel);
  const dayStart = localMidnight(day, city.tz);
  const dayEnd = localMidnight(next, city.tz);
  const why = (d: GDay) => (weekdayOf(fixedOf(d)) === SHABBAT ? "shabbat" : holidaysOn(d, { israel }).find((h) => h.yomTov)?.id ?? "yom-tov");
  if (today) {
    const end = tomorrow ? dayEnd : restEnds(day, city, opts) ?? dayEnd;
    return { start: dayStart, end, why: why(day) };
  }
  if (tomorrow) {
    const start = candleLighting(day, city, opts) ?? dayEnd;
    return { start, end: dayEnd, why: why(next) };
  }
  return null;
}

/** "18:42" in the city's time zone. */
export const clock = (ms: number, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);

/** Candle lighting and the end, as clock times rounded the careful way: lighting down, the end up. */
export function shabbatClock(friday: GDay, city: City, opts: ShabbatOptions = {}): { candles: string | null; ends: string | null } {
  const c = candleLighting(friday, city, opts);
  const sat = gregorianOf(fixedOf(friday) + 1);
  const e = restEnds(sat, city, opts);
  const floorMin = (ms: number) => Math.floor(ms / 60_000) * 60_000;
  const ceilMin = (ms: number) => Math.ceil(ms / 60_000) * 60_000;
  return { candles: c === null ? null : clock(floorMin(c), city.tz), ends: e === null ? null : clock(ceilMin(e), city.tz) };
}
