import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

describe("OnboardingTour render", () => {
  it("does not render when open=false", async () => {
    const { render } = await import("@testing-library/react");
    const { OnboardingTour } = await import("../ui/OnboardingTour");
    const { container } = render(
      <OnboardingTour open={false} onClose={() => {}} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders when open=true", async () => {
    const { render } = await import("@testing-library/react");
    const { OnboardingTour } = await import("../ui/OnboardingTour");
    const { container } = render(
      <OnboardingTour open={true} onClose={() => {}} />,
    );
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });

  it("shows step content", async () => {
    const { render } = await import("@testing-library/react");
    const { OnboardingTour } = await import("../ui/OnboardingTour");
    const { container } = render(
      <OnboardingTour open={true} onClose={() => {}} />,
    );
    // Should have some step text visible
    const text = container.textContent ?? "";
    expect(text.length).toBeGreaterThan(10);
  });
});
