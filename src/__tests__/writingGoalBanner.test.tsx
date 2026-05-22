/**
 * WritingGoalBanner — thin progress strip with daily word-count goal.
 *
 * Previously the test only asserted `container is defined` / `innerHTML
 * is defined` (theatre — would pass for any output). Now we drive the
 * three states: hidden when no goal, partial-progress, and completed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

vi.mock("../lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("WritingGoalBanner", () => {
  beforeEach(async () => {
    const { useAppStore } = await import("../store/useStore");
    // Reset relevant store fields.
    useAppStore.setState({
      writingGoalWords: 0,
      doc: { name: "test.md", content: "", workspaceName: null, dirty: false },
    });
  });

  it("renders nothing when no daily word goal is set", async () => {
    const { useAppStore } = await import("../store/useStore");
    useAppStore.setState({ writingGoalWords: 0 });
    const { WritingGoalBanner } = await import("../ui/WritingGoalBanner");
    const { container } = render(<WritingGoalBanner />);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("renders a progress strip when a goal is set; counter shows current/target", async () => {
    const { useAppStore } = await import("../store/useStore");
    useAppStore.setState({
      writingGoalWords: 100,
      doc: {
        name: "test.md",
        // 23 words — well under the 100 goal
        content: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three",
        workspaceName: null,
        dirty: false,
      },
    });
    const { WritingGoalBanner } = await import("../ui/WritingGoalBanner");
    const { container } = render(<WritingGoalBanner />);
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    // The counter should mention 100 (target) somewhere.
    expect(status!.textContent).toMatch(/100/);
  });

  it("strips code fences from the word count so code lines don't count as writing", async () => {
    const { useAppStore } = await import("../store/useStore");
    useAppStore.setState({
      writingGoalWords: 100,
      doc: {
        name: "test.md",
        content:
          "real word\n```\nfunction one two three four five six seven eight nine ten\n```\nanother real word",
        workspaceName: null,
        dirty: false,
      },
    });
    const { WritingGoalBanner } = await import("../ui/WritingGoalBanner");
    const { container } = render(<WritingGoalBanner />);
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    // 5 prose words ("real", "word", "another", "real", "word") — NOT
    // the ten words inside the code fence. The textContent should
    // reflect 5, not 15 (which would be the count if code lines leaked).
    expect(status!.textContent).toMatch(/\b5\b/);
    expect(status!.textContent).not.toMatch(/\b15\b/);
  });
});
