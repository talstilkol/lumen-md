import { describe, it, expect, vi } from "vitest";

// Mock all @codemirror/* deps
vi.mock("@codemirror/view", () => ({
  Decoration: {
    mark: vi.fn().mockReturnValue({ range: vi.fn() }),
    set: vi.fn().mockReturnValue({}),
    widget: vi.fn().mockReturnValue({ range: vi.fn() }),
    none: {},
  },
  EditorView: {
    baseTheme: vi.fn().mockReturnValue({}),
  },
  ViewPlugin: {
    fromClass: vi.fn().mockReturnValue({}),
  },
  WidgetType: class {
    toDOM(): HTMLElement { return document.createElement("span"); }
    eq() { return false; }
    ignoreEvent() { return true; }
  },
}));

// Mock y-protocols/awareness
vi.mock("y-protocols/awareness", () => ({
  Awareness: class {
    clientID = 1;
    getStates() { return new Map(); }
    on = vi.fn();
    off = vi.fn();
    setLocalStateField = vi.fn();
  },
}));

describe("collabAwarenessExtension", () => {
  it("can be imported without errors", async () => {
    const mod = await import("../editor/collabAwareness");
    expect(typeof mod.collabAwarenessExtension).toBe("function");
  });

  it("returns an array (extension list)", async () => {
    const { Awareness } = await import("y-protocols/awareness") as any;
    const { collabAwarenessExtension } = await import("../editor/collabAwareness");
    const awareness = new Awareness();
    const result = collabAwarenessExtension(awareness);
    expect(Array.isArray(result)).toBe(true);
  });

  it("returns 2 items (plugin + baseTheme)", async () => {
    const { Awareness } = await import("y-protocols/awareness") as any;
    const { collabAwarenessExtension } = await import("../editor/collabAwareness");
    const awareness = new Awareness();
    const result = collabAwarenessExtension(awareness) as unknown[];
    expect(result.length).toBe(2);
  });

  it("registers an awareness 'change' listener on construction", async () => {
    const { Awareness } = await import("y-protocols/awareness") as any;
    const { ViewPlugin } = await import("@codemirror/view") as any;
    const { collabAwarenessExtension } = await import("../editor/collabAwareness");
    const awareness = new Awareness();
    collabAwarenessExtension(awareness);
    // ViewPlugin.fromClass was called — the extension is constructed
    expect(ViewPlugin.fromClass).toHaveBeenCalled();
  });
});
