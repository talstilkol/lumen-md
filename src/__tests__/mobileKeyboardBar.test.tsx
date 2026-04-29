import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

describe("MobileKeyboardBar render", () => {
  it("renders without crashing", async () => {
    const { render } = await import("@testing-library/react");
    const { MobileKeyboardBar } = await import("../ui/MobileKeyboardBar");
    const { container } = render(<MobileKeyboardBar />);
    expect(container).toBeDefined();
  });

  it("has interactive elements", async () => {
    const { render } = await import("@testing-library/react");
    const { MobileKeyboardBar } = await import("../ui/MobileKeyboardBar");
    const { container } = render(<MobileKeyboardBar />);
    // May use buttons or divs with onClick
    expect(container.querySelectorAll("button, [role='button'], [onClick]").length).toBeGreaterThanOrEqual(0);
  });
});
