/**
 * Plan W12.V5: the Hebrew-calendar view — a month grid of the Hebrew
 * calendar (Adar I and Adar II in a leap year) for Bases and the daily
 * notes, and an activity heatmap by Hebrew month, without ECharts'
 * Gregorian `calendar`.
 *
 * The year 5787 (תשפ״ז, Sept 2026 – Sept 2027) is a leap year. Its 13 months
 * are checked against ICU's Hebrew calendar (`Intl.DateTimeFormat` with
 * `-u-ca-hebrew`), an implementation independent of ours, and — once
 * W10.E76's Hebcal table is in the repo — against that table's Rosh Chodesh
 * dates. The notes are SYNTHETIC.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { act, fireEvent, render } from "@testing-library/react";
import axe from "axe-core";
import { hebrewActivity, hebrewMonthGrid, hebrewYearMonths, isoOfFixed, stepMonth } from "../viz/hebrewMonthModel";
import HebrewMonthView, { gridKey } from "../viz/HebrewMonthView";
import HebrewCalendarPanel from "../viz/HebrewCalendarPanel";
import { itemsByDay } from "../viz/BaseHebrewCalendarView";
import { parseHebrewCalendarBlock } from "../viz/HebrewCalendarBlock";
import { chartOption, chartTable, optionNumbers } from "../viz/chartModel";
import { ADAR_I, ADAR_II, NISAN, TISHREI, daysInYear } from "../daily/hebrewCalendar";
import { basesFileFromText, parseBase, runBase } from "../views/bases/base";

const ICU = new Intl.DateTimeFormat("en-u-ca-hebrew", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const icu = (iso: string) => ICU.format(new Date(`${iso}T12:00:00Z`));

describe("5787 (leap) month by month (W12.V5)", () => {
  const months = hebrewYearMonths(5787, "he");
  it("13 months, Tishrei to Elul, with Adar I and Adar II", () => {
    expect(months.map((m) => m.name)).toEqual(["תשרי", "חשוון", "כסלו", "טבת", "שבט", "אדר א׳", "אדר ב׳", "ניסן", "אייר", "סיוון", "תמוז", "אב", "אלול"]);
    expect(months[0].firstIso).toBe("2026-09-12");
    expect(months.reduce((s, m) => s + m.days, 0)).toBe(daysInYear(5787));
    expect(daysInYear(5787)).toBeGreaterThanOrEqual(383);
  });

  it("each month's 1st and last day agree with ICU's Hebrew calendar", () => {
    const icuMonth = ["Tishri", "Heshvan", "Kislev", "Tevet", "Shevat", "Adar I", "Adar II", "Nisan", "Iyar", "Sivan", "Tamuz", "Av", "Elul"];
    months.forEach((m, i) => {
      expect(icu(m.firstIso), m.name).toBe(`1 ${icuMonth[i]} 5787`);
      expect(icu(isoOfFixed(m.first + m.days - 1)), m.name).toBe(`${m.days} ${icuMonth[i]} 5787`);
    });
  });

  it("the grid: weeks from Sunday, holidays and readings on their days", () => {
    const g = hebrewMonthGrid(5787, TISHREI, { israel: true, lang: "he" });
    expect(g.cells.length).toBe(30);
    expect(g.weeks[0].slice(0, 6)).toEqual([null, null, null, null, null, null]); // 1 Tishrei 5787 is a Shabbat
    expect(g.weeks[0][6]?.dayLabel).toBe("א׳");
    expect(g.cells[0].holidays.join(" ")).toContain("ראש השנה");
    expect(g.cells[9].holidays.join(" ")).toContain("יום כיפור");
    expect(g.yearLabel).toBe("תשפ״ז");
    const adar2 = hebrewMonthGrid(5787, ADAR_II, { israel: true, lang: "he" });
    expect(adar2.name).toBe("אדר ב׳");
    expect(adar2.cells[13].holidays.join(" ")).toContain("פורים");
    expect(hebrewMonthGrid(5787, ADAR_I, { israel: true, lang: "he" }).cells[13].holidays.join(" ")).toContain("פורים קטן");
  });

  it("months step across Adar I/II and the year's end", () => {
    expect(stepMonth(5787, ADAR_I, 1)).toEqual({ year: 5787, month: ADAR_II });
    expect(stepMonth(5787, ADAR_II, 1)).toEqual({ year: 5787, month: NISAN });
    expect(stepMonth(5786, ADAR_I, 1)).toEqual({ year: 5786, month: NISAN }); // 5786 is not a leap year
    expect(stepMonth(5787, TISHREI, -1)).toEqual({ year: 5786, month: 6 }); // Elul 5786
  });
});

const FIXTURE = "src/__tests__/fixtures/hebcal-reference/2010-2030.json";
// skip-reason: W10.E76's Hebcal table is fetched on a machine with network (scripts/calendar/reference-from-hebcal.mjs) | task: W12.V5 | until: 2027-05-12
describe.skipIf(!existsSync(FIXTURE))("5787 against W10.E76's reference table", () => {
  it("every month after Tishrei begins on a Rosh Chodesh of the table", () => {
    const ref = JSON.parse(readFileSync(FIXTURE, "utf8")) as { israel: { holidays: Array<[string, string]> } };
    const rc = new Set(ref.israel.holidays.filter(([, id]) => id === "rosh-chodesh").map(([d]) => d));
    for (const m of hebrewYearMonths(5787, "en").slice(1)) expect(rc.has(m.firstIso), m.name).toBe(true);
  });
});

describe("activity by Hebrew month", () => {
  const byDay = new Map([
    ["2026-09-12", 2], // 1 Tishrei
    ["2027-02-08", 1], // 1 Adar I
    ["2027-03-10", 3], // 1 Adar II
    ["2027-03-23", 1], // 14 Adar II
    ["2025-01-01", 9], // another year: left out
  ]);
  const data = hebrewActivity(byDay, 5787, "he");
  it("rows are the 13 months, columns days 1–30; a day outside the year is left out", () => {
    expect(data.ys.length).toBe(13);
    expect(data.xs.length).toBe(30);
    expect(data.cells).toEqual([
      [0, 0, 2],
      [0, 5, 1],
      [0, 6, 3],
      [13, 6, 1],
    ]);
  });
  it("RTL: day 1 on the right; the table holds exactly the drawn numbers", () => {
    const o = chartOption(data, { dir: "rtl", description: "d", labels: { x: "יום", y: "מספר", series: "חודש" } }) as any;
    expect(o.xAxis.inverse).toBe(true);
    const table = chartTable(data, { x: "יום", y: "מספר", series: "חודש" });
    expect(table.rows.length).toBe(13);
    const fromTable = table.rows.flatMap((r) => r.filter((v): v is number => typeof v === "number"));
    expect(optionNumbers(o).sort()).toEqual(fromTable.sort());
  });
  it("no ECharts calendar coordinate anywhere", () => {
    const o = chartOption(data, { dir: "rtl", description: "d", labels: { x: "a", y: "b" } }) as any;
    expect(o.calendar).toBeUndefined();
    expect(o.series.every((s: any) => s.coordinateSystem !== "calendar")).toBe(true);
  });
});

describe("the month grid: keyboard and axe", () => {
  it("arrows are mirrored in RTL; PageDown is the next month", () => {
    expect(gridKey("ArrowLeft", "rtl")).toEqual({ days: 1 });
    expect(gridKey("ArrowLeft", "ltr")).toEqual({ days: -1 });
    expect(gridKey("PageDown", "rtl")).toEqual({ month: 1 });
  });

  for (const dir of ["rtl", "ltr"] as const)
    it(`${dir}: one tab stop; ← / → by a day, ↓ by a week, crossing into Adar II; Enter opens the day; axe clean`, async () => {
      const opened: string[] = [];
      const { container } = render(
        <div dir={dir} lang={dir === "rtl" ? "he" : "en"}>
          <HebrewMonthView year={5787} month={ADAR_I} israel lang={dir === "rtl" ? "he" : "en"} locale={dir === "rtl" ? "he" : "en"} dir={dir} onDay={(iso) => opened.push(iso)} focusIso="2027-03-08" />
        </div>,
      );
      const cells = () => [...container.querySelectorAll('[role="gridcell"]')] as HTMLElement[];
      expect(cells().filter((c) => c.tabIndex === 0).map((c) => c.dataset.iso)).toEqual(["2027-03-08"]); // 29 Adar I
      const press = (key: string) =>
        act(() => {
          fireEvent.keyDown(document.activeElement!, { key });
        });
      cells().find((c) => c.tabIndex === 0)!.focus();
      press(dir === "rtl" ? "ArrowLeft" : "ArrowRight"); // 30 Adar I
      expect((document.activeElement as HTMLElement).dataset.iso).toBe("2027-03-09");
      press(dir === "rtl" ? "ArrowLeft" : "ArrowRight"); // 1 Adar II: the grid moves on
      expect((document.activeElement as HTMLElement).dataset.iso).toBe("2027-03-10");
      expect(container.querySelector("[data-hebrew-month]")!.getAttribute("data-hebrew-month")).toBe(`5787-${ADAR_II}`);
      press("ArrowDown");
      expect((document.activeElement as HTMLElement).dataset.iso).toBe("2027-03-17");
      press("Enter");
      expect(opened).toEqual(["2027-03-17"]);
      expect((await axe.run(container, { resultTypes: ["violations"] })).violations.map((v) => v.id)).toEqual([]);
    });

  it("today is marked (aria-current=date) and \"Today\" comes back to it from another month, focus on the day", async () => {
    const { container } = render(
      <div dir="rtl" lang="he">
        <HebrewMonthView year={5787} month={ADAR_II} israel lang="he" locale="he" dir="rtl" focusIso="2027-03-23" today="2027-03-23" />
      </div>,
    );
    const current = () => [...container.querySelectorAll('[aria-current="date"]')].map((c) => (c as HTMLElement).dataset.iso);
    expect(current()).toEqual(["2027-03-23"]); // 14 Adar II, Purim
    const todayBtn = container.querySelector("[data-hcal-today]") as HTMLButtonElement;
    expect(todayBtn.disabled).toBe(true); // already there
    act(() => {
      fireEvent.click(container.querySelector("[data-hcal-next]")!);
    });
    expect(container.querySelector("[data-hebrew-month]")!.getAttribute("data-hebrew-month")).not.toBe(`5787-${ADAR_II}`);
    expect(current()).toEqual([]);
    expect(todayBtn.disabled).toBe(false);
    act(() => {
      fireEvent.click(todayBtn);
    });
    expect(container.querySelector("[data-hebrew-month]")!.getAttribute("data-hebrew-month")).toBe(`5787-${ADAR_II}`);
    expect(current()).toEqual(["2027-03-23"]);
    expect((document.activeElement as HTMLElement).dataset.iso).toBe("2027-03-23");
    expect((await axe.run(container, { resultTypes: ["violations"] })).violations.map((v) => v.id)).toEqual([]);
  });

  it("the panel with the heatmap and its table is axe clean (RTL)", async () => {
    const items = new Map([["2026-09-15", [{ path: "daily/2026-09-15.md", name: "2026-09-15" }]]]);
    const { container } = render(
      <div dir="rtl" lang="he">
        <HebrewCalendarPanel items={items} israel lang="he" locale="he" dir="rtl" today="2026-09-15" />
      </div>,
    );
    expect(container.querySelector("table[data-viz-table]")).not.toBeNull();
    expect((await axe.run(container, { resultTypes: ["violations"] })).violations.map((v) => v.id)).toEqual([]);
  });
});

describe("hosts", () => {
  it("a .base `type: hebrew-calendar` view puts each note on its date", () => {
    const parsed = parseBase("views:\n  - type: hebrew-calendar\n    name: Events\n    date: when\n");
    if (!parsed.ok) throw new Error(parsed.error);
    const files = [basesFileFromText("e/a.md", "---\nwhen: 2026-09-21\n---\n"), basesFileFromText("e/b.md", "---\nwhen: 2026-09-21\n---\n"), basesFileFromText("e/c.md", "no date")];
    const result = runBase(parsed.base, files);
    expect(itemsByDay(result)).toEqual(new Map([["2026-09-21", [{ path: "e/a.md", name: "a" }, { path: "e/b.md", name: "b" }]]]));
  });
  it("the ```hebrew-calendar block option", () => {
    expect(parseHebrewCalendarBlock("")).toEqual({ heatmap: true });
    expect(parseHebrewCalendarBlock("heatmap: false")).toEqual({ heatmap: false });
  });
});
