import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "../store/useStore";

/**
 * Unit tests for the global Zustand store.
 *
 * These exercise the action setters that the rest of the app relies on for
 * state transitions (mode, theme, locale, doc edit, dirty tracking, RTL,
 * panel toggles). The store is recreated cleanly between tests via
 * `setState` resets.
 */

describe("useAppStore", () => {
  beforeEach(() => {
    useAppStore.setState({
      doc: { name: "Welcome.md", content: "", dirty: false },
      mode: "split",
      theme: "dark",
      locale: "en",
      showOutline: true,
      showWorkspace: false,
      showBacklinks: false,
      vimEnabled: false,
      rtl: false,
      autoSave: true,
      autoSaveInterval: 30000,
      syncScroll: "all",
      pageView: false,
      aiKey: null,
    });
  });

  it("setMode switches view mode", () => {
    useAppStore.getState().setMode("preview");
    expect(useAppStore.getState().mode).toBe("preview");

    useAppStore.getState().setMode("wysiwyg");
    expect(useAppStore.getState().mode).toBe("wysiwyg");
  });

  it("setContent marks the doc dirty", () => {
    useAppStore.getState().setContent("Hello");
    const { doc } = useAppStore.getState();
    expect(doc.content).toBe("Hello");
    expect(doc.dirty).toBe(true);
  });

  it("markSaved clears the dirty flag", () => {
    useAppStore.getState().setContent("dirty");
    expect(useAppStore.getState().doc.dirty).toBe(true);
    useAppStore.getState().markSaved();
    expect(useAppStore.getState().doc.dirty).toBe(false);
  });

  it("setDoc merges partial updates without losing fields", () => {
    useAppStore.getState().setDoc({ name: "next.md" });
    expect(useAppStore.getState().doc.name).toBe("next.md");
    // content untouched
    expect(useAppStore.getState().doc.content).toBe("");
  });

  it("toggleOutline / toggleWorkspace / toggleBacklinks flip booleans", () => {
    const before = useAppStore.getState();
    useAppStore.getState().toggleOutline();
    useAppStore.getState().toggleWorkspace();
    useAppStore.getState().toggleBacklinks();
    const after = useAppStore.getState();
    expect(after.showOutline).toBe(!before.showOutline);
    expect(after.showWorkspace).toBe(!before.showWorkspace);
    expect(after.showBacklinks).toBe(!before.showBacklinks);
  });

  it("toggleRtl flips rtl flag", () => {
    expect(useAppStore.getState().rtl).toBe(false);
    useAppStore.getState().toggleRtl();
    expect(useAppStore.getState().rtl).toBe(true);
    useAppStore.getState().toggleRtl();
    expect(useAppStore.getState().rtl).toBe(false);
  });

  it("toggleSyncScroll alternates 'all' and 'single'", () => {
    expect(useAppStore.getState().syncScroll).toBe("all");
    useAppStore.getState().toggleSyncScroll();
    expect(useAppStore.getState().syncScroll).toBe("single");
    useAppStore.getState().toggleSyncScroll();
    expect(useAppStore.getState().syncScroll).toBe("all");
  });

  it("setAutoSaveInterval persists exact ms value", () => {
    useAppStore.getState().setAutoSaveInterval(15000);
    expect(useAppStore.getState().autoSaveInterval).toBe(15000);
  });

  it("setAiKey can clear by passing null", () => {
    useAppStore.getState().setAiKey("sk-test");
    expect(useAppStore.getState().aiKey).toBe("sk-test");
    useAppStore.getState().setAiKey(null);
    expect(useAppStore.getState().aiKey).toBeNull();
  });

  it("setTagFilter stores the active tag and its allowed paths", () => {
    expect(useAppStore.getState().tagFilter).toBeNull();
    useAppStore.getState().setTagFilter({
      tag: "work",
      paths: ["a.md", "folder/b.md"],
    });
    const f = useAppStore.getState().tagFilter;
    expect(f?.tag).toBe("work");
    expect(f?.paths).toEqual(["a.md", "folder/b.md"]);
  });

  it("setTagFilter(null) clears the active filter", () => {
    useAppStore.getState().setTagFilter({ tag: "x", paths: ["x.md"] });
    useAppStore.getState().setTagFilter(null);
    expect(useAppStore.getState().tagFilter).toBeNull();
  });

  it("toggleGrammarCheck flips the grammar-check flag (defaults to off)", () => {
    expect(useAppStore.getState().grammarCheck).toBe(false);
    useAppStore.getState().toggleGrammarCheck();
    expect(useAppStore.getState().grammarCheck).toBe(true);
    useAppStore.getState().toggleGrammarCheck();
    expect(useAppStore.getState().grammarCheck).toBe(false);
  });
});
