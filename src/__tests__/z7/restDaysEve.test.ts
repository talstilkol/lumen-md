// @vitest-environment node
/**
 * Review Z7-M6 (#938): a rule marked "not on Shabbat or a holiday" ran on Friday night and on the eve of every
 * yom tov, because the check used the civil date. It now treats Shabbat and yom tov as starting at candle lighting
 * on the eve, by the daily-notes city's zmanim (daily/shabbatTimes.ts), and without a city it fails safe: the eve
 * rests from 12:00.
 */
import { describe, expect, it } from "vitest";
import { EVE_FALLBACK_HOUR, restAt, restDayOf } from "../../automations/restDays";
import { plan, type Rule, type VaultEvent } from "../../automations/engine";
import { candleLighting, cityById, restEnds } from "../../daily/shabbatTimes";

const JERUSALEM = cityById("jerusalem")!;
const NEW_YORK = cityById("new-york")!;
/** Local clock time in a time zone → epoch ms (Asia/Jerusalem is UTC+2 in November, UTC+3 in September/April). */
const at = (isoUtc: string) => Date.parse(isoUtc);
const localHour = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h, 0).getTime();

describe("Z7-M6: with a city, rest starts at candle lighting on the eve", () => {
  it("Friday 2026-11-13 in Jerusalem: 10:00 is a weekday, 20:00 is Shabbat (the reviewer's case)", () => {
    expect(restAt("2026-11-13", at("2026-11-13T08:00:00Z"), { city: JERUSALEM })).toBeNull();
    expect(restAt("2026-11-13", at("2026-11-13T18:00:00Z"), { city: JERUSALEM })).toEqual({ reason: "shabbat" });
  });

  it("a minute before and after candle lighting", () => {
    const fri = { y: 2026, m: 11, d: 13 };
    const c = candleLighting(fri, JERUSALEM)!;
    expect(restAt("2026-11-13", c - 60_000, { city: JERUSALEM })).toBeNull();
    expect(restAt("2026-11-13", c + 60_000, { city: JERUSALEM })).toEqual({ reason: "shabbat" });
    // The user's own candle-lighting minutes move the start.
    expect(restAt("2026-11-13", c + 60_000, { city: JERUSALEM, candles: 10 })).toBeNull();
  });

  it("Saturday night: after the end of Shabbat a rule runs again", () => {
    const end = restEnds({ y: 2026, m: 11, d: 14 }, JERUSALEM)!;
    expect(restAt("2026-11-14", end - 60_000, { city: JERUSALEM })).toEqual({ reason: "shabbat" });
    expect(restAt("2026-11-14", end + 60_000, { city: JERUSALEM })).toBeNull();
  });

  it("the eve of Yom Kippur and of Pesach, in the evening, are yom tov", () => {
    const yk = "2026-09-21";
    expect(restDayOf(yk)).toMatchObject({ reason: "yomTov" });
    expect(restAt("2026-09-20", at("2026-09-20T17:30:00Z"), { city: JERUSALEM })).toMatchObject({ reason: "yomTov" });
    expect(restAt("2026-09-20", at("2026-09-20T09:00:00Z"), { city: JERUSALEM })).toBeNull();
    expect(restDayOf("2026-04-02")).toMatchObject({ reason: "yomTov" });
    expect(restAt("2026-04-01", at("2026-04-01T17:30:00Z"), { city: JERUSALEM })).toMatchObject({ reason: "yomTov" });
  });

  it("a city's own time zone decides the day (New York's Friday evening is still Friday there)", () => {
    // 2026-11-14 00:30 UTC is Friday 19:30 in New York: Shabbat there.
    expect(restAt("2026-11-14", at("2026-11-14T00:30:00Z"), { city: NEW_YORK, israel: false })).toEqual({ reason: "shabbat" });
  });
});

describe("Z7-M6: without a city, the eve fails safe from the fallback hour", () => {
  it(`Friday before ${EVE_FALLBACK_HOUR}:00 runs; from ${EVE_FALLBACK_HOUR}:00 it waits; Saturday waits all day`, () => {
    expect(restAt("2026-11-13", localHour(2026, 11, 13, EVE_FALLBACK_HOUR - 1))).toBeNull();
    expect(restAt("2026-11-13", localHour(2026, 11, 13, EVE_FALLBACK_HOUR))).toEqual({ reason: "shabbat" });
    expect(restAt("2026-11-13", localHour(2026, 11, 13, 20))).toEqual({ reason: "shabbat" });
    expect(restAt("2026-11-14", localHour(2026, 11, 14, 22))).toEqual({ reason: "shabbat" });
    expect(restAt("2026-11-12", localHour(2026, 11, 12, 20))).toBeNull(); // Thursday evening
  });
  it("no time given: an eve rests (fail safe)", () => {
    expect(restAt("2026-11-13", undefined)).toEqual({ reason: "shabbat" });
  });
});

describe("Z7-M6: the engine postpones a rule on Friday night", () => {
  it("a note changed at 20:00 on Friday in Jerusalem: the rule waits until Sunday, nothing is written", () => {
    const rules: Rule[] = [{ id: "tagit", name: "tagit", enabled: true, notOnRestDays: true, when: { kind: "created" }, then: [{ kind: "tag", tag: "t" }] }];
    const files = new Map([["a.md", "x"]]);
    const ev: VaultEvent = { kind: "created", path: "a.md", text: "x" };
    const ctx = { vault: { read: (p: string) => files.get(p) ?? null, exists: (p: string) => files.has(p) }, dailyPath: (d: string) => `Daily/${d}.md`, today: "2026-11-13" };
    const night = plan(rules, ev, { ...ctx, now: at("2026-11-13T18:00:00Z"), city: JERUSALEM });
    expect(night.changes).toEqual([]);
    expect(night.postponed).toMatchObject([{ rule: "tagit", why: { reason: "shabbat" }, until: "2026-11-15" }]);
    const morning = plan(rules, ev, { ...ctx, now: at("2026-11-13T07:00:00Z"), city: JERUSALEM });
    expect(morning.postponed).toEqual([]);
    expect(morning.changes).toHaveLength(1);
  });
});
