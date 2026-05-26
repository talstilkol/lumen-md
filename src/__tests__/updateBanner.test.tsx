import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * UpdateBanner — listens to virtual:pwa-register's `onNeedRefresh`
 * callback and shows a Reload affordance. Previously this test only
 * asserted "container is defined" which is theatre — it would pass
 * even if the banner never rendered.
 *
 * Now we capture the callback supplied to registerSW, fire it, and
 * verify the banner appears + the reload button invokes the returned
 * updateSW(true).
 */

let capturedOnNeedRefresh: (() => void) | null = null;
const updateSwSpy = vi.fn();

vi.mock("virtual:pwa-register", () => ({
  registerSW: vi.fn((opts: { onNeedRefresh?: () => void }) => {
    capturedOnNeedRefresh = opts?.onNeedRefresh ?? null;
    return updateSwSpy;
  }),
}));

describe("UpdateBanner", () => {
  beforeEach(() => {
    capturedOnNeedRefresh = null;
    updateSwSpy.mockClear();
  });

  it("renders nothing before a service-worker prompts for refresh", async () => {
    const { render } = await import("@testing-library/react");
    const { UpdateBanner } = await import("../ui/UpdateBanner");
    const { container } = render(<UpdateBanner />);
    expect(container.querySelector(".pwa-update-banner")).toBeNull();
  });

  it("shows the banner after onNeedRefresh fires; reload button invokes updateSW(true)", async () => {
    const { render, act, screen, waitFor } = await import("@testing-library/react");
    const { UpdateBanner } = await import("../ui/UpdateBanner");
    render(<UpdateBanner />);
    // The component does an async `import("virtual:pwa-register")` inside
    // useEffect. A single setTimeout(0) tick isn't enough when the test
    // runner is under CPU pressure (full coverage runs were intermittently
    // racing past the import resolution). Poll until the captured callback
    // is wired up — fast in the common case, robust under load.
    await waitFor(() => {
      expect(capturedOnNeedRefresh).not.toBeNull();
    });
    await act(async () => {
      capturedOnNeedRefresh?.();
    });
    const banner = screen.getByRole("status");
    expect(banner.className).toContain("pwa-update-banner");
    const reloadBtn = banner.querySelector(".pwa-update-btn") as HTMLButtonElement;
    expect(reloadBtn).not.toBeNull();
    reloadBtn.click();
    expect(updateSwSpy).toHaveBeenCalledWith(true);
  });
});
