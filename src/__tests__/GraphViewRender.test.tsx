import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

vi.mock("../i18n", () => ({ registerEnglish: () => undefined, t: (k: string, p?: Record<string, string>) => {
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
// The graph (plan W1.10) is built from the vault index.
vi.mock("../storage/workspaceIndex", () => ({
  ensureIndex: vi.fn().mockResolvedValue(undefined),
  indexedFiles: vi.fn().mockReturnValue([]),
}));
// The layout itself is tested in graph10k.test.ts; here every note sits at the origin.
vi.mock("../graph/layoutClient", () => ({
  runLayout: vi.fn(async (n: number) => new Float32Array(2 * n)),
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

describe("GraphView by touch (plan 10.2.1)", () => {
  // One note on an 800×600 surface: fitted, it sits at the centre (400, 300).
  // Zoomed out by the "-" key, its dot is smaller than the hit areas, so the
  // test measures the 10 px of the cursor and the 22 px of a finger.
  const nodeX = 400;
  const nodeY = 300;

  async function mount() {
    const ws = await import("../storage/workspace");
    const index = await import("../storage/workspaceIndex");
    // The graph is built from the vault index (W1.10), not from a listing of the folder.
    vi.mocked(index.indexedFiles).mockReturnValue([{ path: "a.md", wikiTargets: [], meta: {}, modified: 1 }] as never);
    vi.mocked(ws.readWorkspaceFile).mockResolvedValue("# A");
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    const { fireEvent } = await import("@testing-library/react");
    const { GraphView } = await import("../ui/GraphView");
    const onOpenFile = vi.fn();
    const { findByRole } = render(<GraphView onOpenFile={onOpenFile} />);
    const surface = await findByRole("application");
    fireEvent.focus(surface);
    await waitFor(() => expect(surface.getAttribute("data-focus")).toBe("0"));
    for (let i = 0; i < 8; i++) fireEvent.keyDown(surface, { key: "-" });
    return { surface, onOpenFile, fireEvent };
  }
  const press = (fireEvent: typeof import("@testing-library/react").fireEvent, el: HTMLElement, pointerType: string, dx: number) => {
    fireEvent.pointerDown(el, { pointerType, clientX: nodeX + dx, clientY: nodeY });
    fireEvent.pointerUp(el, { pointerType, clientX: nodeX + dx, clientY: nodeY });
  };

  it("a tap opens the note under the finger, with nothing hovered before", async () => {
    const { surface, onOpenFile, fireEvent } = await mount();
    // 15 px off the dot: inside a finger's 22 px, outside the cursor's 10 px.
    press(fireEvent, surface, "touch", 15);
    await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith("a.md", "# A"));
  });

  it("the mouse keeps the tighter hit area", async () => {
    const { surface, onOpenFile, fireEvent } = await mount();
    press(fireEvent, surface, "mouse", 15);
    await new Promise((r) => setTimeout(r, 20));
    expect(onOpenFile).not.toHaveBeenCalled();
    // A finger 30 px away is outside its 22 px too.
    press(fireEvent, surface, "touch", 30);
    await new Promise((r) => setTimeout(r, 20));
    expect(onOpenFile).not.toHaveBeenCalled();
    press(fireEvent, surface, "mouse", 3);
    await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith("a.md", "# A"));
  });
});
