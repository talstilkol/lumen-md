import { describe, it, expect, vi } from "vitest";

vi.mock("@codemirror/view", () => ({
  Decoration: {
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
    toDOM(): HTMLElement { return document.createElement("button"); }
    ignoreEvent() { return false; }
    eq() { return false; }
  },
}));
vi.mock("../data/embedDetect", () => ({
  detectEmbed: vi.fn().mockReturnValue(null),
}));

describe("embedHintExtension", () => {
  it("can be imported without errors", async () => {
    const mod = await import("../editor/embedHintExtension");
    expect(typeof mod.embedHintExtension).toBe("function");
  });

  it("returns an array of extensions", async () => {
    const { embedHintExtension } = await import("../editor/embedHintExtension");
    const result = embedHintExtension();
    expect(Array.isArray(result)).toBe(true);
  });

  it("returns 2 items (plugin + theme)", async () => {
    const { embedHintExtension } = await import("../editor/embedHintExtension");
    const result = embedHintExtension() as unknown[];
    expect(result.length).toBe(2);
  });
});
