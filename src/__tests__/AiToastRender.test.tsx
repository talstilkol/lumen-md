import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { AiToastContainer, showAiToast } from "../ui/AiToast";

vi.mock("../i18n", () => ({ t: (k: string) => k }));
vi.mock("../lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("AiToastContainer", () => {
  it("renders without crashing (empty state)", () => {
    const { container } = render(<AiToastContainer />);
    expect(container.firstChild).toBeNull();
  });

  it("shows a toast when showAiToast is called", () => {
    const { container } = render(<AiToastContainer />);
    act(() => { showAiToast("Test message", "info"); });
    expect(container.textContent).toContain("Test message");
  });

  it("shows success type toast", () => {
    const { container } = render(<AiToastContainer />);
    act(() => { showAiToast("Saved!", "success"); });
    expect(container.textContent).toContain("Saved!");
  });

  it("shows error type toast", () => {
    const { container } = render(<AiToastContainer />);
    act(() => { showAiToast("Something failed", "error"); });
    expect(container.textContent).toContain("Something failed");
  });

  it("dismiss button removes the toast", () => {
    const { container } = render(<AiToastContainer />);
    act(() => { showAiToast("Dismiss me", "info"); });
    const dismissBtn = container.querySelector("button[aria-label]") as HTMLButtonElement;
    expect(dismissBtn).not.toBeNull();
    fireEvent.click(dismissBtn);
    expect(container.textContent).not.toContain("Dismiss me");
  });

  it("shows multiple toasts simultaneously", () => {
    const { container } = render(<AiToastContainer />);
    act(() => {
      showAiToast("First", "info");
      showAiToast("Second", "success");
    });
    expect(container.textContent).toContain("First");
    expect(container.textContent).toContain("Second");
  });
});
