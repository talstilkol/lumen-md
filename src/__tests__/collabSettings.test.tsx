import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * CollabSettings — set/clear the custom collab signaling URL.
 * Previously this test just clicked "the first button" and hoped it
 * was Save (theatre — could pass clicking Cancel). And the assertion
 * itself was guarded by `if (buttons.length > 0)` which makes the
 * test pass-by-default when the component fails to render. Now we
 * drive the actual flow: type a URL, click Save, verify localStorage
 * was set.
 */

vi.mock("../lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("CollabSettings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists the typed URL to lumen.collab.signaling and calls onClose", async () => {
    const { render, fireEvent } = await import("@testing-library/react");
    const { CollabSettings } = await import("../ui/CollabSettings");
    const onClose = vi.fn();
    const { container } = render(<CollabSettings onClose={onClose} />);
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { value: "wss://signal.example.com" } });
    const saveBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.match(/save/i),
    ) as HTMLButtonElement;
    expect(saveBtn).toBeDefined();
    fireEvent.click(saveBtn);
    expect(localStorage.getItem("lumen.collab.signaling")).toBe(
      "wss://signal.example.com",
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("clears the stored URL when saved with empty input", async () => {
    localStorage.setItem("lumen.collab.signaling", "wss://old.example.com");
    const { render, fireEvent } = await import("@testing-library/react");
    const { CollabSettings } = await import("../ui/CollabSettings");
    const onClose = vi.fn();
    const { container } = render(<CollabSettings onClose={onClose} />);
    const input = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    const saveBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.match(/save/i),
    ) as HTMLButtonElement;
    fireEvent.click(saveBtn);
    expect(localStorage.getItem("lumen.collab.signaling")).toBeNull();
    expect(onClose).toHaveBeenCalled();
  });
});
