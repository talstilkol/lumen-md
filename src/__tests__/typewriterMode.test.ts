import { describe, it, expect, vi } from "vitest";

// typewriterModeExtension depends on @codemirror/view — mock at the module level
vi.mock("@codemirror/view", () => ({
  EditorView: {
    theme: vi.fn().mockReturnValue({ extension: "theme" }),
  },
  ViewPlugin: {
    fromClass: vi.fn().mockReturnValue({ extension: "plugin" }),
  },
}));

describe("typewriterModeExtension", () => {
  it("can be imported without errors", async () => {
    const mod = await import("../editor/typewriterMode");
    expect(typeof mod.typewriterModeExtension).toBe("function");
  });

  it("returns an array (list of extensions)", async () => {
    const { typewriterModeExtension } = await import("../editor/typewriterMode");
    const result = typewriterModeExtension();
    expect(Array.isArray(result)).toBe(true);
  });

  it("returns 2 extensions (plugin + theme)", async () => {
    const { typewriterModeExtension } = await import("../editor/typewriterMode");
    const result = typewriterModeExtension() as unknown[];
    expect(result.length).toBe(2);
  });
});
