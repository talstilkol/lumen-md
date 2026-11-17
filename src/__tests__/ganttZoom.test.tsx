/**
 * Audit r4 A3 #9 (W13.G5): the task Gantt is reachable from the ```tasks```
 * block, and the Gantt view has a time zoom — in / out around the middle,
 * earlier / later, the whole range — with + / − / 0 on the bars, the window
 * announced, bars outside it cut at its edges.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import type { Task } from "../tasks/taskParser";
import { tasksInNote } from "../tasks/taskParser";
import { dayNumber, ganttFromTasks, ganttLayout, panWindow, zoomWindow, MIN_ZOOM_DAYS } from "../views/timeline/gantt";
import GanttView from "../views/timeline/GanttView";

const env = vi.hoisted(() => ({ tasks: [] as unknown[] }));
vi.mock("../storage/workspaceIndex", () => ({ queryVaultTasks: async () => ({ groups: [{ name: "", tasks: env.tasks }], total: env.tasks.length, errors: [] }) }));

const MD = [
  "- [ ] תכנון 🆔 plan 🛫 2026-01-01 📅 2026-01-20",
  "- [ ] בנייה 🆔 build ⛔ plan 🛫 2026-02-01 📅 2026-06-30",
  "- [ ] בדיקות 🆔 test ⛔ build 🛫 2026-07-01 📅 2026-09-30",
  "- [x] השקה ⛔ test 📅 2026-12-01",
].join("\n");
const TASKS = tasksInNote("פרויקט/תוכנית.md", MD) as Task[];

afterEach(() => cleanup());

describe("the zoom window", () => {
  const full = { from: 0, to: 400 };
  it("in halves around the middle, out doubles, the whole range ends it; never shorter than a week", () => {
    expect(zoomWindow(full, full, 0.5)).toEqual({ from: 100, to: 300 });
    expect(zoomWindow({ from: 100, to: 300 }, full, 2)).toBeNull();
    expect(zoomWindow({ from: 0, to: 10 }, full, 0.5)).toEqual({ from: 2, to: 2 + MIN_ZOOM_DAYS });
    expect(zoomWindow({ from: 380, to: 400 }, full, 4)).toEqual({ from: 320, to: 400 }); // kept inside
  });
  it("earlier / later by a quarter, kept inside the range", () => {
    expect(panWindow({ from: 100, to: 300 }, full, 0.25)).toEqual({ from: 150, to: 350 });
    expect(panWindow({ from: 100, to: 300 }, full, -1)).toEqual({ from: 0, to: 200 });
    expect(panWindow({ from: 300, to: 400 }, full, 0.25)).toEqual({ from: 300, to: 400 });
  });
  it("the layout of a window: positions and ticks for it, the whole range kept", () => {
    const items = ganttFromTasks(TASKS);
    const all = ganttLayout(items);
    const jan = { from: dayNumber("2026-01-01"), to: dayNumber("2026-02-01") };
    const z = ganttLayout(items, jan);
    expect(z.full).toEqual(all.full);
    expect([z.from, z.to]).toEqual(["2026-01-01", "2026-01-31"]);
    const plan = z.rows.find((r) => r.item.id === "plan")!;
    expect(plan.x0).toBeCloseTo(0, 5);
    expect(plan.x1).toBeCloseTo(20 / 31, 5);
    expect(z.rows.find((r) => r.item.id === "build")!.x0).toBeGreaterThanOrEqual(1); // after the window: cut by the view
    expect(z.ticks.every((t) => t.at >= 0 && t.at <= 1 && t.unit === "week")).toBe(true);
  });
});

describe("the zoom in the view", () => {
  it("buttons and keys zoom and move; the window is announced; axe clean", async () => {
    const { container } = render(<GanttView items={ganttFromTasks(TASKS)} dir="ltr" />);
    const bar = (id: string) => container.querySelector(`[data-item="${id}"] button`) as HTMLElement;
    const before = bar("plan").style.insetInlineStart;
    expect(screen.getByTestId("gantt-zoom-out")).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByTestId("gantt-zoom-in"));
    expect(screen.getByTestId("gantt-window").textContent).toMatch(/–/);
    expect(bar("plan").style.insetInlineStart).not.toBe(before);
    expect(screen.getByTestId("gantt-zoom-out")).toHaveProperty("disabled", false);
    const shown = screen.getByTestId("gantt-window").textContent;
    fireEvent.click(screen.getByTestId("gantt-later"));
    expect(screen.getByTestId("gantt-window").textContent).not.toBe(shown);
    fireEvent.click(screen.getByTestId("gantt-zoom-fit"));
    expect(screen.getByTestId("gantt-window").textContent).toBe("");
    expect(bar("plan").style.insetInlineStart).toBe(before);
    const list = screen.getByTestId("gantt-rows");
    fireEvent.keyDown(list, { key: "+" });
    fireEvent.keyDown(list, { key: "+" });
    expect(screen.getByTestId("gantt-window").textContent).not.toBe("");
    fireEvent.keyDown(list, { key: "0" });
    expect(screen.getByTestId("gantt-window").textContent).toBe("");
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
});

describe("the task Gantt, from the ```tasks``` block", () => {
  it("the block's Gantt button shows the query's tasks as bars with their dependencies; a bar opens its note", async () => {
    env.tasks = TASKS;
    const { default: TasksBlock } = await import("../plugins/TasksBlock");
    render(<TasksBlock source={"not done"} />);
    const toggle = await screen.findByTestId("tasks-gantt-toggle");
    await waitFor(() => expect(toggle).toHaveProperty("disabled", false));
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    await act(async () => void fireEvent.click(toggle));
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    const rows = await screen.findByTestId("gantt-rows");
    expect(within(rows).getAllByRole("listitem").map((r) => r.getAttribute("data-item"))).toEqual(["plan", "build", "test", "פרויקט/תוכנית.md:3"]);
    expect(screen.queryAllByTestId("task-row")).toHaveLength(0);
    const opened: string[] = [];
    const onOpen = (e: Event) => opened.push((e as CustomEvent<{ path: string }>).detail.path);
    window.addEventListener("lumen-open-file", onOpen);
    try {
      fireEvent.click(within(rows).getAllByRole("button")[1]);
      expect(opened).toEqual(["פרויקט/תוכנית.md"]);
    } finally {
      window.removeEventListener("lumen-open-file", onOpen);
    }
    await act(async () => void fireEvent.click(toggle));
    expect(screen.queryByTestId("gantt-rows")).toBeNull();
  });
});
