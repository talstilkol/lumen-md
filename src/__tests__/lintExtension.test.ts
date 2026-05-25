import { describe, it, expect, vi } from "vitest";

vi.mock("@codemirror/view", () => ({
  Decoration: {
    mark: vi.fn().mockReturnValue({ range: vi.fn() }),
    set: vi.fn().mockReturnValue({}),
    none: {},
    widget: vi.fn().mockReturnValue({ range: vi.fn() }),
  },
  EditorView: {
    theme: vi.fn().mockReturnValue({}),
    baseTheme: vi.fn().mockReturnValue({}),
  },
  ViewPlugin: {
    fromClass: vi.fn().mockReturnValue({}),
  },
  WidgetType: class {},
}));
vi.mock("../lint/markdownLint", () => ({
  lintMarkdown: vi.fn().mockReturnValue([]),
}));

describe("markdownLintExtension", () => {
  it("can be imported without errors", async () => {
    const mod = await import("../editor/lintExtension");
    expect(typeof mod.markdownLintExtension).toBe("function");
  });

  it("returns an extension (non-null)", async () => {
    const { markdownLintExtension } = await import("../editor/lintExtension");
    const ext = markdownLintExtension();
    expect(ext).toBeDefined();
  });

  it("accepts optional onFindings callback", async () => {
    const { markdownLintExtension } = await import("../editor/lintExtension");
    const onFindings = vi.fn();
    const ext = markdownLintExtension({ onFindings });
    expect(ext).toBeDefined();
  });

  it("accepts getWorkspaceTitles option", async () => {
    const { markdownLintExtension } = await import("../editor/lintExtension");
    const ext = markdownLintExtension({
      getWorkspaceTitles: () => new Set(["Home", "About"]),
    });
    expect(ext).toBeDefined();
  });
});
