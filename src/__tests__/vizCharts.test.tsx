/**
 * Plan W12.V1: charts from Bases and query results — bar, line, pie,
 * scatter, heatmap, calendar heatmap — right to left, each with a data table
 * that holds exactly the chart's numbers, and keyboard navigation.
 *
 * The notes are SYNTHETIC (a small made-up reading log), written here so
 * each number can be checked by hand. ECharts itself does not draw in this
 * runner (no canvas size); what is checked is the option handed to it, the
 * table, the keyboard and axe on the rendered figure.
 */
import { describe, expect, it } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import axe from "axe-core";
import { calendarCell, chartData, chartOption, chartPoints, chartTable, optionNumbers, VIZ_CHART_KINDS, type ChartSpec, type VizRow } from "../viz/chartModel";
import { FSI, PDI, isolate } from "../viz/bidi";
import ChartFigure from "../viz/ChartFigure";
import { stepFor } from "../viz/VizFrame";
import { baseChartSpec, baseVizRows } from "../viz/BaseChartView";
import { dataviewVizRows, queryVizRows } from "../viz/QueryChartView";
import { basesFileFromText, parseBase, runBase } from "../views/bases/base";
import { parseEmbeddedQuery, splitChartOptions } from "../search/embeddedQuery";
import { DateValue } from "../search/dataview";

const rows: VizRow[] = [
  { "file.name": "א", status: "נקרא", genre: "שירה", pages: 120, rating: 4, read: "2026-01-05", tags: ["עברית", "קלאסי"] },
  { "file.name": "ב", status: "נקרא", genre: "פרוזה", pages: 300, rating: 5, read: "2026-01-05", tags: ["עברית"] },
  { "file.name": "ג", status: "בקריאה", genre: "פרוזה", pages: 210, rating: 3, read: "2026-02-01", tags: [] },
  { "file.name": "ד", status: "רשימה", genre: "שירה", pages: "80", rating: null, read: null, tags: ["English"] },
  { "file.name": "ה", status: "נקרא", genre: "Essays", pages: 150, rating: 4, read: "2026-03-14", tags: ["English", "קלאסי"] },
];

const specs: Record<string, ChartSpec> = {
  bar: { kind: "bar", x: "status", y: "pages", agg: "sum" },
  line: { kind: "line", x: "read" },
  pie: { kind: "pie", x: "genre" },
  scatter: { kind: "scatter", x: "pages", y: "rating", series: "genre" },
  heatmap: { kind: "heatmap", x: "status", series: "genre" },
  calendar: { kind: "calendar", x: "read", y: "pages" },
};
const labels = { x: "X", y: "Y", series: "S", label: "Note", day: "Date" };
const ctx = (dir: "rtl" | "ltr") => ({ dir, labels, description: "d" });

describe("chartData (W12.V1)", () => {
  it("bar: sums pages by status, categories in Hebrew collation order", () => {
    const { data } = chartData(rows, specs.bar);
    expect(data.kind).toBe("bar");
    if (data.kind !== "bar") return;
    expect(data.categories).toEqual(["בקריאה", "נקרא", "רשימה"]);
    expect(data.series).toEqual([{ name: "", values: [210, 570, 80] }]);
  });

  it("a list cell counts in each of its values", () => {
    const { data } = chartData(rows, { kind: "bar", x: "tags" });
    if (data.kind !== "bar") throw new Error("kind");
    const at = Object.fromEntries(data.categories.map((c, i) => [c, data.series[0].values[i]]));
    expect(at).toEqual({ English: 2, "עברית": 2, "קלאסי": 2, "—": 1 });
  });

  it("line: dates in order, one notes count per day; undated rows go to —", () => {
    const { data } = chartData(rows, specs.line);
    if (data.kind !== "line") throw new Error("kind");
    expect(data.categories).toEqual(["2026-01-05", "2026-02-01", "2026-03-14", "—"]);
    expect(data.series[0].values).toEqual([2, 1, 1, 1]);
  });

  it("scatter: rows without both numbers are skipped and counted", () => {
    const r = chartData(rows, specs.scatter);
    expect(r.skipped).toBe(1);
    if (r.data.kind !== "scatter") throw new Error("kind");
    // Hebrew collation puts Hebrew before Latin.
    expect(r.data.series.map((s) => s.name)).toEqual(["פרוזה", "שירה", "Essays"]);
    expect(r.data.series[0].points).toEqual([
      { x: 300, y: 5, label: "ב" },
      { x: 210, y: 3, label: "ג" },
    ]);
  });

  it("heatmap: a cell per status × genre pair that has rows", () => {
    const { data } = chartData(rows, specs.heatmap);
    if (data.kind !== "heatmap") throw new Error("kind");
    expect(data.xs).toEqual(["בקריאה", "נקרא", "רשימה"]);
    expect(data.ys).toEqual(["פרוזה", "שירה", "Essays"]);
    expect(data.cells).toEqual([
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [1, 2, 1],
      [2, 1, 1],
    ]);
  });

  it("calendar: weeks × weekdays; 2026-01-05 is a Monday", () => {
    const { data } = chartData(rows, specs.calendar);
    if (data.kind !== "calendar") throw new Error("kind");
    expect(data.days).toEqual([
      { day: "2026-01-05", value: 420 },
      { day: "2026-02-01", value: 210 },
      { day: "2026-03-14", value: 150 },
    ]);
    expect(data.start).toBe("2026-01-04"); // the Sunday before
    expect(calendarCell(data, "2026-01-05")).toEqual([0, 1]);
    expect(calendarCell(data, "2026-02-01")).toEqual([4, 0]);
    expect(calendarCell(data, "2026-03-14")).toEqual([9, 6]); // a Saturday
    expect(data.weeks).toBe(10);
  });
});

describe("the table holds exactly the chart's numbers", () => {
  for (const kind of VIZ_CHART_KINDS)
    it(kind, () => {
      const { data } = chartData(rows, specs[kind]);
      const table = chartTable(data, labels);
      const fromTable = table.rows.flatMap((r) => r.filter((v): v is number => typeof v === "number"));
      for (const dir of ["rtl", "ltr"] as const) {
        const drawn = optionNumbers(chartOption(data, ctx(dir)));
        expect([...drawn].sort((a, b) => a - b)).toEqual([...fromTable].sort((a, b) => a - b));
      }
      // And every point the keyboard reaches is a row of the table.
      expect(chartPoints(data).length).toBe(kind === "scatter" ? fromTable.length / 2 : fromTable.length);
    });
});

describe("right to left", () => {
  it("bar: the category axis runs from the right, the value axis and legend sit on the right", () => {
    const { data } = chartData(rows, { kind: "bar", x: "status", series: "genre" });
    const rtl = chartOption(data, ctx("rtl")) as any;
    const ltr = chartOption(data, ctx("ltr")) as any;
    expect(rtl.xAxis.inverse).toBe(true);
    expect(rtl.yAxis.position).toBe("right");
    expect(rtl.legend.right).toBe(8);
    expect(ltr.xAxis.inverse).toBe(false);
    expect(ltr.yAxis.position).toBe("left");
    expect(ltr.legend.left).toBe(8);
  });

  it("every label that reaches the canvas is an FSI … PDI isolate", () => {
    for (const kind of VIZ_CHART_KINDS) {
      const { data } = chartData(rows, specs[kind]);
      const o = chartOption(data, ctx("rtl")) as any;
      const texts: string[] = [];
      for (const ax of [o.xAxis, o.yAxis]) if (ax?.data && kind !== "calendar") texts.push(...ax.data);
      if (o.legend?.data) texts.push(...o.legend.data);
      for (const s of o.series) texts.push(s.name);
      for (const s of o.series) for (const d of s.data) if (d && typeof d === "object" && "name" in d) texts.push(d.name);
      expect(texts.length).toBeGreaterThan(0);
      for (const x of texts) expect(x.startsWith(FSI) && x.endsWith(PDI), `${kind}: ${x}`).toBe(true);
    }
    expect(isolate(isolate("שלום 3"))).toBe(`${FSI}שלום 3${PDI}`);
  });

  it("the arrow keys follow the visual direction", () => {
    expect(stepFor("ArrowLeft", "rtl")).toBe(1);
    expect(stepFor("ArrowRight", "rtl")).toBe(-1);
    expect(stepFor("ArrowRight", "ltr")).toBe(1);
    expect(stepFor("End", "rtl")).toBe("end");
  });

  it("the ECharts aria description is on", () => {
    const o = chartOption(chartData(rows, specs.pie).data, { ...ctx("rtl"), description: "תיאור" }) as any;
    expect(o.aria).toMatchObject({ enabled: true, label: { enabled: true, description: "תיאור" } });
  });
});

async function axeClean(el: Element) {
  const r = await axe.run(el, { resultTypes: ["violations"] });
  return r.violations.map((v) => `${v.id}: ${v.nodes.length}`);
}

describe("the figure: table, keyboard, axe", () => {
  for (const kind of VIZ_CHART_KINDS)
    for (const dir of ["rtl", "ltr"] as const)
      it(`${kind} ${dir}: table equals the data; keyboard reaches every point; axe clean`, async () => {
        const { container, getByRole } = render(
          <div lang={dir === "rtl" ? "he" : "en"} dir={dir}>
            <ChartFigure rows={rows} spec={specs[kind]} title={`ספרים ${kind}`} labels={labels} dir={dir} />
          </div>,
        );
        const fig = container.querySelector("figure")!;
        expect(fig.getAttribute("dir")).toBe(dir);
        const table = container.querySelector("table[data-viz-table]")!;
        expect(table).not.toBeNull();
        const expected = chartTable(chartData(rows, specs[kind]).data, labels);
        const bodyRows = [...table.querySelectorAll("tbody tr")];
        expect(bodyRows.length).toBe(expected.rows.length);
        expect([...table.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(expected.columns);

        const plot = container.querySelector("[data-viz-plot]") as HTMLElement;
        expect(plot.tabIndex).toBe(0);
        const points = chartPoints(chartData(rows, specs[kind]).data);
        const status = container.querySelector("[data-viz-status]")!;
        const seen = new Set<string>();
        plot.focus();
        const next = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
        for (let i = 0; i < points.length; i++) {
          act(() => {
            fireEvent.keyDown(plot, { key: next });
          });
          seen.add(status.textContent ?? "");
        }
        expect(seen.size).toBe(points.length);
        act(() => {
          fireEvent.keyDown(plot, { key: "Home" });
        });
        expect(status.textContent).toContain(points[0].label);

        expect(await axeClean(fig)).toEqual([]);
        // The table view is axe clean too.
        act(() => {
          fireEvent.click(getByRole("button", { expanded: false }));
        });
        expect((table.parentElement as HTMLElement).hidden).toBe(false);
        expect(await axeClean(fig)).toEqual([]);
      });
});

const BASE = `filters: 'file.inFolder("books")'
views:
  - type: chart
    name: Pages by status
    chart: bar
    x: status
    y: pages
    aggregate: sum
  - type: chart
    name: Read per day
    chart: calendar
    x: read
`;

describe("a chart view in a .base", () => {
  const files = [
    basesFileFromText("books/a.md", "---\nstatus: done\npages: 100\nread: 2026-01-05\n---\n"),
    basesFileFromText("books/b.md", "---\nstatus: done\npages: 50\nread: 2026-01-06\n---\n"),
    basesFileFromText("books/c.md", "---\nstatus: reading\npages: 20\n---\n"),
    basesFileFromText("other/d.md", "---\nstatus: done\npages: 999\n---\n"),
  ];
  it("reads chart, x, y, aggregate; the view's rows carry those cells", () => {
    const parsed = parseBase(BASE);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.base.views[0].chart).toEqual({ kind: "bar", x: "note.status", y: "note.pages", series: undefined, aggregate: "sum" });
    const result = runBase(parsed.base, files, { view: 0 });
    const spec = baseChartSpec(result);
    const { data } = chartData(baseVizRows(result), spec);
    if (data.kind !== "bar") throw new Error("kind");
    expect(data.categories).toEqual(["done", "reading"]);
    expect(data.series[0].values).toEqual([150, 20]);
  });
  it("a calendar view counts notes per day (YAML dates)", () => {
    const parsed = parseBase(BASE);
    if (!parsed.ok) throw new Error(parsed.error);
    const result = runBase(parsed.base, files, { view: 1 });
    const { data, skipped } = chartData(baseVizRows(result), baseChartSpec(result));
    if (data.kind !== "calendar") throw new Error("kind");
    expect(data.days).toEqual([
      { day: "2026-01-05", value: 1 },
      { day: "2026-01-06", value: 1 },
    ]);
    expect(skipped).toBe(1);
  });
});

describe("a chart from a ```query or ```dataview block", () => {
  it("chart lines are options; the rest is the query", () => {
    const q = parseEmbeddedQuery("tag:book\nchart: pie\nchart-x: folder\nlimit: 20");
    expect(q.query).toBe("tag:book");
    expect(q.chart).toEqual({ kind: "pie", x: "folder" });
    expect(q.problems).toEqual([]);
    const dv = splitChartOptions('TABLE pages FROM "books"\nchart: bar\nchart-y: pages');
    expect(dv.rest).toBe('TABLE pages FROM "books"');
    expect(dv.chart).toEqual({ kind: "bar", y: "pages" });
  });
  it("query rows chart by folder, tags and modified day", () => {
    const vr = queryVizRows([
      { path: "a/x.md", name: "x", folder: "a", modified: Date.UTC(2026, 0, 5, 10), tags: ["t1", "t2"], snippet: null },
      { path: "y.md", name: "y", folder: "", modified: Date.UTC(2026, 0, 5, 12), tags: ["t1"], snippet: null },
    ]);
    const byTag = chartData(vr, { kind: "bar", x: "tags" }).data;
    if (byTag.kind !== "bar") throw new Error("kind");
    expect(byTag.categories).toEqual(["t1", "t2"]);
    expect(byTag.series[0].values).toEqual([2, 1]);
    const cal = chartData(vr, { kind: "calendar", x: "modified" }).data;
    if (cal.kind !== "calendar") throw new Error("kind");
    expect(cal.days).toEqual([{ day: "2026-01-05", value: 2 }]);
  });
  it("dataview TABLE rows chart by their headers", () => {
    const vr = dataviewVizRows({
      type: "table",
      headers: ["File", "pages", "read"],
      rows: [
        { path: "a.md", name: "a", cells: [10, new DateValue(Date.UTC(2026, 1, 1))] },
        { path: "b.md", name: "b", cells: [5, new DateValue(Date.UTC(2026, 1, 1))] },
      ],
    });
    const d = chartData(vr, { kind: "line", x: "read", y: "pages" }).data;
    if (d.kind !== "line") throw new Error("kind");
    expect(d.categories).toEqual(["2026-02-01"]);
    expect(d.series[0].values).toEqual([15]);
  });
});
