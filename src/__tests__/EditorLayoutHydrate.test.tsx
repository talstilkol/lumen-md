/**
 * Regression test for ADR-001 / Bug #2.
 *
 * `EditorLayout` used to memoize the editor's `value` prop with
 * `useMemo(() => docContent, [docName, mode])`, capturing `docContent`
 * before async store hydration. When the welcome doc was seeded one
 * tick after first paint (docName/mode unchanged), the memo stayed
 * pinned to the empty string and the editor rendered blank forever.
 *
 * The fix removes the memo so the live `docContent` is forwarded on
 * every render; the Editor's internal sync effect handles the no-op
 * case via an equality check.
 *
 * This test pins the runtime contract: a tiny harness renders just
 * enough of the prop-forwarding chain to assert that a docContent
 * change after first mount actually lands in the consumer. We mock
 * the heavy Editor + Preview to keep the test focused on the
 * EditorLayout's pass-through behavior, not CM6 internals.
 */
import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { useState, useEffect } from "react";

// Capture the `value` prop the Editor receives so the test can assert
// it tracks the parent's docContent live.
const capturedValues: string[] = [];

vi.mock("../editor/Editor", () => ({
  Editor: (props: { value: string }) => {
    capturedValues.push(props.value);
    return <div data-testid="fake-editor">{props.value}</div>;
  },
}));
vi.mock("../renderer/Preview", () => ({
  Preview: () => <div data-testid="fake-preview" />,
}));
vi.mock("../ui/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../ui/WritingGoalBanner", () => ({
  WritingGoalBanner: () => null,
}));
vi.mock("../store/useStore", () => ({
  useAppStore: Object.assign(
    () => "auto",
    {
      getState: () => ({ syncScroll: "all" }),
    },
  ),
}));

describe("EditorLayout prop-forwarding contract (ADR-001)", () => {
  it("propagates docContent updates after first mount (regression: stale memo bug)", async () => {
    capturedValues.length = 0;
    const { EditorLayout } = await import("../layouts/EditorLayout");

    function Harness() {
      const [content, setContent] = useState("");
      useEffect(() => {
        // Simulate Zustand persist hydrating after first paint —
        // happens one microtick after mount.
        Promise.resolve().then(() => setContent("hydrated welcome doc"));
      }, []);
      return (
        <EditorLayout
          mode="split"
          docContent={content}
          deferredContent={content}
          editorRef={{ current: null }}
          vimEnabled={false}
          spellCheck={false}
          grammarCheck={false}
          typewriterMode={false}
          activeFile={null}
          pageView={false}
          collab={null}
          setContent={() => {}}
          handleAddAsset={async () => null}
        />
      );
    }
    render(<Harness />);
    // The Editor is React.lazy now, so its first mount lands AFTER Suspense
    // resolves — often after the hydration tick. The ADR-001 contract is
    // that the LATEST forwarded value is the hydrated one (the stale-memo
    // bug pinned it to "" forever); the exact first-frame value is a timing
    // detail we no longer assert.
    await waitFor(() => {
      expect(capturedValues).toContain("hydrated welcome doc");
    });
    expect(capturedValues[capturedValues.length - 1]).toBe("hydrated welcome doc");
  });
});
