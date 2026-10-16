/**
 * The preview renders asynchronously; while a tab switch is in flight the
 * old document's tree stays on screen. Blocks with per-document state read
 * the document identity from PreviewDocKeyContext, which must stay with the
 * tree that is displayed — not jump to the newly selected document early.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { useContext } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewDocKeyContext } from "../renderer/previewDoc";

function Probe({ text }: { text: string }) {
  const key = useContext(PreviewDocKeyContext);
  return <div data-testid="probe" data-doc={key ?? ""}>{text}</div>;
}

const pending: Array<{ text: string; resolve: (el: React.ReactElement) => void }> = [];
vi.mock("../renderer/pipeline", () => ({
  renderMarkdownFast: (text: string) => <Probe text={text} />,
  renderMarkdown: (text: string) =>
    new Promise<React.ReactElement>((resolve) => pending.push({ text, resolve })),
  extractFrontmatter: () => null,
}));
vi.mock("../lib/idle", () => ({ scheduleIdle: (cb: () => void) => (cb(), () => {}) }));

import { Preview } from "../renderer/Preview";

afterEach(() => {
  cleanup();
  pending.length = 0;
});

describe("PreviewDocKeyContext", () => {
  it("keeps the old document's key until the new document's tree is shown", async () => {
    const { rerender } = render(<Preview markdownText="doc A" docKey="a.md" />);
    await act(async () => pending.shift()!.resolve(<Probe text="doc A full" />));
    expect(screen.getByTestId("probe").dataset.doc).toBe("a.md");

    // Switch to B: its render is still pending, so A's tree (and key) remain.
    rerender(<Preview markdownText="doc B" docKey="b.md" />);
    expect(screen.getByTestId("probe").textContent).toBe("doc A full");
    expect(screen.getByTestId("probe").dataset.doc).toBe("a.md");

    await act(async () => pending.shift()!.resolve(<Probe text="doc B full" />));
    expect(screen.getByTestId("probe").textContent).toBe("doc B full");
    expect(screen.getByTestId("probe").dataset.doc).toBe("b.md");
  });
});
