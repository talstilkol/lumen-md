/**
 * MobileKeyboardBar — accessory row that appears above the on-screen
 * keyboard on touch devices.
 *
 * Previously this test only asserted `container is defined` — theatre
 * that would pass even if the bar never rendered. The real component
 * gates rendering on (a) `matchMedia('(pointer: coarse)')`, (b) editor
 * focused, (c) `visualViewport.height < window.innerHeight - 100`.
 *
 * We test two coordinates of the contract:
 *   1. On a non-touch device (default in jsdom) the bar is hidden.
 *   2. When all three gating conditions are met, the bar renders a
 *      toolbar with the expected aria-label and a button for the
 *      Heading shortcut (which dispatches `lumen-mobile-insert` on
 *      mousedown).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";

vi.mock("../lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

beforeEach(() => {
  // Default to non-touch.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (q: string) => ({
      matches: false,
      media: q,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

describe("MobileKeyboardBar", () => {
  it("renders nothing on a non-touch device", async () => {
    const { MobileKeyboardBar } = await import("../ui/MobileKeyboardBar");
    const { container } = render(<MobileKeyboardBar />);
    // No toolbar should appear.
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
  });

  it("renders a Markdown-shortcuts toolbar when touch + keyboard-up conditions are met, and dispatches lumen-mobile-insert on click", async () => {
    // Touch device + visualViewport shrunk to simulate keyboard up.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (q: string) => ({
        matches: q === "(pointer: coarse)",
        media: q,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    const listeners = new Set<EventListener>();
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: {
        height: 500, // 300px shrink → keyboard up
        addEventListener: (_t: string, l: EventListener) => listeners.add(l),
        removeEventListener: (_t: string, l: EventListener) => listeners.delete(l),
      } as unknown as VisualViewport,
    });
    // Editor focused — the bar checks `document.activeElement.classList.contains("cm-content")`.
    const editor = document.createElement("div");
    editor.className = "cm-content";
    editor.tabIndex = 0;
    document.body.appendChild(editor);
    editor.focus();

    const { MobileKeyboardBar } = await import("../ui/MobileKeyboardBar");
    const { container } = render(<MobileKeyboardBar />);

    // Fire the visualViewport.resize that the component listens for, so
    // useState flips `visible` to true.
    await act(async () => {
      listeners.forEach((l) => l(new Event("resize")));
    });

    const toolbar = container.querySelector('[role="toolbar"][aria-label="Markdown shortcuts"]');
    expect(toolbar).not.toBeNull();
    const headingBtn = toolbar!.querySelector('button[aria-label="Insert heading"]') as HTMLButtonElement | null;
    expect(headingBtn).not.toBeNull();
    let captured: CustomEvent | null = null;
    const handler = (e: Event) => {
      captured = e as CustomEvent;
    };
    window.addEventListener("lumen-mobile-insert", handler);
    // The bar uses onMouseDown (preserves keyboard focus), not click.
    fireEvent.mouseDown(headingBtn!);
    window.removeEventListener("lumen-mobile-insert", handler);
    expect(captured).not.toBeNull();
    expect((captured as unknown as CustomEvent).detail?.insert).toBe("# ");

    document.body.removeChild(editor);
  });
});
