/**
 * A7 levers 1 + 3 — first paint of the preview must not wait on heavy
 * blocks (Shiki, KaTeX, mermaid, charts…).
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mermaidImported = vi.fn();
vi.mock("../plugins/MermaidBlock", () => {
  mermaidImported();
  return { default: () => <div data-testid="mermaid-hydrated" /> };
});

import { renderMarkdown, renderMarkdownFast } from "../renderer/pipeline";
import { Preview } from "../renderer/Preview";

const DOC = [
  "# Hello first paint",
  "",
  "Some *body* text with $E = mc^2$ math.",
  "",
  "```ts",
  "const x = 1;",
  "```",
  "",
  "```mermaid",
  "graph LR; A --> B",
  "```",
].join("\n");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("renderMarkdownFast", () => {
  it("renders headings + text synchronously with slug ids", () => {
    const { container } = render(<div>{renderMarkdownFast(DOC)}</div>);
    const h1 = container.querySelector("h1");
    expect(h1?.textContent).toBe("Hello first paint");
    expect(h1?.id).toBe("hello-first-paint");
    // No Shiki / KaTeX in the fast pass: plain <pre>, math as source.
    expect(container.querySelector(".code-block")).toBeNull();
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.querySelector("pre code")?.textContent).toContain("const x = 1;");
  });
});

describe("renderMarkdown (full)", () => {
  it("still renders math via the lazily-imported KaTeX plugin", async () => {
    const tree = await renderMarkdown("Inline $a^2$ math", () => false);
    const { container } = render(<div>{tree}</div>);
    expect(container.querySelector(".katex")).not.toBeNull();
  });
});

describe("<Preview> first paint", () => {
  it("shows the document text on the very first commit, before any async work", () => {
    // Block idle + intersection so nothing deferred can run.
    vi.stubGlobal("requestIdleCallback", () => 1);
    vi.stubGlobal("cancelIdleCallback", () => {});
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    const { container } = render(<Preview markdownText={DOC} />);
    expect(container.querySelector("h1")?.textContent).toBe("Hello first paint");
    // Heavy block renders its placeholder and has NOT fetched its chunk.
    expect(container.querySelector('[data-lumen-block-pending="diagram"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="mermaid-hydrated"]')).toBeNull();
  });

  it("hydrates the heavy block once it is visible and the browser is idle", async () => {
    let ioCb: IntersectionObserverCallback | null = null;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: IntersectionObserverCallback) {
          ioCb = cb;
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    const { container, findByTestId } = render(<Preview markdownText={DOC} />);
    expect(container.querySelector('[data-testid="mermaid-hydrated"]')).toBeNull();
    await act(async () => {
      ioCb?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    expect(await findByTestId("mermaid-hydrated", {}, { timeout: 3000 })).toBeTruthy();
  });
});
