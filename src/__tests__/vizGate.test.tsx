/**
 * Plan W12.V7: the accessibility and RTL gate over every view of wave 12 —
 * in both directions, each view has an alternative that holds its data,
 * the keyboard reaches every point, and axe is clean (helpers/vizGate.ts).
 * Also: the visualisation libraries' licences, no CDN, and no network
 * request while the views render (airplane mode). The gate itself is shown
 * to fail when one view loses its table.
 *
 * The data is SYNTHETIC (built here).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { checkView, networkDuring, type GateExpect } from "./helpers/vizGate";
import ChartFigure from "../viz/ChartFigure";
import { chartData, chartOption, chartPoints, chartTable, optionNumbers, VIZ_CHART_KINDS, type ChartSpec, type VizRow } from "../viz/chartModel";
import TreeFigure from "../viz/TreeFigure";
import { flatten, headingTree } from "../viz/treeModel";
import HebrewCalendarPanel from "../viz/HebrewCalendarPanel";
import { hebrewActivity, hebrewMonthGrid, hebrewMonthOf } from "../viz/hebrewMonthModel";
import SankeyView from "../viz/graph/SankeyView";
import { countedSankey } from "../views/graph/flows";
import AdjacencyMatrixView from "../viz/graph/AdjacencyMatrixView";
import { ArgumentMapView } from "../viz/ArgumentMapBlock";
import { argumentGraph, layoutArgument, readingOrder } from "../argument/argumentMap";
import { VizFrame } from "../viz/VizFrame";
// @ts-expect-error — plain .mjs script without type declarations
import { gateFiles, OFFLINE_GATES } from "../../scripts/train-offline.mjs";
import { DataTable } from "../viz/DataTable";

const rows: VizRow[] = [
  { "file.name": "א", status: "נקרא", genre: "שירה", pages: 120, rating: 4, read: "2026-01-05" },
  { "file.name": "ב", status: "נקרא", genre: "פרוזה", pages: 300, rating: 5, read: "2026-01-05" },
  { "file.name": "ג", status: "בקריאה", genre: "פרוזה", pages: 210, rating: 3, read: "2026-02-01" },
  { "file.name": "ד", status: "רשימה", genre: "Essays", pages: 80, rating: 2, read: "2026-03-14" },
];
const specs: Record<string, ChartSpec> = {
  bar: { kind: "bar", x: "status", y: "pages" },
  line: { kind: "line", x: "read" },
  pie: { kind: "pie", x: "genre" },
  scatter: { kind: "scatter", x: "pages", y: "rating", series: "genre" },
  heatmap: { kind: "heatmap", x: "status", series: "genre" },
  calendar: { kind: "calendar", x: "read", y: "pages" },
};
const labels = { x: "X", y: "Y", series: "S", label: "Note", day: "Date" };

const tree = headingTree("# מבוא\n## רקע\n## שיטה\n# תוצאות\n# סיכום", "הפתק");
const sankey = countedSankey([
  { from: "אדם", to: "ארגון", id: "e1" },
  { from: "אדם", to: "ארגון", id: "e2" },
  { from: "אדם", to: "מקום", id: "e3" },
]);
const matrixNodes = Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, label: `צומת ${i}` }));
const matrixEdges = [
  { source: "n0", target: "n1" },
  { source: "n1", target: "n2" },
  { source: "n3", target: "n4" },
  { source: "n4", target: "n5" },
];
const fm = (s: string) => Object.fromEntries(s.split("\n").map((l) => l.split(": ")).map(([k, v]) => [k, v.startsWith("[") ? v.slice(1, -1).split(",").map((x) => x.trim()) : v === "true" ? true : v]));
const arg = argumentGraph([
  { path: "דוח.md", fm: fm("type: evidence\nsupports: [[[טענה]]]") },
  { path: "טענה.md", fm: fm("type: claim\nsupports: [[[מסקנה]]]") },
  { path: "מסקנה.md", fm: fm("type: claim\nconclusion: true") },
  { path: "השערה.md", fm: fm("type: claim") },
]);

interface View {
  name: string;
  el: (dir: "rtl" | "ltr") => ReactElement;
  want: GateExpect;
}

const VIEWS: View[] = [
  ...VIZ_CHART_KINDS.map((kind): View => {
    const data = chartData(rows, specs[kind]).data;
    return {
      name: `W12.V1 chart: ${kind}`,
      el: (dir) => <ChartFigure rows={rows} spec={specs[kind]} title={kind} labels={labels} dir={dir} />,
      want: { alternative: "table", items: chartTable(data, labels).rows.length, numbers: optionNumbers(chartOption(data, { dir: "rtl", description: "", labels })).filter((n) => n !== null), points: chartPoints(data).length },
    };
  }),
  ...(["tree", "sunburst"] as const).map(
    (kind): View => ({
      name: `W12.V3 ${kind}`,
      el: (dir) => <TreeFigure root={tree} kind={kind} title="כותרות" dir={dir} />,
      want: { alternative: "tree", items: tree.children.length, points: flatten(tree).length },
    }),
  ),
  {
    name: "W12.V5 Hebrew month grid",
    el: (dir) => <HebrewCalendarPanel items={new Map()} activity={new Map([["2026-09-15", 2]])} israel lang={dir === "rtl" ? "he" : "en"} locale={dir === "rtl" ? "he" : "en"} dir={dir} today="2026-09-15" heatmap={false} />,
    want: { alternative: "grid", items: hebrewMonthGrid(hebrewMonthOf("2026-09-15").year, hebrewMonthOf("2026-09-15").month, { israel: true, lang: "he" }).cells.length },
  },
  {
    name: "W12.V5 activity by Hebrew month",
    el: (dir) => <HebrewCalendarPanel items={new Map()} activity={new Map([["2026-09-15", 2], ["2026-10-01", 1]])} israel lang="he" locale="he" dir={dir} today="2026-09-15" />,
    want: { alternative: "table", items: hebrewActivity(new Map([["2026-09-15", 2]]), 5787, "he").ys.length, numbers: [2, 1], points: 2 },
  },
  {
    name: "W12.V2 Sankey",
    el: (dir) => <SankeyView title="קשרים" dir={dir} data={sankey} />,
    want: { alternative: "table", items: sankey.bands.length, numbers: sankey.bands.map((b) => b.value), points: sankey.bands.length },
  },
  {
    name: "W12.V2 adjacency matrix",
    el: (dir) => <AdjacencyMatrixView title="מטריצה" dir={dir} nodes={matrixNodes} edges={matrixEdges} />,
    want: { alternative: "table", items: matrixNodes.length, numbers: matrixEdges.flatMap(() => [1, 1]) },
  },
  {
    name: "W12.V4 argument map",
    el: (dir) => <ArgumentMapView g={arg} dir={dir} title="טיעונים" onOpen={() => undefined} />,
    want: { alternative: "list", items: arg.nodes.filter((n) => n.kind !== "source").length, points: readingOrder(layoutArgument(arg)).length },
  },
];

describe("the gate: every wave-12 view, both directions (W12.V7)", () => {
  for (const v of VIEWS)
    for (const dir of ["rtl", "ltr"] as const)
      it(`${v.name} · ${dir}`, async () => {
        const { container } = render(
          <div dir={dir} lang={dir === "rtl" ? "he" : "en"}>
            {v.el(dir)}
          </div>,
        );
        expect(await checkView(container, dir, v.want)).toEqual([]);
      });
});

describe("the gate fails when a view loses its alternative", () => {
  const data = chartData(rows, specs.bar).data;
  const table = chartTable(data, labels);
  const want: GateExpect = { alternative: "table", items: table.rows.length, points: chartPoints(data).length };
  const frame = (alternative: (id: string, hidden: boolean) => ReactElement | null) => (
    <div dir="rtl" lang="he">
      <VizFrame title="t" summary="s" dir="rtl" kind="bar" picture={null} points={chartPoints(data)} alternative={alternative} />
    </div>
  );
  it("with the table: passes", async () => {
    const { container } = render(frame((id, hidden) => <DataTable id={id} hidden={hidden} table={table} caption="c" />));
    expect(await checkView(container, "rtl", want)).toEqual([]);
  });
  it("the table removed: fails", async () => {
    const { container } = render(frame(() => null));
    expect(await checkView(container, "rtl", want)).toContain("no table alternative");
  });
  it("a row dropped from the table: fails", async () => {
    const { container } = render(frame((id, hidden) => <DataTable id={id} hidden={hidden} table={{ ...table, rows: table.rows.slice(1) }} caption="c" />));
    expect((await checkView(container, "rtl", want)).some((p) => p.startsWith("the table has"))).toBe(true);
  });
});

describe("airplane mode: no network request while the views render", () => {
  it("all views, both directions: 0 requests", async () => {
    const calls = await networkDuring(async () => {
      for (const v of VIEWS)
        for (const dir of ["rtl", "ltr"] as const) {
          const { unmount } = render(v.el(dir));
          await new Promise((r) => setTimeout(r, 0));
          unmount();
        }
    });
    expect(calls).toEqual([]);
  });
});

const VIZ_SOURCES = ["src/viz", "src/views/graph", "src/argument", "src/plugins/EChart.tsx", "src/views/leiden.ts"];
function filesUnder(p: string): string[] {
  if (statSync(p).isFile()) return [p];
  return readdirSync(p).flatMap((f) => filesUnder(join(p, f)));
}

describe("licences and CDN", () => {
  it("every visualisation library is in the lock with an approved licence (Apache-2.0, MIT, BSD)", () => {
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as { packages: Record<string, { license?: string; version?: string }> };
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> };
    const APPROVED = /^(Apache-2\.0|MIT|BSD-2-Clause|BSD-3-Clause|0BSD|ISC)$/;
    // The libraries the views use, and what they bring in.
    for (const name of ["echarts", "zrender", "leaflet", "tslib"]) {
      const entry = lock.packages[`node_modules/${name}`];
      expect(entry, name).toBeTruthy();
      expect(entry.license, name).toMatch(APPROVED);
    }
    expect(pkg.dependencies.echarts).toBeTruthy();
    expect(pkg.dependencies.leaflet).toBeTruthy();
    // No new chart library came with wave 12.
    for (const name of ["chart.js", "d3", "plotly.js", "recharts", "highcharts", "vega", "dagre", "cytoscape"]) expect(pkg.dependencies[name], name).toBeUndefined();
  });
  it("0 loads from a CDN: no URL import, script or stylesheet in the views' code", () => {
    const offenders: string[] = [];
    for (const root of VIZ_SOURCES)
      for (const f of filesUnder(root)) {
        const src = readFileSync(f, "utf8");
        if (/import\(\s*["'`]https?:/.test(src) || /from\s+["']https?:/.test(src) || /<script[^>]+src=/.test(src) || /<link[^>]+href=["']https?:/.test(src) || /\b(cdn\.jsdelivr|unpkg\.com|cdnjs|esm\.sh)\b/.test(src)) offenders.push(f);
      }
    expect(offenders).toEqual([]);
  });
});

describe("in the offline green train (W10.A14)", () => {
  it("scripts/train-offline.mjs runs this gate after the attack files", () => {
    expect(OFFLINE_GATES).toContain("src/__tests__/vizGate.test.tsx");
    const files = gateFiles() as string[];
    expect(files[files.length - 1]).toBe("src/__tests__/vizGate.test.tsx");
    expect(files.filter((f) => f.startsWith("security/attacks/")).length).toBeGreaterThan(0);
  });
});
