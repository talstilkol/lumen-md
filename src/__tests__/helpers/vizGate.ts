/**
 * The accessibility and RTL gate of the wave-12 views (plan W12.V7): one
 * check, run on every view in both directions. A view passes when
 *   1. it has an accessible alternative in the DOM (a data table, an ARIA
 *      tree, a list, or it is itself an ARIA grid / table),
 *   2. the alternative holds the view's data: as many rows (or items) as
 *      the view's own model says, and the numbers it draws,
 *   3. the keyboard reaches every point: one tab stop, and the "next" arrow
 *      of the direction (← in RTL) visits each point once,
 *   4. axe-core finds no violation.
 * `checkView` returns the problems, so a test can also show that the gate
 * fails — on a view whose table was taken away.
 */
import { act, fireEvent } from "@testing-library/react";
import axe from "axe-core";

export type AltKind = "table" | "tree" | "list" | "grid";

export interface GateExpect {
  alternative: AltKind;
  /** Rows of the table / top-level items of the tree / claims of the list / day cells of the grid. */
  items: number;
  /** Numbers the picture draws; the table must hold the same multiset. */
  numbers?: number[];
  /** Points the keyboard must reach (VizFrame views); omitted for grids, which are checked by their own arrows. */
  points?: number;
}

function alternativeOf(root: Element, kind: AltKind): Element | null {
  switch (kind) {
    case "table":
      return root.querySelector("table[data-viz-table]");
    case "tree":
      return root.querySelector('[role="tree"]');
    case "list":
      return root.querySelector("[data-viz-table] ul, .lumen-viz-arg-list ul");
    case "grid":
      return root.querySelector('[role="grid"]');
  }
}

function itemsOf(alt: Element, kind: AltKind): number {
  switch (kind) {
    case "table":
      return alt.querySelectorAll("tbody tr").length;
    case "tree":
      return alt.querySelectorAll(':scope > [role="treeitem"] > ul > [role="treeitem"]').length;
    case "list":
      return alt.querySelectorAll(":scope > li").length;
    case "grid":
      return alt.querySelectorAll('[role="gridcell"][data-iso]').length;
  }
}

/** Numbers in the table's cells (`data-value`), sorted. */
function tableNumbers(alt: Element): number[] {
  return [...alt.querySelectorAll("td[data-value]")].map((td) => Number(td.getAttribute("data-value"))).sort((a, b) => a - b);
}

export async function checkView(root: Element, dir: "rtl" | "ltr", want: GateExpect): Promise<string[]> {
  const problems: string[] = [];
  const alt = alternativeOf(root, want.alternative);
  if (!alt) problems.push(`no ${want.alternative} alternative`);
  else {
    const n = itemsOf(alt, want.alternative);
    if (n !== want.items) problems.push(`the ${want.alternative} has ${n} items, the view ${want.items}`);
    if (want.numbers && want.alternative === "table") {
      const got = tableNumbers(alt);
      const exp = [...want.numbers].sort((a, b) => a - b);
      if (JSON.stringify(got) !== JSON.stringify(exp)) problems.push(`the table's numbers differ from the picture's (${got.length} vs ${exp.length})`);
    }
  }
  if (want.points !== undefined) {
    const plot = root.querySelector("[data-viz-plot]") as HTMLElement | null;
    const status = root.querySelector("[data-viz-status]");
    if (!plot || plot.tabIndex !== 0 || !status) problems.push("the picture is not one tab stop with a live status");
    else {
      plot.focus();
      const seen = new Set<string>();
      const next = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
      for (let i = 0; i < want.points; i++) {
        act(() => {
          fireEvent.keyDown(plot, { key: next });
        });
        seen.add(status.textContent ?? "");
      }
      if (seen.size !== want.points) problems.push(`the keyboard reached ${seen.size} of ${want.points} points`);
    }
  }
  if (want.alternative === "grid" && alt) {
    const cells = [...alt.querySelectorAll<HTMLElement>('[role="gridcell"][data-iso]')];
    if (cells.filter((c) => c.tabIndex === 0).length !== 1) problems.push("the grid is not one tab stop");
  }
  const r = await axe.run(root, { resultTypes: ["violations"] });
  for (const v of r.violations) problems.push(`axe ${v.id} (${v.nodes.length})`);
  return problems;
}

/** Network calls made while `fn` runs: fetch, XHR, WebSocket, beacons and resource loads (images, scripts). */
export async function networkDuring(fn: () => Promise<void> | void): Promise<string[]> {
  const calls: string[] = [];
  const g = globalThis as unknown as Record<string, unknown> & { navigator?: Navigator };
  const restore: Array<() => void> = [];
  const wrap = (obj: Record<string, unknown> | undefined, key: string, label: string) => {
    if (!obj || typeof obj[key] !== "function") return;
    const orig = obj[key] as (...a: unknown[]) => unknown;
    obj[key] = function (this: unknown, ...a: unknown[]) {
      calls.push(`${label} ${String(a[0] ?? "")}`);
      return orig.apply(this, a);
    };
    restore.push(() => (obj[key] = orig));
  };
  wrap(g, "fetch", "fetch");
  wrap((g.XMLHttpRequest as { prototype?: Record<string, unknown> } | undefined)?.prototype, "open", "xhr");
  wrap(g.navigator as unknown as Record<string, unknown>, "sendBeacon", "beacon");
  const WS = g.WebSocket as unknown;
  if (typeof WS === "function") {
    g.WebSocket = function (url: string) {
      calls.push(`ws ${url}`);
      throw new Error("no network in airplane mode");
    } as unknown;
    restore.push(() => (g.WebSocket = WS));
  }
  const before = typeof performance !== "undefined" && performance.getEntriesByType ? performance.getEntriesByType("resource").length : 0;
  try {
    await fn();
  } finally {
    for (const r of restore) r();
  }
  if (typeof performance !== "undefined" && performance.getEntriesByType) {
    for (const e of performance.getEntriesByType("resource").slice(before)) if (!/^(data|blob):/.test(e.name)) calls.push(`resource ${e.name}`);
  }
  return calls;
}
