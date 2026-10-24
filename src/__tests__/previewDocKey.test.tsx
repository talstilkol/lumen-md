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

// The full render's seam (plan 8.1): fullRender gives the finished HAST,
// pipeline.hastToReact turns each slice of it into elements. A "tree" here
// is one text node whose value is what the Probe shows.
type Hast = { type: "root"; children: Array<{ type: "text"; value: string }> };
const pending: Array<{ text: string; resolve: (el: React.ReactElement) => void }> = [];
vi.mock("../renderer/fullRender", () => ({
  renderMarkdownHast: (text: string) =>
    new Promise<Hast>((resolve) =>
      pending.push({ text, resolve: (el: React.ReactElement) => resolve({ type: "root", children: [{ type: "text", value: (el.props as { text: string }).text }] }) }),
    ),
}));
vi.mock("../renderer/pipeline", () => ({
  renderMarkdownFast: (text: string) => <Probe text={text} />,
  hastToReact: (root: Hast) => <Probe text={root.children.map((c) => c.value).join("")} />,
  extractFrontmatter: () => null,
}));
vi.mock("../lib/idle", () => ({ scheduleIdle: (cb: () => void) => (cb(), () => {}) }));

import { Preview } from "../renderer/Preview";

/** The next full render, once Preview has asked for it (the render driver is a lazy import: one extra async hop). */
async function next() {
  await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0));
  return pending.shift()!;
}

afterEach(() => {
  cleanup();
  pending.length = 0;
});

describe("PreviewDocKeyContext", () => {
  it("keeps the old document's key until the new document's tree is shown", async () => {
    const { rerender } = render(<Preview markdownText="doc A" docKey="a.md" />);
    const p0 = await next();
    await act(async () => p0.resolve(<Probe text="doc A full" />));
    expect(screen.getByTestId("probe").dataset.doc).toBe("a.md");

    // Switch to B: its render is still pending, so A's tree (and key) remain.
    rerender(<Preview markdownText="doc B" docKey="b.md" />);
    expect(screen.getByTestId("probe").textContent).toBe("doc A full");
    expect(screen.getByTestId("probe").dataset.doc).toBe("a.md");

    const p1 = await next();
    await act(async () => p1.resolve(<Probe text="doc B full" />));
    expect(screen.getByTestId("probe").textContent).toBe("doc B full");
    expect(screen.getByTestId("probe").dataset.doc).toBe("b.md");
  });
});

describe("docIdentity", () => {
  it("distinguishes same-named files opened from different folders by handle", async () => {
    const { docIdentity } = await import("../renderer/previewDoc");
    const a = {}, b = {};
    const ka = docIdentity({ name: "readme.md", handle: a });
    const kb = docIdentity({ name: "readme.md", handle: b });
    expect(ka).not.toBe(kb);
    expect(docIdentity({ name: "readme.md", handle: a })).toBe(ka); // stable per handle
  });
  it("prefers the workspace path, then falls back to the name", async () => {
    const { docIdentity } = await import("../renderer/previewDoc");
    expect(docIdentity({ name: "x.md", workspaceName: "notes/x.md", handle: {} })).toBe("ws:notes/x.md");
    expect(docIdentity({ name: "Untitled.md" })).toBe("name:Untitled.md");
    expect(docIdentity({ name: "" })).toBeNull();
  });
});

describe("docIdentity across loads of handle-less files", () => {
  it("gives two same-named loads different identities, edits keep it", async () => {
    const { docIdentity } = await import("../renderer/previewDoc");
    const { useAppStore } = await import("../store/useStore");
    const st = () => useAppStore.getState();
    // <input type="file"> fallback: no handle, no workspace path.
    st().setDoc({ name: "README.md", content: "first", handle: undefined, workspaceName: null, dirty: false });
    const first = docIdentity(st().doc);
    st().setContent("first, edited");
    expect(docIdentity(st().doc)).toBe(first);
    st().setDoc({ name: "README.md", content: "untrusted", handle: undefined, dirty: false });
    expect(docIdentity(st().doc)).not.toBe(first);
    const second = docIdentity(st().doc);
    st().openTab({ name: "README.md", content: "third" });
    expect(docIdentity(st().doc)).not.toBe(second);
    // Workspace files keep their path identity across reloads.
    st().setDoc({ name: "a.md", content: "x", workspaceName: "notes/a.md" });
    const ws = docIdentity(st().doc);
    st().setDoc({ name: "a.md", content: "y", workspaceName: "notes/a.md" });
    expect(docIdentity(st().doc)).toBe(ws);
  });
});
