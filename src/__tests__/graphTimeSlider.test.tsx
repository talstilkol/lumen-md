/**
 * Plan W12.V8: the note graph's time slider — the same component as the
 * entity graph's (W12.E7) — by the notes' created or last-saved day, with
 * the existing filters; it narrows the graph and its table (W10.E60) by the
 * same notes. The vault below is SYNTHETIC index entries; the real
 * buildGraph, filters and GraphView run on them (the index and storage
 * are the boundary that is stood in for, as in graphTable.test.tsx).
 */
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("../lib/logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../storage/workspace", () => ({ listWorkspace: vi.fn().mockResolvedValue([]), readWorkspaceFile: vi.fn(async (p: string) => `# ${p}`) }));
const day = (s: string) => Date.parse(`${s}T12:00:00Z`);
const FILES = [
  { path: "בית.md", modified: day("2026-01-10"), wikiTargets: ["פרויקטים", "יומן"], meta: { tags: ["hub"], props: { created: "2025-12-01" } } },
  { path: "פרויקטים.md", modified: day("2026-03-01"), wikiTargets: ["יומן"], meta: { tags: [], props: { created: "2026-02-15" } } },
  { path: "יומן.md", modified: day("2026-05-20"), wikiTargets: [], meta: { tags: ["hub"], props: { date: "2026-05-01" } } },
  { path: "בודד.md", modified: day("2026-07-07"), wikiTargets: [], meta: { tags: [], props: {} } },
];
vi.mock("../storage/workspaceIndex", () => ({ ensureIndex: vi.fn().mockResolvedValue(undefined), indexedFiles: vi.fn(() => FILES) }));

import { buildGraph, filteredGraph, graphTimeDomain, noteDay } from "../graph/graphModel";
import { untilOf } from "../ui/graph/TimeSlider";

const g = buildGraph(FILES);

describe("time in the graph model (W12.V8)", () => {
  it("created is the `created` (else `date`) property; modified is the last save", () => {
    expect([0, 1, 2, 3].map((i) => noteDay(g, i, "created"))).toEqual(["2025-12-01", "2026-02-15", "2026-05-01", null]);
    expect([0, 1, 2, 3].map((i) => noteDay(g, i, "modified"))).toEqual(["2026-01-10", "2026-03-01", "2026-05-20", "2026-07-07"]);
    expect(graphTimeDomain(g, "created")).toEqual(["2025-12-01", "2026-02-15", "2026-05-01"]);
  });
  it("the slider's `until` joins the existing filters; undated notes stay; the last day shows everything", () => {
    const domain = graphTimeDomain(g, "modified");
    expect(untilOf(domain, domain.length - 1)).toBeUndefined();
    expect(filteredGraph(g, { dateField: "modified", until: "2026-03-01" }).nodes.length).toBe(2);
    expect(filteredGraph(g, { dateField: "modified", until: "2026-03-01", tag: "hub" }).nodes.length).toBe(1);
    expect(filteredGraph(g, { dateField: "created", until: "2025-12-31" }).nodes.length).toBe(2); // בית + the undated בודד
  });
});

describe("GraphView: the slider narrows the graph and the table by the same notes", () => {
  for (const dir of ["rtl", "ltr"] as const)
    it(dir, async () => {
      document.documentElement.dir = dir;
      const { GraphView } = await import("../ui/GraphView");
      render(<GraphView onOpenFile={() => undefined} initialTable />);
      const table = await screen.findByRole("table");
      const rowNames = () => within(screen.getByRole("table")).getAllByRole("row").slice(1).map((r) => r.querySelector("th")!.textContent);
      const stats = () => screen.getByTestId("graph-stats").textContent ?? "";
      expect(rowNames().length).toBe(4);
      const slider = screen.getByTestId("graph-time") as HTMLInputElement;
      expect(slider.max).toBe("3");
      // Back to the second day of the last-saved domain: two notes.
      act(() => {
        fireEvent.change(slider, { target: { value: "1" } });
      });
      expect(rowNames().sort()).toEqual(["בית", "פרויקטים"].sort());
      expect(stats()).toMatch(/^2\b|\b2 /);
      // The canvas would get exactly these nodes: the same filter, read from the model.
      const expected = filteredGraph(g, { dateField: "modified", until: "2026-03-01" });
      expect(rowNames().length).toBe(expected.nodes.length);
      // By created day instead: the slider resets to everything, then the first day keeps בית and the undated בודד.
      act(() => {
        fireEvent.change(screen.getByTestId("graph-time-field"), { target: { value: "created" } });
      });
      expect(rowNames().length).toBe(4);
      act(() => {
        fireEvent.change(screen.getByTestId("graph-time") as HTMLInputElement, { target: { value: "0" } });
      });
      expect(rowNames().sort()).toEqual(["בודד", "בית"].sort());
      expect(table).toBeTruthy();
      document.documentElement.dir = "";
    });
});
