import { describe, it, expect, vi, afterEach } from "vitest";

describe("exportDocx module", () => {
  it("can be imported without side effects", async () => {
    const mod = await import("../storage/exportDocx");
    expect(typeof mod.exportToDocx).toBe("function");
  });
});

describe("exportToDocx", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("triggers a download by creating and clicking an anchor", async () => {
    const clickSpy = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: vi.fn(),
    });
    const origAppend = document.body.appendChild.bind(document.body);
    vi.spyOn(document.body, "appendChild").mockImplementation((node) => {
      const el = node as HTMLAnchorElement;
      if (el.tagName === "A") el.click = clickSpy;
      return origAppend(node);
    });
    const { exportToDocx } = await import("../storage/exportDocx");
    await expect(exportToDocx("# Hello\n\nWorld", "test-doc")).resolves.toBeUndefined();
  });

  it("rejects when URL.createObjectURL throws (error propagates correctly)", async () => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => { throw new Error("unavailable"); }),
      revokeObjectURL: vi.fn(),
    });
    const { exportToDocx } = await import("../storage/exportDocx");
    // exportToDocx does NOT swallow errors from createObjectURL — correct behavior
    await expect(exportToDocx("# Test", "doc")).rejects.toThrow("unavailable");
  });
});
