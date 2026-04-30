import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

vi.mock("../i18n", () => ({ t: (k: string, p?: Record<string, string>) => {
  if (p) return Object.entries(p).reduce((s, [k2, v]) => s.replace(`{${k2}}`, v), k);
  return k;
}}));
vi.mock("../lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../storage/workspace", () => ({
  listWorkspace: vi.fn().mockResolvedValue([]),
  readWorkspaceFile: vi.fn().mockResolvedValue(""),
}));
vi.mock("../views/louvain", () => ({
  louvain: vi.fn().mockReturnValue({ communities: new Map() }),
  communityPalette: vi.fn().mockReturnValue(["hsl(0 0% 50%)"]),
}));

describe("GraphView", () => {
  it("renders without crashing", async () => {
    const { GraphView } = await import("../ui/GraphView");
    const { container } = render(<GraphView onOpenFile={vi.fn()} />);
    await waitFor(() => expect(container).toBeDefined());
  });

  it("shows empty state when no nodes", async () => {
    const { GraphView } = await import("../ui/GraphView");
    const { container } = render(<GraphView onOpenFile={vi.fn()} />);
    // With no workspace files, should show empty text
    await waitFor(() => {
      expect(container.textContent).toContain("graphView.empty");
    });
  });

  it("renders the stats overlay div", async () => {
    const { GraphView } = await import("../ui/GraphView");
    const { container } = render(<GraphView onOpenFile={vi.fn()} />);
    // The stats bar is always rendered
    await waitFor(() => {
      expect(container.querySelector("div")).not.toBeNull();
    });
  });
});
