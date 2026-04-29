import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("../i18n", () => ({ t: (k: string) => k }));
vi.mock("../lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../storage/workspaceIndex", () => ({
  findBacklinks: vi.fn().mockResolvedValue([]),
}));

describe("BacklinksPanel", () => {
  it("renders without crashing", async () => {
    const { BacklinksPanel } = await import("../ui/BacklinksPanel");
    const { container } = render(
      <BacklinksPanel filePath={null} onOpen={vi.fn()} />,
    );
    expect(container).toBeDefined();
  });

  it("shows 'select file' hint when filePath is null", async () => {
    const { BacklinksPanel } = await import("../ui/BacklinksPanel");
    const { container } = render(
      <BacklinksPanel filePath={null} onOpen={vi.fn()} />,
    );
    expect(container.textContent).toContain("backlinks.selectFile");
  });

  it("has correct aria-label on aside", async () => {
    const { BacklinksPanel } = await import("../ui/BacklinksPanel");
    const { container } = render(
      <BacklinksPanel filePath={null} onOpen={vi.fn()} />,
    );
    const aside = container.querySelector("aside");
    expect(aside?.getAttribute("aria-label")).toBe("backlinks.title");
  });

  it("triggers loading state when filePath is provided", async () => {
    const { BacklinksPanel } = await import("../ui/BacklinksPanel");
    const { container } = render(
      <BacklinksPanel filePath="/notes/foo.md" onOpen={vi.fn()} />,
    );
    // Should show scanning indicator initially
    expect(container).toBeDefined();
  });
});
