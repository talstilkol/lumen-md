/**
 * Plan W12.V6: a dashboard note — `layout: dashboard` lays the note's
 * embeds out as a grid from the inline start, and live blocks off screen
 * wait to refresh until they are seen (the budget).
 *
 * The 10,000-note vault is SYNTHETIC (generated here), for timing only.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dashboardLayout, dashboardProps } from "../renderer/dashboard";
import { visibleGate } from "../lib/visibleRefresh";
import { basesFileFromText, parseBase, runBase } from "../views/bases/base";
import { filterNotes, parseEmbeddedQuery, rowsFor, type QueryNote } from "../search/embeddedQuery";
import { chartData } from "../viz/chartModel";
import { baseChartSpec, baseVizRows } from "../viz/BaseChartView";
import { queryVizRows } from "../viz/QueryChartView";

describe("layout: dashboard (W12.V6)", () => {
  it("only `layout: dashboard` turns it on; columns 1–6", () => {
    expect(dashboardLayout(null)).toBeNull();
    expect(dashboardLayout({ layout: "note" })).toBeNull();
    expect(dashboardLayout({ layout: "Dashboard" })).toEqual({ columns: null });
    expect(dashboardLayout({ layout: "dashboard", "dashboard-columns": 3 })).toEqual({ columns: 3 });
    expect(dashboardLayout({ layout: "dashboard", "dashboard-columns": 9 })).toEqual({ columns: null });
  });
  it("a plain note keeps the plain preview element (Obsidian sees the same note with its embeds)", () => {
    expect(dashboardProps(dashboardLayout({ title: "x" }))).toEqual({ className: "prose-lumen" });
    expect(dashboardProps(dashboardLayout({ layout: "dashboard", "dashboard-columns": 2 }))).toEqual({
      className: "prose-lumen lumen-dashboard",
      "data-layout": "dashboard",
      style: { "--lumen-dashboard-columns": "2" },
    });
  });
  it("the grid CSS: from the inline start, prose across the row, logical properties only", () => {
    const css = readFileSync("src/index.css", "utf8");
    const rules = css.slice(css.indexOf(".prose-lumen.lumen-dashboard {"), css.indexOf(".prose-lumen :is(h1, h2, h3, h4, h5, h6) {"));
    expect(rules).toContain("display: grid");
    expect(rules).toContain("grid-template-columns: repeat(var(--lumen-dashboard-columns, auto-fill)");
    expect(rules).toContain("grid-column: 1 / -1");
    expect(rules).not.toMatch(/\b(left|right|margin-left|margin-right|padding-left|padding-right)\s*:/);
  });
  it("the preview uses it", () => {
    const src = readFileSync("src/renderer/Preview.tsx", "utf8");
    expect(src).toContain("dashboardProps(dashboardLayout(frontmatter))");
    expect(src).toMatch(/<div \{\.\.\.layout\}[ >]/);
  });
  it("query, base and tasks blocks route their live refresh through the visibility gate", () => {
    for (const f of ["src/views/QueryBlock.tsx", "src/views/bases/BasesBlock.tsx", "src/plugins/TasksBlock.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("useVisibleRefresh()");
      expect(src, f).toMatch(/schedule\(\(\) =>/);
      expect(src, f).toContain("ref={rootRef}");
    }
  });
});

// Real layout and a real IntersectionObserver: Chromium only (happy-dom lays nothing out).
const realLayout = typeof navigator !== "undefined" && /Chrome\//.test(navigator.userAgent) && !/HappyDOM/i.test(navigator.userAgent);
const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

// skip-reason: the budget is measured in a real layout (Chromium); happy-dom has no layout | task: W12.V6 | until: 2027-05-16
describe.runIf(realLayout)("the budget: a block off screen waits", () => {
  it("a refresh while off screen runs once, the latest, when the block scrolls into view", async () => {
    const spacer = document.createElement("div");
    spacer.style.blockSize = "5000px";
    const block = document.createElement("div");
    block.style.blockSize = "50px";
    document.body.append(spacer, block);
    window.scrollTo(0, 0);
    const gate = visibleGate(block, { rootMargin: "0px" });
    await frame();
    await new Promise((r) => setTimeout(r, 50));
    expect(gate.visible()).toBe(false);
    const ran: string[] = [];
    gate.schedule(() => ran.push("first"));
    gate.schedule(() => ran.push("second"));
    expect(ran).toEqual([]);
    block.scrollIntoView();
    for (let i = 0; i < 20 && !ran.length; i++) await new Promise((r) => setTimeout(r, 25));
    expect(ran).toEqual(["second"]);
    gate.schedule(() => ran.push("on screen"));
    expect(ran).toEqual(["second", "on screen"]);
    gate.dispose();
    spacer.remove();
    block.remove();
  });
});

describe("without IntersectionObserver every refresh runs at once", () => {
  it("no element: runs at once", () => {
    const g = visibleGate(null);
    const ran: number[] = [];
    g.schedule(() => ran.push(1));
    expect(ran).toEqual([1]);
  });
});

describe("8 components over a 10,000-note vault", () => {
  const N = 10_000;
  const statuses = ["done", "reading", "todo", "dropped"];
  const files = Array.from({ length: N }, (_, i) =>
    basesFileFromText(
      `books/${i % 50}/n${i}.md`,
      `---\nstatus: ${statuses[i % 4]}\npages: ${50 + (i % 400)}\nread: 2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}\ntags: [t${i % 30}]\n---\nBody ${i} #t${i % 30}\n`,
      { size: 100, mtime: new Date(Date.UTC(2026, i % 12, (i % 28) + 1)) },
    ),
  );
  const notes: QueryNote[] = files.map((f, i) => ({ path: f.path, name: f.basename, content: `#t${i % 30} body ${i}`, modified: f.mtime!.getTime() }));
  const BASE = parseBase(`views:
  - type: chart
    name: by status
    chart: bar
    x: status
    y: pages
  - type: chart
    name: per day
    chart: calendar
    x: read
  - type: chart
    name: tags
    chart: pie
    x: tags
  - type: table
    name: all
    order: [file.name, status, pages]
    limit: 50
`);

  it("compute in under a second (synthetic vault)", () => {
    if (!BASE.ok) throw new Error(BASE.error);
    const t0 = performance.now();
    // 4 Bases components.
    for (let v = 0; v < 4; v++) {
      const r = runBase(BASE.base, files, { view: v });
      if (BASE.base.views[v].chart) chartData(baseVizRows(r), baseChartSpec(r));
    }
    // 4 query components (two of them charts).
    for (const src of ["#t1", "#t2\nchart: bar\nchart-x: folder", "body\nlimit: 50", "#t3\nchart: calendar\nchart-x: modified"]) {
      const q = parseEmbeddedQuery(src);
      const hits = filterNotes(q, notes);
      const rows = rowsFor(q, hits, new Map(notes.map((n) => [n.path, n])), null);
      if (q.chart) chartData(queryVizRows(rows), { kind: q.chart.kind as "bar", x: q.chart.x ?? "folder" });
    }
    const ms = performance.now() - t0;
    console.log(`[W12.V6] 8 components over ${N} synthetic notes: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1000);
  });
});
