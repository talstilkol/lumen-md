/**
 * Plan W2.10 (W10.E76): the Hebrew calendar 2010–2030 against an outside
 * table, with a report of every gap.
 *
 * The reference is built on a machine with network from Hebcal's public API
 * (node scripts/calendar/reference-from-hebcal.mjs: dates and our ids only)
 * into src/__tests__/fixtures/hebcal-reference/2010-2030.json. Until that file
 * exists the comparison is skipped; the conversion and the comparison
 * themselves are tested here on small, hand-written items in Hebcal's API
 * shape (labelled as such: not Hebcal's data).
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { calendarOfRange, PARASHOT, gregorianOf, type GDay } from "../daily/hebrewCalendar";
// @ts-expect-error — plain .mjs module without type declarations
import { compareCalendars, fromHebcal, gapReport, parashaIdOf } from "../../scripts/calendar/reference-lib.mjs";

const iso = (fixed: number) => {
  const g = gregorianOf(fixed);
  return `${g.y}-${String(g.m).padStart(2, "0")}-${String(g.d).padStart(2, "0")}`;
};
const g = (s: string): GDay => {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
};
/** Ours, in the fixture's shape. */
function ours(from: string, to: string, israel: boolean) {
  const r = calendarOfRange(g(from), g(to), { israel });
  return {
    holidays: r.holidays.map((h) => [iso(h.fixed), h.id] as [string, string]),
    readings: r.readings.filter((x) => x.parashot.length).map((x) => [iso(x.fixed), [...x.parashot]] as [string, string[]]),
  };
}

const ids = [...PARASHOT] as string[];

describe("converting Hebcal's items (hand-written items in the API's shape)", () => {
  it("maps titles to our ids; Chanukah by its days, not its candles; Chol HaMoed by family; Israel's one-day Shemini Atzeret", () => {
    const items = [
      { date: "2025-12-14", category: "holiday", title: "Chanukah: 1 Candle" },
      { date: "2025-12-15", category: "holiday", title: "Chanukah: 2 Candles" },
      { date: "2025-12-22", category: "holiday", title: "Chanukah: 8th Day" },
      { date: "2025-04-15", category: "holiday", title: "Pesach III (CH''M)" },
      { date: "2025-10-14", category: "holiday", title: "Shmini Atzeret" },
      { date: "2025-09-23", category: "holiday", title: "Rosh Hashana I" },
      { date: "2025-10-23", category: "roshchodesh", title: "Rosh Chodesh Cheshvan" },
      { date: "2025-03-29", category: "parashat", title: "Parashat Vayakhel-Pekudei" },
      { date: "2025-11-01", category: "parashat", title: "Parashat Lech-Lecha" },
      { date: "2025-03-13", category: "holiday", title: "Erev Purim" },
    ];
    const il = fromHebcal(items, { israel: true, parashaIds: ids });
    expect(il.holidays).toEqual([
      ["2025-12-15", "chanukah-1"],
      ["2025-12-22", "chanukah-8"],
      ["2025-04-15", "pesach-chm"],
      ["2025-10-14", "shemini-atzeret-simchat-torah"],
      ["2025-09-23", "rosh-hashana-1"],
      ["2025-10-23", "rosh-chodesh"],
    ]);
    expect(il.readings).toEqual([
      ["2025-03-29", ["vayakhel", "pekudei"]],
      ["2025-11-01", ["lech-lecha"]],
    ]);
    // A title with no id is reported, never guessed.
    expect(il.unmapped).toEqual(["Erev Purim"]);
    expect(fromHebcal([items[4]], { israel: false, parashaIds: ids }).holidays).toEqual([["2025-10-14", "shemini-atzeret"]]);
    expect(parashaIdOf("Nasso", ids)).toBe("nasso");
    expect(parashaIdOf("Ki Teitzei", ids)).toBe("ki-teitzei");
  });
});

describe("comparing (ours against itself, then with a planted gap)", () => {
  it("no gaps against itself; a moved date and a wrong portion are reported", () => {
    const mine = ours("2025-09-01", "2026-08-31", true);
    expect(mine.holidays.length).toBeGreaterThan(60);
    const same = compareCalendars(mine, mine);
    expect(same).toEqual({ missing: [], extra: [], readings: { mismatched: [], missing: [] } });
    const yk = mine.holidays.find(([, id]) => id === "yom-kippur")!;
    const moved = { holidays: mine.holidays.map(([d, id]) => (id === "yom-kippur" ? ["2025-10-03", id] : [d, id])), readings: mine.readings.map(([d, p], i) => (i === 3 ? [d, ["bereshit"]] : [d, p])) };
    const r = compareCalendars(mine, moved);
    expect(r.missing).toEqual(["2025-10-03 yom-kippur"]);
    expect(r.extra).toEqual([`${yk[0]} yom-kippur`]);
    expect(r.readings.mismatched).toHaveLength(1);
    expect(r.readings.mismatched[0]).toMatch(/reference bereshit$/);
    expect(gapReport({ israel: r })).toContain("## israel: 3 difference(s)");
  });
});

describe("the builder (scripts/calendar/reference-from-hebcal.mjs) on saved answers", () => {
  it("reads <year>-il.json / <year>-diaspora.json, keeps dates and ids, lists what it could not map", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { spawnSync } = await import("node:child_process");
    const dir = mkdtempSync(join(tmpdir(), "lumen-hebcal-"));
    try {
      const answer = { items: [{ date: "2025-10-02", category: "holiday", title: "Yom Kippur" }, { date: "2025-03-13", category: "holiday", title: "Erev Purim" }] };
      writeFileSync(join(dir, "2025-il.json"), JSON.stringify(answer));
      writeFileSync(join(dir, "2025-diaspora.json"), JSON.stringify(answer));
      const out = join(dir, "ref.json");
      const r = spawnSync(process.execPath, ["scripts/calendar/reference-from-hebcal.mjs", "--from", "2025", "--to", "2025", "--in", dir, "--out", out], { encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain("not mapped (left out): Erev Purim");
      const ref = JSON.parse(readFileSync(out, "utf8"));
      expect(ref.range).toEqual(["2025-01-01", "2025-12-31"]);
      expect(ref.israel.holidays).toEqual([["2025-10-02", "yom-kippur"]]);
      expect(JSON.stringify(ref)).not.toContain("Yom Kippur");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Until the Hebcal table exists: the 15 holiday anchors of the R12.6 gold
 * (fixtures/dates-he/gold.synthetic.json, rows with anchor=true; dates worked
 * out by hand and checked against published calendars, so they come from
 * outside this calendar's code) are an outside reference for 2023–2024
 * already. Each anchor's holiday must fall on its date in Israel, and a
 * multi-day holiday on each day of its span (R12.6 acceptance 3: "the anchor
 * rows are used by W10.E76 too").
 */
describe("the R12.6 holiday anchors as an outside reference (W10.E76 until the Hebcal table)", () => {
  const gold = JSON.parse(readFileSync("src/__tests__/fixtures/dates-he/gold.synthetic.json", "utf8")) as { cases: Array<{ text: string; anchor?: boolean; expect: Array<{ from: string; to: string; holiday?: string }> }> };
  const SPAN_END: Record<string, string> = { "rosh-hashana-1": "rosh-hashana-2", "sukkot-1": "hoshana-raba", "chanukah-1": "chanukah-8", "pesach-1": "pesach-7" };
  const anchors = gold.cases.filter((c) => c.anchor).flatMap((c) => c.expect.filter((e) => e.holiday).map((e) => ({ ...e, text: c.text })));

  it("has the 15 anchors, each naming a holiday the calendar knows", () => {
    expect(anchors).toHaveLength(15);
    const known = new Set(ours("2023-01-01", "2024-12-31", true).holidays.map(([, id]) => id));
    for (const a of anchors) expect(known.has(a.holiday!), a.holiday).toBe(true);
  });

  it("every anchor's holiday is on the anchor's date, and a span covers its days, with no gap", () => {
    const gaps: string[] = [];
    for (const a of anchors) {
      const on = (day: string) => ours(day, day, true).holidays.map(([, id]) => id);
      if (!on(a.from).includes(a.holiday!)) gaps.push(`${a.holiday}: not on ${a.from} (there: ${on(a.from).join(", ") || "nothing"}) — ${a.text}`);
      // A span (Rosh Hashana, Sukkot, Chanukah, Pesach in Israel): its last day is on the span's end.
      if (a.to !== a.from) {
        const last = SPAN_END[a.holiday!];
        if (!last) gaps.push(`${a.holiday}: a span with no known last day`);
        else if (!on(a.to).includes(last)) gaps.push(`${last}: not on ${a.to}, the end of the span — ${a.text}`);
      }
    }
    expect(gaps).toEqual([]);
  });
});

const FIXTURE = "src/__tests__/fixtures/hebcal-reference/2010-2030.json";

// skip-reason: the reference table is fetched from Hebcal on a machine with network (scripts/calendar/reference-from-hebcal.mjs) | task: W2.10 | until: 2027-05-12
describe.skipIf(!existsSync(FIXTURE))("2010–2030 against the reference table", () => {
  it("every holiday, fast, Rosh Chodesh and weekly portion on the reference's date, Israel and the diaspora; the gaps go to a report", () => {
    const ref = JSON.parse(readFileSync(FIXTURE, "utf8"));
    const [from, to] = ref.range as [string, string];
    const results = { israel: compareCalendars(ours(from, to, true), ref.israel), diaspora: compareCalendars(ours(from, to, false), ref.diaspora) };
    mkdirSync("test-results/hebcal-reference", { recursive: true });
    writeFileSync("test-results/hebcal-reference/report.md", gapReport(results));
    expect(results).toEqual({
      israel: { missing: [], extra: [], readings: { mismatched: [], missing: [] } },
      diaspora: { missing: [], extra: [], readings: { mismatched: [], missing: [] } },
    });
  });
});
