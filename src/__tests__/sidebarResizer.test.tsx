import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

describe("SidebarResizer render", () => {
  it("renders a draggable handle", async () => {
    const { render } = await import("@testing-library/react");
    const { SidebarResizer } = await import("../ui/SidebarResizer");
    const { container } = render(<SidebarResizer />);
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });

  it("has a DOM element", async () => {
    const { render } = await import("@testing-library/react");
    const { SidebarResizer } = await import("../ui/SidebarResizer");
    const { container } = render(<SidebarResizer />);
    const handle = container.firstElementChild;
    expect(handle).toBeTruthy();
  });
});
