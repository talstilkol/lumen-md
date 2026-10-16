/**
 * Suggesting mode only tracks edits in the source editor, so it must never
 * coexist with WYSIWYG (whose edits would bypass CriticMarkup).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "../store/useStore";
import { useToastStore } from "../store/useToastStore";

beforeEach(() => {
  useAppStore.setState({ mode: "source", suggestingMode: false });
  useToastStore.setState({ toasts: [] } as never);
});

describe("suggesting mode × WYSIWYG", () => {
  it("entering WYSIWYG while suggesting lands in Split and explains why", () => {
    useAppStore.setState({ suggestingMode: true });
    useAppStore.getState().setMode("wysiwyg");
    expect(useAppStore.getState().mode).toBe("split");
    expect(JSON.stringify(useToastStore.getState())).toMatch(/WYSIWYG/);
  });

  it("turning suggesting on from WYSIWYG switches to Split", () => {
    useAppStore.setState({ mode: "wysiwyg" });
    useAppStore.getState().toggleSuggestingMode();
    expect(useAppStore.getState().suggestingMode).toBe(true);
    expect(useAppStore.getState().mode).toBe("split");
  });

  it("WYSIWYG still works normally when suggesting is off", () => {
    useAppStore.getState().setMode("wysiwyg");
    expect(useAppStore.getState().mode).toBe("wysiwyg");
    useAppStore.getState().toggleSuggestingMode(); // on → split
    useAppStore.getState().toggleSuggestingMode(); // off
    expect(useAppStore.getState().suggestingMode).toBe(false);
  });
});
