import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock renderMarkdown
vi.mock("../renderer/pipeline", () => ({
  renderMarkdown: vi.fn().mockResolvedValue(null),
}));

describe("printDocument", () => {
  beforeEach(() => {
    const printDoc = document.implementation.createHTMLDocument("print");
    printDoc.open();
    const printWindow = {
      document: printDoc,
      focus: vi.fn(),
      print: vi.fn(),
    } as unknown as Window;

    // Mock window.open to avoid actually opening windows
    vi.stubGlobal("open", vi.fn().mockReturnValue(printWindow));
  });

  it("can be imported without errors", async () => {
    const mod = await import("../ui/PrintExport");
    expect(typeof mod.printDocument).toBe("function");
  });

  it("is an async function", async () => {
    const { printDocument } = await import("../ui/PrintExport");
    expect(printDocument.constructor.name).toBe("AsyncFunction");
  });

  it("calls window.open when invoked", async () => {
    const { printDocument } = await import("../ui/PrintExport");
    await printDocument("# Hello", "test-doc");
    expect(window.open).toHaveBeenCalled();
  });

  it("passes '_blank' target to window.open", async () => {
    const { printDocument } = await import("../ui/PrintExport");
    await printDocument("# Hello", "my-note");
    expect(window.open).toHaveBeenCalledWith("", "_blank");
  });
});
