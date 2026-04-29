import { describe, it, expect, vi } from "vitest";

// UpdateBanner imports virtual:pwa-register dynamically — mock it
vi.mock("virtual:pwa-register", () => ({
  registerSW: vi.fn(() => vi.fn()),
}));

describe("UpdateBanner render", () => {
  it("renders without crashing", async () => {
    const { render } = await import("@testing-library/react");
    const { UpdateBanner } = await import("../ui/UpdateBanner");
    const { container } = render(<UpdateBanner />);
    // By default, needRefresh is false so the banner is hidden
    expect(container).toBeDefined();
  });
});
