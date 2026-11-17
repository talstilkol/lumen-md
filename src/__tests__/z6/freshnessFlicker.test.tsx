/**
 * Review Z6-L4 (2.31): the "Freshness verified" line went away on every sync round while freshness() was re-read,
 * and came back when it answered: a blink with every auto-sync. Now the last answer stays while the re-read is out
 * (for at most FRESHNESS_STALE_MS); a failed read or an unverified one still hides it at once. The sync is a fake.
 */
import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { FreshnessBanner } from "../../sync/e2ee/ui/FreshnessBanner";

type F = { source: "paired"; verified: boolean; counter: number };

function fakeSync(answers: Array<() => Promise<F>>) {
  let listener: () => void = () => {};
  let i = 0;
  const sync = {
    freshness: vi.fn(() => (answers[Math.min(i++, answers.length - 1)] ?? (() => Promise.reject(new Error("none"))))()),
    pair: vi.fn(async () => {}),
    confirmFreshness: vi.fn(async () => {}),
    onChange: (l: () => void) => ((listener = l), () => {}),
  };
  return { sync, round: () => listener() };
}
const later = (f: F, ms: number) => () => new Promise<F>((r) => setTimeout(() => r(f), ms));
const now = (f: F) => () => Promise.resolve(f);

describe("FreshnessBanner across sync rounds (Z6-L4)", () => {
  it("the verified line stays on screen through a round whose re-read answers verified", async () => {
    const v = { source: "paired" as const, verified: true, counter: 3 };
    const { sync, round } = fakeSync([now(v), later({ ...v, counter: 4 }, 30), later({ ...v, counter: 5 }, 30)]);
    render(<FreshnessBanner sync={sync as never} />);
    expect((await screen.findByRole("status")).textContent).toBe("Freshness verified");
    for (let k = 0; k < 2; k++) {
      act(() => round());
      // Right after the round, while the re-read is out: still there (no blink).
      expect(screen.queryByRole("status")?.textContent).toBe("Freshness verified");
      await act(async () => new Promise((r) => setTimeout(r, 60)));
      expect(screen.queryByRole("status")?.textContent).toBe("Freshness verified");
    }
  });

  it("a round that revokes it hides it as soon as the re-read says so", async () => {
    const v = { source: "paired" as const, verified: true, counter: 3 };
    const { sync, round } = fakeSync([now(v), later({ ...v, verified: false }, 20)]);
    render(<FreshnessBanner sync={sync as never} />);
    await screen.findByRole("status");
    act(() => round());
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect((await screen.findByRole("alert")).textContent).toContain("Freshness not verified");
  });

  it("a re-read that never answers leaves it shown for at most staleMs", async () => {
    const v = { source: "paired" as const, verified: true, counter: 3 };
    const { sync, round } = fakeSync([now(v), () => new Promise<F>(() => {})]);
    const { container } = render(<FreshnessBanner sync={sync as never} staleMs={50} />);
    await screen.findByRole("status");
    act(() => round());
    expect(screen.queryByRole("status")).not.toBeNull();
    await waitFor(() => expect(container.textContent).toBe(""));
  });
});
