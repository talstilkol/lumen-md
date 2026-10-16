/**
 * Suggesting mode tracks edits in WYSIWYG too (editor/wysiwygSuggest.ts),
 * so the two coexist: no forced switch to Split any more, and the palette's
 * cursor commands reach the WYSIWYG editor through the bridge.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore } from "../store/useStore";
import { useToastStore } from "../store/useToastStore";
import { buildSuggestingCommands } from "../editor/suggestingCommands";
import { setWysiwygSuggestActions } from "../editor/wysiwygSuggestBridge";

beforeEach(() => {
  useAppStore.setState({ mode: "source", suggestingMode: false });
  useToastStore.setState({ toasts: [] } as never);
  setWysiwygSuggestActions(null);
});

describe("suggesting mode × WYSIWYG", () => {
  it("WYSIWYG can be entered while suggesting, and suggesting turned on in WYSIWYG", () => {
    useAppStore.setState({ suggestingMode: true });
    useAppStore.getState().setMode("wysiwyg");
    expect(useAppStore.getState().mode).toBe("wysiwyg");
    useAppStore.setState({ suggestingMode: false });
    useAppStore.getState().toggleSuggestingMode();
    expect(useAppStore.getState()).toMatchObject({ suggestingMode: true, mode: "wysiwyg" });
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("cursor commands go to the WYSIWYG editor when no source editor is mounted", () => {
    const resolve = vi.fn(() => true);
    const jump = vi.fn(() => true);
    setWysiwygSuggestActions({ resolve, jump });
    const cmds = buildSuggestingCommands({
      getView: () => null,
      getContent: () => "",
      setContent: () => {},
      suggesting: true,
      toggle: () => {},
    });
    const run = (id: string) => cmds.find((c) => c.id === id)!.action();
    run("edit.suggesting.accept");
    run("edit.suggesting.reject");
    run("edit.suggesting.next");
    run("edit.suggesting.prev");
    expect(resolve.mock.calls).toEqual([["accept"], ["reject"]]);
    expect(jump.mock.calls).toEqual([[1], [-1]]);
  });
});
