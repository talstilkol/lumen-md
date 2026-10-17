/**
 * WysiwygEditor lifecycle race (LAUNCH-READINESS #10 / M10 follow-up 2).
 *
 * Milkdown's `create()` / `destroy()` are async. Before the lifecycle
 * queue landed, rapid mount/unmount or value churn could:
 *   - mount two ProseMirror views into the same host (a rebuild started
 *     while the previous one was still awaiting `create()`), and
 *   - leave orphaned slash/tooltip menus in <body> after unmount.
 * e2e/user-journey.spec.ts used `waitForTimeout` between mode switches to
 * dodge this. These tests drive the real Milkdown stack in jsdom.
 */
import { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WysiwygEditor from "../editor/WysiwygEditor";
import { getActiveWysiwygView } from "../editor/wysiwygSuggest";
import { getWysiwygSuggestActions } from "../editor/wysiwygSuggestBridge";

vi.mock("../ai/llm", () => ({
  chat: vi.fn(),
  chatStream: vi.fn(),
  AiError: class AiError extends Error {},
}));

/** Let Milkdown's async plugin loading + our lifecycle queue settle. */
async function settle(ms = 400) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("WysiwygEditor lifecycle sequencing", () => {
  it("rapid value changes never mount two editors at once and end on the latest value", async () => {
    const onChange = vi.fn();
    // Track the peak number of live ProseMirror views over the whole run —
    // the end state alone hides the transient double-mount.
    let peak = 0;
    const mo = new MutationObserver(() => {
      peak = Math.max(peak, document.querySelectorAll(".ProseMirror").length);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    const { container, rerender } = render(
      <WysiwygEditor value={"# one"} onChange={onChange} />,
    );
    // Fire value changes back-to-back, well inside create()'s async window.
    rerender(<WysiwygEditor value={"# two"} onChange={onChange} />);
    rerender(<WysiwygEditor value={"# three"} onChange={onChange} />);
    await settle();
    const views = container.querySelectorAll(".ProseMirror");
    expect(views.length).toBe(1);
    expect(views[0].textContent).toContain("three");
    expect(container.querySelectorAll(".milkdown").length).toBe(1);
    mo.disconnect();
    expect(peak).toBe(1);
  });

  it("unmount + immediate remount (mode flip back) never overlaps editors", async () => {
    let peak = 0;
    const mo = new MutationObserver(() => {
      peak = Math.max(peak, document.querySelectorAll(".ProseMirror").length);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    const first = render(<WysiwygEditor value={"# a"} onChange={() => {}} />);
    await settle();
    first.unmount();
    render(<WysiwygEditor value={"# b"} onChange={() => {}} />);
    await settle();
    mo.disconnect();
    expect(document.querySelectorAll(".ProseMirror").length).toBe(1);
    expect(document.querySelectorAll(".milkdown-slash-menu").length).toBeLessThanOrEqual(1);
    expect(peak).toBe(1);
  });

  it("StrictMode mount → unmount → remount yields a single editor", async () => {
    const { container } = render(
      <StrictMode>
        <WysiwygEditor value={"# strict"} onChange={() => {}} />
      </StrictMode>,
    );
    await settle();
    expect(container.querySelectorAll(".ProseMirror").length).toBe(1);
  });

  it("unmounting while create() is pending tears everything down cleanly", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // Rapid mode switching: mount/unmount several instances back-to-back.
    for (let i = 0; i < 5; i++) {
      const { unmount } = render(
        <WysiwygEditor value={`# round ${i}`} onChange={() => {}} />,
      );
      unmount();
    }
    await settle(600);
    expect(document.querySelectorAll(".ProseMirror").length).toBe(0);
    expect(document.querySelectorAll(".milkdown-slash-menu").length).toBe(0);
    expect(document.querySelectorAll(".milkdown-tooltip").length).toBe(0);
    const lifecycleWarnings = warn.mock.calls.filter((c) =>
      c.some((a) => typeof a === "string" && /wysiwyg/.test(a)),
    );
    expect(lifecycleWarnings).toEqual([]);
    expect(error).not.toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
  });

  it("a superseded editor never emits onChange", async () => {
    const onChange = vi.fn();
    const { rerender, unmount } = render(
      <WysiwygEditor value={"# first"} onChange={onChange} />,
    );
    await settle();
    rerender(<WysiwygEditor value={"# second"} onChange={onChange} />);
    unmount();
    await settle(600);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closing a second instance (Focus Mode) keeps the remaining one registered", async () => {
    const main = render(<WysiwygEditor value={"Main {++x++} doc"} onChange={() => {}} />);
    const focus = render(<WysiwygEditor value={"Focus doc"} onChange={() => {}} />);
    await settle();
    expect(focus.container.contains(getActiveWysiwygView()!.dom)).toBe(true);
    focus.unmount();
    await settle();
    expect(main.container.contains(getActiveWysiwygView()?.dom ?? null)).toBe(true);
    expect(getWysiwygSuggestActions()?.jump(1)).toBe(true);
    main.unmount();
    await settle();
    expect(getWysiwygSuggestActions()).toBeNull();
  });
});
