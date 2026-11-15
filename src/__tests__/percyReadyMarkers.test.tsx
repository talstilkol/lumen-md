/**
 * W10.E55 (plan W7.25): the views Percy snapshots say when they have rendered
 * their content, through `data-ready` on the root that visual/percy-surfaces.ts
 * waits for. The marker is false while the view is still loading and true once
 * the listing it shows has landed.
 */
import { describe, it, expect, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";

vi.mock("../i18n", () => ({ registerEnglish: () => undefined, t: (k: string) => k }));

let resolveBacklinks: (v: unknown[]) => void = () => undefined;
vi.mock("../storage/workspaceIndex", () => ({
  findBacklinks: vi.fn(() => new Promise((r) => (resolveBacklinks = r))),
}));
let resolveTags: (v: unknown) => void = () => undefined;
vi.mock("../views/tagsIndex", () => ({
  buildTagsIndex: vi.fn(() => new Promise((r) => (resolveTags = r))),
}));

describe("ready markers of the Percy views (W10.E55)", () => {
  it("backlinks: not ready while the vault is scanned, ready once the hits land", async () => {
    const { BacklinksPanel } = await import("../ui/BacklinksPanel");
    const { container } = render(<BacklinksPanel filePath="notes/a.md" onOpen={() => undefined} />);
    const root = () => container.querySelector('[data-testid="backlinks-panel"]');
    expect(root()?.getAttribute("data-ready")).toBe("false");
    await act(async () => resolveBacklinks([]));
    await waitFor(() => expect(root()?.getAttribute("data-ready")).toBe("true"));
  });

  it("tags: not ready until the tag index is built", async () => {
    const { TagsPanel } = await import("../ui/TagsPanel");
    const { container } = render(<TagsPanel open onClose={() => undefined} />);
    const root = () => container.querySelector('[data-testid="tags-panel"]');
    expect(root()?.getAttribute("data-ready")).toBe("false");
    await act(async () => resolveTags({ buckets: [], totalNotes: 0, untaggedPaths: [] }));
    await waitFor(() => expect(root()?.getAttribute("data-ready")).toBe("true"));
  });

  it("outline: ready for the text on screen; a new text is not ready until its headings are parsed", async () => {
    const { Outline } = await import("../ui/Outline");
    const { container, rerender } = render(<Outline markdownText={"# One\n"} />);
    const root = () => container.querySelector('[data-testid="outline"]');
    expect(root()?.getAttribute("data-ready")).toBe("true");
    rerender(<Outline markdownText={"# One\n\n## Two\n"} />);
    expect(root()?.getAttribute("data-ready")).toBe("false");
    await waitFor(() => expect(root()?.getAttribute("data-ready")).toBe("true"), { timeout: 3000 });
    expect(root()?.textContent).toContain("Two");
  });
});
