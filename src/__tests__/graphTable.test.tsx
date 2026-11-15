/**
 * Plan W1.10 / W10.E60: the knowledge graph's text alternative. The table
 * lists the same nodes and links as the canvas (the real graph model built
 * from the index entries), a note's name opens it, and GraphView switches
 * between the canvas and the table with a pressed-state button.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("../i18n", () => ({
  registerEnglish: () => undefined,
  t: (k: string, p?: Record<string, string>) => (p ? Object.entries(p).reduce((s, [k2, v]) => s.replace(`{${k2}}`, v), k + " {shown}/{nodes}{n}") : k),
}));
vi.mock("../lib/logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../storage/workspace", () => ({ listWorkspace: vi.fn().mockResolvedValue([]), readWorkspaceFile: vi.fn(async (p: string) => `# ${p}`) }));
// The graph is built from the vault index (W2.22): these are index entries, the real buildGraph runs on them.
const FILES = [
  { path: "בית.md", modified: 1, wikiTargets: ["פרויקטים", "יומן", "Reading list"], meta: {} },
  { path: "פרויקטים.md", modified: 1, wikiTargets: ["יומן"], meta: {} },
  { path: "יומן.md", modified: 1, wikiTargets: [], meta: {} },
  { path: "Reading list.md", modified: 1, wikiTargets: [], meta: {} },
  { path: "בודד.md", modified: 1, wikiTargets: [], meta: {} },
];
vi.mock("../storage/workspaceIndex", () => ({ ensureIndex: vi.fn().mockResolvedValue(undefined), indexedFiles: vi.fn(() => FILES) }));

import { GraphTable, graphTableRows } from "../ui/graph/GraphTable";

describe("graphTableRows", () => {
  it("every node once, most-linked first, then by name; self links and duplicates dropped; capped", () => {
    const labels = ["c", "a", "b"];
    const adj = [[1, 1, 0], [0], []];
    expect(graphTableRows(labels, (i) => adj[i])).toEqual([
      { index: 1, label: "a", links: [0] },
      { index: 0, label: "c", links: [1] },
      { index: 2, label: "b", links: [] },
    ]);
    expect(graphTableRows(labels, (i) => adj[i], 2)).toHaveLength(2);
  });
});

describe("GraphTable", () => {
  it("a real table: caption, column and row headers, a note's name is a button that opens it", () => {
    const onOpen = vi.fn();
    const labels = Array.from({ length: 10 }, (_, i) => `n${i}`);
    const adj = labels.map((_, i) => (i === 0 ? labels.map((__, j) => j).slice(1) : [0]));
    render(<GraphTable labels={labels} neighbors={(i) => adj[i]} onOpen={onOpen} />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["graph.table.note", "graph.table.links", "graph.table.linkedTo"]);
    expect(within(table).getAllByRole("rowheader")).toHaveLength(10);
    // The hub first: 9 links, 8 named and "and 1 more".
    const hub = within(table).getAllByRole("row")[1];
    expect(hub.textContent).toContain("9");
    expect(hub.textContent).toContain("n1, n2, n3, n4, n5, n6, n7, n8 graph.table.more");
    fireEvent.click(within(hub).getByRole("button", { name: "n0" }));
    expect(onOpen).toHaveBeenCalledWith(0);
  });
});

describe("GraphView: the canvas or the table", () => {
  it("the toggle shows the vault's notes and links as a table, and back to the canvas", async () => {
    const { GraphView } = await import("../ui/GraphView");
    const onOpenFile = vi.fn();
    render(<GraphView onOpenFile={onOpenFile} />);
    await screen.findByTestId("graph-canvas");
    const toggle = screen.getByTestId("graph-as-table");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    const table = await screen.findByRole("table");
    expect(screen.queryByTestId("graph-canvas")).toBeNull();
    const rows = within(table).getAllByRole("row").slice(1).map((r) => [r.querySelector("th")!.textContent, r.querySelectorAll("td")[0].textContent]);
    // בית links to three notes; יומן is linked from two; בודד from none — the same edges the canvas draws.
    expect(rows).toEqual([
      ["בית", "3"],
      ["יומן", "2"],
      ["פרויקטים", "2"],
      ["Reading list", "1"],
      ["בודד", "0"],
    ]);
    fireEvent.click(within(table).getByRole("button", { name: "Reading list" }));
    await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith("Reading list.md", "# Reading list.md"));
    fireEvent.click(toggle);
    await screen.findByTestId("graph-canvas");
  });
});
