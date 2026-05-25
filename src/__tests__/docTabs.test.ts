/**
 * Tests for the multi-document tab actions in `useAppStore`.
 *
 * Covers:
 *   - openTab pushes new tabs and switches focus
 *   - re-opening an active tab is idempotent (no duplicates)
 *   - closeTab removes the tab and falls back to the neighbour
 *   - reorderTabs handles drag-source / drag-target index pairs
 *   - tabIdOf produces a stable identity for both workspace & ad-hoc docs
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore, tabIdOf } from "../store/useStore";

function reset() {
  useAppStore.setState({
    doc: { name: "Untitled.md", content: "", dirty: false, workspaceName: null },
    openTabs: [],
    tagFilter: null,
  });
}

describe("tabIdOf", () => {
  it("uses workspaceName when present (unique across the vault)", () => {
    expect(tabIdOf({ workspaceName: "notes/a.md", name: "a.md" })).toBe("notes/a.md");
  });
  it("falls back to display name for ad-hoc docs", () => {
    expect(tabIdOf({ workspaceName: null, name: "Scratch.md" })).toBe("Scratch.md");
  });
  it("returns a non-empty string even for an unnamed doc", () => {
    expect(tabIdOf({ name: "" })).toBeTruthy();
  });
});

describe("openTab", () => {
  beforeEach(reset);

  it("adds a new tab to the strip and makes it active", () => {
    useAppStore.getState().openTab({ name: "first.md", content: "1", workspaceName: "first.md" });
    expect(useAppStore.getState().openTabs.map((t) => t.id)).toEqual(["first.md"]);
    expect(useAppStore.getState().doc.name).toBe("first.md");
  });

  it("re-opening an already-open doc is idempotent", () => {
    useAppStore.getState().openTab({ name: "a.md", content: "A", workspaceName: "a.md" });
    useAppStore.getState().openTab({ name: "b.md", content: "B", workspaceName: "b.md" });
    useAppStore.getState().openTab({ name: "a.md", content: "A", workspaceName: "a.md" });
    expect(useAppStore.getState().openTabs.map((t) => t.id)).toEqual(["a.md", "b.md"]);
    expect(useAppStore.getState().doc.workspaceName).toBe("a.md");
  });

  it("preserves unsaved edits in the previous tab when switching away", () => {
    useAppStore.getState().openTab({ name: "a.md", content: "original-A", workspaceName: "a.md" });
    // Edit
    useAppStore.getState().setContent("dirty-A");
    expect(useAppStore.getState().doc.dirty).toBe(true);
    // Switch to a new tab
    useAppStore.getState().openTab({ name: "b.md", content: "B", workspaceName: "b.md" });
    // Switch back
    useAppStore.getState().openTab({ name: "a.md", content: "anything", workspaceName: "a.md" });
    // The dirty edit is still on the tab record (not the original content)
    const aTab = useAppStore.getState().openTabs.find((t) => t.id === "a.md");
    expect(aTab?.content).toBe("dirty-A");
    expect(aTab?.dirty).toBe(true);
  });
});

describe("closeTab", () => {
  beforeEach(reset);

  it("removes the tab and keeps the active doc when a non-active tab closes", () => {
    useAppStore.getState().openTab({ name: "a.md", content: "A", workspaceName: "a.md" });
    useAppStore.getState().openTab({ name: "b.md", content: "B", workspaceName: "b.md" });
    // active is b — close a (non-active)
    useAppStore.getState().closeTab("a.md");
    expect(useAppStore.getState().openTabs.map((t) => t.id)).toEqual(["b.md"]);
    expect(useAppStore.getState().doc.workspaceName).toBe("b.md");
  });

  it("falls back to the neighbour when the active tab is closed", () => {
    useAppStore.getState().openTab({ name: "a.md", content: "A", workspaceName: "a.md" });
    useAppStore.getState().openTab({ name: "b.md", content: "B", workspaceName: "b.md" });
    useAppStore.getState().openTab({ name: "c.md", content: "C", workspaceName: "c.md" });
    // active is c — close it
    useAppStore.getState().closeTab("c.md");
    expect(useAppStore.getState().openTabs.map((t) => t.id)).toEqual(["a.md", "b.md"]);
    // Active should fall back to b (the previous neighbour).
    expect(useAppStore.getState().doc.workspaceName).toBe("b.md");
  });

  it("resets to a blank Untitled when the last tab closes", () => {
    useAppStore.getState().openTab({ name: "only.md", content: "x", workspaceName: "only.md" });
    useAppStore.getState().closeTab("only.md");
    expect(useAppStore.getState().openTabs).toEqual([]);
    expect(useAppStore.getState().doc.name).toBe("Untitled.md");
    expect(useAppStore.getState().doc.content).toBe("");
  });

  it("is a safe no-op when given an unknown id", () => {
    useAppStore.getState().openTab({ name: "a.md", content: "A", workspaceName: "a.md" });
    useAppStore.getState().closeTab("does-not-exist");
    expect(useAppStore.getState().openTabs.map((t) => t.id)).toEqual(["a.md"]);
  });
});

describe("reorderTabs", () => {
  beforeEach(reset);

  it("moves a tab from one index to another", () => {
    useAppStore.getState().openTab({ name: "a.md", content: "A", workspaceName: "a.md" });
    useAppStore.getState().openTab({ name: "b.md", content: "B", workspaceName: "b.md" });
    useAppStore.getState().openTab({ name: "c.md", content: "C", workspaceName: "c.md" });
    // Move c (index 2) to position 0 → [c, a, b]
    useAppStore.getState().reorderTabs(2, 0);
    expect(useAppStore.getState().openTabs.map((t) => t.id)).toEqual([
      "c.md",
      "a.md",
      "b.md",
    ]);
  });

  it("clamps an out-of-range target index to the strip length", () => {
    useAppStore.getState().openTab({ name: "a.md", content: "A", workspaceName: "a.md" });
    useAppStore.getState().openTab({ name: "b.md", content: "B", workspaceName: "b.md" });
    useAppStore.getState().reorderTabs(0, 999);
    expect(useAppStore.getState().openTabs.map((t) => t.id)).toEqual(["b.md", "a.md"]);
  });

  it("is a no-op when fromIndex === toIndex", () => {
    useAppStore.getState().openTab({ name: "a.md", content: "A", workspaceName: "a.md" });
    useAppStore.getState().openTab({ name: "b.md", content: "B", workspaceName: "b.md" });
    const before = useAppStore.getState().openTabs;
    useAppStore.getState().reorderTabs(0, 0);
    expect(useAppStore.getState().openTabs).toEqual(before);
  });

  it("is a no-op when fromIndex is out of range", () => {
    useAppStore.getState().openTab({ name: "a.md", content: "A", workspaceName: "a.md" });
    const before = useAppStore.getState().openTabs;
    useAppStore.getState().reorderTabs(42, 0);
    expect(useAppStore.getState().openTabs).toEqual(before);
  });
});
