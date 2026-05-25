import { describe, it, expect, vi, beforeEach } from "vitest";

// FineTuneSettings uses the store; we test the rendering states
// by mocking the store + the AI modules.

vi.mock("../ai/fineTune", () => ({
  startFineTune: vi.fn(),
  getFineTuneJob: vi.fn(),
}));

vi.mock("./PromptDialog", () => ({
  uiConfirm: vi.fn().mockResolvedValue(false),
}));

vi.mock("./AiToast", () => ({
  showAiToast: vi.fn(),
}));

describe("FineTuneSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render when open=false", async () => {
    const { render } = await import("@testing-library/react");
    const { FineTuneSettings } = await import("../ui/FineTuneSettings");
    const { container } = render(
      <FineTuneSettings open={false} onClose={() => {}} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders dialog when open=true", async () => {
    const { render, screen } = await import("@testing-library/react");
    const { FineTuneSettings } = await import("../ui/FineTuneSettings");
    render(<FineTuneSettings open={true} onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toBeDefined();
  });

  it("has proper aria attributes", async () => {
    const { render } = await import("@testing-library/react");
    const { FineTuneSettings } = await import("../ui/FineTuneSettings");
    const { container } = render(<FineTuneSettings open={true} onClose={() => {}} />);
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog!.getAttribute("aria-modal")).toBe("true");
    expect(dialog!.getAttribute("aria-label")).toBeTruthy();
  });

  it("shows Train button when no model is set", async () => {
    const { render, screen } = await import("@testing-library/react");
    const { FineTuneSettings } = await import("../ui/FineTuneSettings");
    render(<FineTuneSettings open={true} onClose={() => {}} />);
    // Should have a train button
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(2); // Train + Close
  });

  it("calls onClose when close button clicked", async () => {
    const { render, screen, fireEvent } = await import("@testing-library/react");
    const { FineTuneSettings } = await import("../ui/FineTuneSettings");
    const onClose = vi.fn();
    render(<FineTuneSettings open={true} onClose={onClose} />);
    // Click the close button (last button)
    const buttons = screen.getAllByRole("button");
    const closeBtn = buttons[buttons.length - 1];
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
