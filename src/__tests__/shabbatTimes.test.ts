/**
 * Plan W12.H8: Shabbat and yom tov times on the device, by NOAA's solar
 * equations, for a city picked by hand.
 *
 *  - Against an outside table for 5 cities and one year: |Δ| ≤ 1 minute.
 *    The table is built on a machine with network
 *    (scripts/zmanim/reference-shabbat-table.mjs → fixtures/shabbat-times/2026.json):
 *    owed to the Mac, skipped until it exists. The comparison code is tested
 *    on a SYNTHETIC table here (hand-written, labelled as such).
 *  - A consistency check, NOT the acceptance: sunset by a second,
 *    independent published formula (the US Naval Observatory's "Almanac for
 *    Computers", 1990), written here from its description, agrees within
 *    2 minutes for every city on 12 days of the year. It catches sign and
 *    unit mistakes, not the last minute.
 *  - 0 network requests, and no geolocation anywhere on the path.
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CITIES, candlesOn, cityById, isRestDay, localMidnight, restEnds, restWindowOn, shabbatClock, solarEventUtc, sunsetUtc, type City } from "../daily/shabbatTimes";
// @ts-expect-error -- plain .mjs module without type declarations
import { clockMinutes, compareTable, tableReport } from "../../scripts/zmanim/reference-lib.mjs";

const g = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
};
const city = (id: string) => cityById(id) as City;
/** Ours, as the table compares it: minutes after local midnight, unrounded. */
const ours = (id: string, iso: string, kind: "candles" | "havdalah") => {
  const c = city(id);
  const day = g(iso);
  const t = kind === "candles" ? candlesOn(day, c) : restEnds(day, c);
  return t === null ? null : (t - localMidnight(day, c.tz)) / 60_000;
};

/** USNO "Almanac for Computers" (1990) sunset, hours UT. */
function almanacSunsetUtcMinutes(day: { y: number; m: number; d: number }, lat: number, lon: number): number {
  const r = Math.PI / 180;
  const n = Math.round((Date.UTC(day.y, day.m - 1, day.d) - Date.UTC(day.y, 0, 0)) / 86_400_000);
  const lngHour = lon / 15;
  const t = n + (18 - lngHour) / 24;
  const M = 0.9856 * t - 3.289;
  const L = (((M + 1.916 * Math.sin(M * r) + 0.02 * Math.sin(2 * M * r) + 282.634) % 360) + 360) % 360;
  let RA = ((Math.atan(0.91764 * Math.tan(L * r)) / r) % 360 + 360) % 360;
  RA = (RA + (Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90)) / 15;
  const sinDec = 0.39782 * Math.sin(L * r);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.cos(90.833 * r) - sinDec * Math.sin(lat * r)) / (cosDec * Math.cos(lat * r));
  const H = Math.acos(cosH) / r / 15;
  const T = H + RA - 0.06571 * t - 6.622;
  return ((((T - lngHour) % 24) + 24) % 24) * 60;
}

afterEach(() => vi.unstubAllGlobals());

describe("sunset by NOAA's equations", () => {
  it("agrees within 2 minutes with an independent formula (USNO Almanac), every city, 12 days of 2026", () => {
    let worst = 0;
    for (const c of CITIES)
      for (let m = 1; m <= 12; m++) {
        const day = { y: 2026, m, d: 15 };
        const a = sunsetUtc(day, c)!;
        const b = almanacSunsetUtcMinutes(day, c.lat, c.lon);
        const diff = Math.abs((((a - b) % 1440) + 2160) % 1440 - 720);
        worst = Math.max(worst, diff);
        expect(diff, `${c.id} 2026-${m}-15`).toBeLessThanOrEqual(2);
      }
    // hygiene-allow: the measured agreement, for the PR's verification table
    console.log(`NOAA vs Almanac sunset, worst |Δ| ${worst.toFixed(2)} min`);
  });

  it("days are longer in June than in December north of the equator, and the other way round in Melbourne", () => {
    const len = (c: City, iso: string) => sunsetUtc(g(iso), c)! - solarEventUtc(g(iso), c.lat, c.lon, 90.833, "rise")!;
    expect(len(city("london"), "2026-06-21")).toBeGreaterThan(len(city("london"), "2026-12-21"));
    // Melbourne's sunset is later in the local clock in December.
    expect(shabbatClock(g("2026-12-18"), city("melbourne")).candles! > shabbatClock(g("2026-06-19"), city("melbourne")).candles!).toBe(true);
  });
});

describe("candle lighting and the end", () => {
  it("18 minutes before sunset, 40 in Jerusalem, 30 in Haifa, or what the user sets", () => {
    const fri = g("2026-11-20");
    const sunsetMs = (c: City) => Date.UTC(2026, 10, 20) + sunsetUtc(fri, c)! * 60_000;
    for (const [id, min] of [["tel-aviv", 18], ["jerusalem", 40], ["haifa", 30], ["new-york", 18]] as const) {
      expect(Math.round((sunsetMs(city(id)) - candlesOn(fri, city(id))!) / 60_000)).toBe(min);
    }
    expect(Math.round((sunsetMs(city("jerusalem")) - candlesOn(fri, city("jerusalem"), { candles: 20 })!) / 60_000)).toBe(20);
  });

  it("Shabbat in Jerusalem is from candle lighting on Friday to 8.5° on Saturday; Yom Kippur 5787 likewise", () => {
    const fri = restWindowOn(g("2026-11-20"), city("jerusalem"))!;
    const sat = restWindowOn(g("2026-11-21"), city("jerusalem"))!;
    expect(fri.why).toBe("shabbat");
    expect(fri.end).toBe(sat.start); // midnight between them
    expect(sat.end).toBe(restEnds(g("2026-11-21"), city("jerusalem")));
    expect(restWindowOn(g("2026-11-22"), city("jerusalem"))).toBeNull();
    const c = shabbatClock(g("2026-11-20"), city("jerusalem"));
    expect(c.candles).toMatch(/^1[56]:\d{2}$/);
    expect(c.ends).toMatch(/^17:\d{2}$/);
    // Yom Kippur 5787 is Monday 21 September 2026.
    expect(isRestDay(g("2026-09-21"), true)).toBe(true);
    expect(restWindowOn(g("2026-09-20"), city("jerusalem"))?.why).toBe("yom-kippur");
  });

  it("the second day of yom tov in the diaspora is lit at the end of the first", () => {
    // Shavuot 5786 in the diaspora: 22–23 May 2026 (Friday and Shabbat).
    const ny = city("new-york");
    expect(isRestDay(g("2026-05-22"), false)).toBe(true);
    expect(candlesOn(g("2026-05-22"), ny)).toBe(restEnds(g("2026-05-22"), ny));
  });
});

describe("the outside table (SYNTHETIC table here: hand-written in the table's shape, not anyone's data)", () => {
  it("reports the largest difference per city and each row over the tolerance, a printed minute counting as its whole minute", () => {
    const o = ours("tel-aviv", "2026-11-20", "candles")!;
    const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.floor(m) % 60).padStart(2, "0")}`;
    const synthetic = {
      version: 1,
      source: "SYNTHETIC — written by hand for this test",
      rows: [
        ["tel-aviv", "2026-11-20", "candles", hh(o)],
        ["tel-aviv", "2026-11-20", "candles", hh(o + 3)],
        ["nowhere", "2026-11-20", "candles", "16:00"],
      ],
    };
    const cmp = compareTable(synthetic, (id: string, iso: string, k: "candles" | "havdalah") => (cityById(id) ? ours(id, iso, k) : null));
    expect(cmp["tel-aviv"].rows).toBe(2);
    expect(cmp["tel-aviv"].over).toHaveLength(1);
    expect(cmp.nowhere.missing).toHaveLength(1);
    expect(clockMinutes("18:42")).toBe(1122);
    expect(tableReport(cmp)).toMatch(/tel-aviv: 2 rows/);
  });
});

const TABLE = join(__dirname, "fixtures/shabbat-times/2026.json");
describe("against the outside table, 5 cities, 2026 (built outside the app)", () => {
  // skip-reason: the outside reference table is built on a machine with network; without the fixture there is nothing to compare | task: W12.H8 | until: 2027-05-16
  it.skipIf(!existsSync(TABLE))("|Δ| ≤ 1 minute in every city", () => {
    const table = JSON.parse(readFileSync(TABLE, "utf8"));
    const cmp = compareTable(table, ours, 1);
    // hygiene-allow: the gap report, for the PR's verification table
    console.log(tableReport(cmp));
    expect(Object.keys(cmp).length).toBeGreaterThanOrEqual(5);
    for (const v of Object.values(cmp) as Array<{ over: unknown[]; missing: unknown[] }>) {
      expect(v.over).toEqual([]);
      expect(v.missing).toEqual([]);
    }
  });
});

describe("no network, no location", () => {
  it("0 requests while computing a year of times for every city", () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", (u: unknown) => {
      calls.push(String(u));
      throw new Error("network");
    });
    vi.stubGlobal("XMLHttpRequest", function () {
      calls.push("xhr");
    });
    for (const c of CITIES) for (let m = 1; m <= 12; m++) shabbatClock({ y: 2026, m, d: 1 }, c);
    expect(calls).toEqual([]);
  });

  it("nothing on the path asks for the device's position", () => {
    for (const f of ["src/daily/shabbatTimes.ts", "src/daily/timeBlocks.ts", "src/ui/DayTimeline.tsx", "src/ui/CalendarPanel.tsx"]) {
      expect(readFileSync(join(__dirname, "../..", f), "utf8"), f).not.toMatch(/geolocation|getCurrentPosition|watchPosition/);
    }
  });
});
