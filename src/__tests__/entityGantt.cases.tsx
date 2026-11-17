/**
 * W13.G5 — the Gantt view over R12.7's time model: ranges by precision
 * (a year is a bar over the year), dependencies as arrows (claims' `after`,
 * tasks' ⛔), RTL with the earliest on the right, the alternative table,
 * keyboard, 500 items rendered within 300 ms, axe clean.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import type { TimelineClaim, TimeSpan } from "../entities/temporal";
import type { Task } from "../tasks/taskParser";
import { tasksInNote } from "../tasks/taskParser";
import { dayNumber, ganttFromClaims, ganttFromTasks, ganttLayout, ticksFor, type GanttItem } from "../views/timeline/gantt";
import GanttView from "../views/timeline/GanttView";
import { TimelineView } from "../views/timeline/TimelineView";

const span = (from: string, to = from, precision: TimeSpan["precision"] = "day"): TimeSpan => ({ from, to, precision });
const claim = (id: string, value: string, start?: TimeSpan, end?: TimeSpan, after?: string): TimelineClaim => ({ id, subject: "person:בן-גוריון", predicate: "role", value, start, end, observed: "2026-01-01", source: { note: "ביוגרפיה.md", anchor: id, quote: value }, after });

const CLAIMS = [
  claim("c1", "עלייה לארץ", span("1906-01-01", "1906-12-31", "year")),
  claim("c2", "מזכיר ההסתדרות", span("1921-01-01", "1921-12-31", "year"), span("1935-01-01", "1935-12-31", "year"), "c1"),
  claim("c3", "יו״ר הסוכנות", span("1935-01-01", "1935-12-31", "year"), span("1948-01-01", "1948-12-31", "year"), "c2"),
  claim("c4", "הכרזת המדינה", span("1948-05-14"), undefined, "c3"),
  claim("c5", "ראש הממשלה", span("1948-05-01", "1948-05-31", "month"), span("1963-06-26"), "c4"),
  claim("c6", "לא ידוע מתי", undefined, undefined),
];

describe("the model", () => {
  const items = ganttFromClaims(CLAIMS, new Map([["person:בן-גוריון", "דוד בן-גוריון"]]));
  const layout = ganttLayout(items);
  it("a range runs from the start span's first day to the end span's last: precision decides the days", () => {
    const by = new Map(items.map((i) => [i.id, i]));
    expect([by.get("c1")!.start, by.get("c1")!.end]).toEqual(["1906-01-01", "1906-12-31"]);
    expect([by.get("c2")!.start, by.get("c2")!.end]).toEqual(["1921-01-01", "1935-12-31"]);
    expect(by.get("c4")!.milestone).toBe(true);
    expect([by.get("c5")!.start, by.get("c5")!.end]).toEqual(["1948-05-01", "1963-06-26"]);
    expect(by.get("c2")!.group).toBe("דוד בן-גוריון");
  });
  it("rows in time order, positions as fractions of the axis, the undated apart", () => {
    expect(layout.rows.map((r) => r.item.id)).toEqual(["c1", "c2", "c3", "c5", "c4"]);
    expect(layout.undated.map((i) => i.id)).toEqual(["c6"]);
    for (const r of layout.rows) {
      expect(r.x0).toBeGreaterThan(0);
      expect(r.x1).toBeLessThan(1);
      expect(r.x1).toBeGreaterThan(r.x0);
    }
    const c1 = layout.rows[0];
    // A year is 365 days of the axis.
    const axisDays = dayNumber(layout.to) - dayNumber(layout.from) + 1;
    expect((c1.x1 - c1.x0) * axisDays).toBeCloseTo(365, 0);
  });
  it("dependencies become arrows; one that starts before its predecessor ends is a conflict", () => {
    const ids = layout.arrows.map((a) => `${layout.rows[a.from].item.id}>${layout.rows[a.to].item.id}${a.conflict ? "!" : ""}`);
    // c3 starts in 1935, the year c2 ends: a conflict at year precision; c5 starts (May 1948) before c4 (May 14).
    expect(ids.sort()).toEqual(["c1>c2", "c2>c3!", "c3>c4!", "c4>c5!"].sort());
  });
  it("missing dependencies and cycles are reported, not drawn", () => {
    const a: GanttItem = { id: "a", label: "a", start: "2026-01-01", end: "2026-01-05", precision: "day", deps: ["b", "zzz"], milestone: false };
    const b: GanttItem = { id: "b", label: "b", start: "2026-01-06", end: "2026-01-09", precision: "day", deps: ["a"], milestone: false };
    const l = ganttLayout([a, b]);
    expect(l.missing).toEqual([{ item: "a", dep: "zzz" }]);
    expect(l.cycle.sort()).toEqual(["a", "b"]);
  });
  it("ticks: weeks, months, years or decades, inside the axis", () => {
    const at = (a: string, b: string) => ticksFor(dayNumber(a), dayNumber(b));
    expect(at("2026-01-01", "2026-02-15")[0].unit).toBe("week");
    expect(at("2026-01-01", "2027-01-01")[0].unit).toBe("month");
    expect(at("2000-01-01", "2020-01-01")[0].unit).toBe("year");
    expect(at("1900-01-01", "2000-01-01")[0].unit).toBe("decade");
    for (const k of at("1906-01-01", "1964-01-01")) expect(k.at >= 0 && k.at <= 1).toBe(true);
    expect(at("2026-03-01", "2026-03-01")).toEqual([]);
  });
  it("tasks: 🛫 to 📅 with ⛔ dependencies (Obsidian Tasks ids)", () => {
    const md = ["- [ ] תכנון 🆔 plan 🛫 2026-11-01 📅 2026-11-10", "- [ ] בנייה 🆔 build ⛔ plan 🛫 2026-11-11 📅 2026-11-30", "- [x] השקה ⛔ build 📅 2026-12-01", "- [ ] בלי תאריך"].join("\n");
    const tasks = tasksInNote("פרויקט.md", md) as Task[];
    const items = ganttFromTasks(tasks);
    const l = ganttLayout(items);
    expect(l.rows.map((r) => r.item.label)).toEqual(["תכנון", "בנייה", "השקה"]);
    expect(l.rows[2].item.milestone).toBe(true);
    expect(l.rows[2].item.done).toBe(true);
    expect(l.arrows.map((a) => [l.rows[a.from].item.label, l.rows[a.to].item.label, a.conflict])).toEqual([
      ["תכנון", "בנייה", false],
      ["בנייה", "השקה", false],
    ]);
    expect(l.undated.map((i) => i.label)).toEqual(["בלי תאריך"]);
  });
});

async function axeClean(el: Element) {
  const r = await axe.run(el, { rules: { "color-contrast": { enabled: false } } });
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

describe("the view, in Hebrew", () => {
  beforeEach(() => {
    document.documentElement.dir = "rtl";
    document.documentElement.lang = "he";
  });
  afterEach(() => {
    cleanup();
    document.documentElement.dir = "";
  });
  const items = ganttFromClaims(CLAIMS);

  it("right is early: the bars start from the right, the arrows run leftwards; axe clean", async () => {
    const opened: string[] = [];
    const { container } = render(<GanttView items={items} dir="rtl" onOpen={(i) => opened.push(i.id)} />);
    const rows = within(screen.getByTestId("gantt-rows")).getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("data-item"))).toEqual(["c1", "c2", "c3", "c5", "c4"]);
    const bar = within(rows[0]).getByRole("button");
    // Logical properties: in RTL inset-inline-start is the right edge.
    expect(bar.style.insetInlineStart).toMatch(/%$/);
    expect(screen.getByTestId("gantt").getAttribute("dir")).toBe("rtl");
    // Arrows: physical coordinates, mirrored — c1 ends further right than c2 begins? No: c1 (1906) is right of c2 (1921).
    const arrow = container.querySelector("[data-arrow='c1>c2']")!.getAttribute("d")!;
    const [, x1] = /^M([\d.]+),/.exec(arrow)!;
    const x2 = Number(/H([\d.-]+)$/.exec(arrow)![1]);
    expect(Number(x1)).toBeGreaterThan(x2);
    expect(container.querySelectorAll("[data-conflict]").length).toBe(3);
    // Names carry the dates and what it comes after.
    expect(within(rows[1]).getByRole("button").getAttribute("aria-label")).toMatch(/מזכיר ההסתדרות: .*1921.*1935.*(after|אחרי) עלייה לארץ/);
    fireEvent.click(within(rows[2]).getByRole("button"));
    expect(opened).toEqual(["c3"]);
    expect(screen.getByTestId("gantt-undated").textContent).toMatch(/1/);
    await axeClean(container);
  });
  it("in LTR the same arrow runs rightwards", () => {
    const { container } = render(<GanttView items={items} dir="ltr" />);
    const arrow = container.querySelector("[data-arrow='c1>c2']")!.getAttribute("d")!;
    const x1 = Number(/^M([\d.]+),/.exec(arrow)![1]);
    const x2 = Number(/H([\d.-]+)$/.exec(arrow)![1]);
    expect(x1).toBeLessThan(x2);
  });
  it("keyboard: ↑/↓, Home/End move between the bars; one tab stop", () => {
    render(<GanttView items={items} dir="rtl" />);
    const buttons = within(screen.getByTestId("gantt-rows")).getAllByRole("button");
    expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    buttons[0].focus();
    fireEvent.keyDown(buttons[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.keyDown(buttons[1], { key: "End" });
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    fireEvent.keyDown(buttons[buttons.length - 1], { key: "Home" });
    expect(document.activeElement).toBe(buttons[0]);
  });
  it("the alternative table holds the same rows; axe clean", async () => {
    const { container } = render(<GanttView items={items} dir="rtl" />);
    fireEvent.click(screen.getByTestId("gantt-table-toggle"));
    const table = screen.getByTestId("gantt-table");
    const body = within(table).getAllByRole("row").slice(1);
    expect(body.map((r) => r.getAttribute("data-item"))).toEqual(["c1", "c2", "c3", "c5", "c4"]);
    expect(within(body[1]).getAllByRole("cell")[3].textContent).toContain("עלייה לארץ");
    expect(table.querySelector("time")!.getAttribute("dateTime")).toBe("1906-01-01");
    await axeClean(container);
  });
  it("500 items render within 300 ms (windowed), the keyboard reaches all of them, the table holds all of them", () => {
    const many: GanttItem[] = Array.from({ length: 500 }, (_, i) => {
      const s = dayNumber("2020-01-01") + i * 3;
      const day = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);
      return { id: `t${i}`, label: `משימה ${i + 1}`, start: day(s), end: day(s + 5 + (i % 9)), precision: "day", deps: i ? [`t${i - 1}`] : [], milestone: false };
    });
    const t0 = performance.now();
    render(<GanttView items={many} dir="rtl" />);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThanOrEqual(300);
    // Windowed: the rows in view are in the DOM, each knows its place among the 500.
    const shown = within(screen.getByTestId("gantt-rows")).getAllByRole("listitem");
    expect(shown.length).toBeGreaterThan(10);
    expect(shown.length).toBeLessThan(60);
    expect(shown[0].getAttribute("aria-setsize")).toBe("500");
    expect(screen.getByTestId("gantt-rows").style.blockSize).toBe(`${500 * 28}px`);
    expect(screen.getByTestId("gantt-arrows").querySelectorAll("path[data-arrow]").length).toBe(shown.length);
    // The keyboard reaches the last of the 500, which is then drawn and focused.
    const firstBar = within(shown[0]).getByRole("button");
    firstBar.focus();
    act(() => void fireEvent.keyDown(firstBar, { key: "End" }));
    expect(document.activeElement?.closest("li")?.getAttribute("aria-posinset")).toBe("500");
    act(() => void fireEvent.keyDown(document.activeElement!, { key: "PageUp" }));
    expect(document.activeElement?.closest("li")?.getAttribute("aria-posinset")).toBe("490");
    // The table holds all 500.
    fireEvent.click(screen.getByTestId("gantt-table-toggle"));
    expect(within(screen.getByTestId("gantt-table")).getAllByRole("row")).toHaveLength(501);
  });
  it("the timeline offers it: the Gantt button shows the same claims as ranges", async () => {
    render(<TimelineView claims={CLAIMS} onOpenSource={() => undefined} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("timeline-gantt"));
    });
    expect(await screen.findByTestId("gantt")).toBeTruthy();
    expect(within(screen.getByTestId("gantt-rows")).getAllByRole("listitem")).toHaveLength(5);
  });
});
