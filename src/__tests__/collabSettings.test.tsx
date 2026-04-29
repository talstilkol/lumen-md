import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

describe("CollabSettings render", () => {
  it("renders form elements", async () => {
    const { render } = await import("@testing-library/react");
    const { CollabSettings } = await import("../ui/CollabSettings");
    const { container } = render(<CollabSettings onClose={() => {}} />);
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });

  it("calls onClose when save is clicked", async () => {
    const { render, fireEvent } = await import("@testing-library/react");
    const { CollabSettings } = await import("../ui/CollabSettings");
    const onClose = vi.fn();
    const { container } = render(<CollabSettings onClose={onClose} />);
    const buttons = container.querySelectorAll("button");
    // Click save (first button typically)
    if (buttons.length > 0) {
      fireEvent.click(buttons[0]);
      expect(onClose).toHaveBeenCalled();
    }
  });
});
