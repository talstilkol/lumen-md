/**
 * T6-L8 (the T6 review's test, $S/rev-t6/tests/modalNestedEscape.test.tsx, kept as a
 * permanent test): only the top dialog handles Escape, and "top" follows the DOM,
 * not React's effect order. On verify/train-6 (f4ed3b4a8f) both cases failed in
 * Chromium: 0 pass, 2 fail.
 */
// #730: only the top dialog may handle Escape. A dialog with its own document/window Escape
// listener (TrustedReposDialog, BatchPanel, SyncPanel, SetupWizard, ...) closed too when Escape
// cancelled a uiConfirm on top of it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TrustedReposDialog } from "../ui/TrustedReposDialog";
import { isTopDialog } from "../ui/useFocusTrap";

afterEach(() => cleanup());
import { useEffect } from "react";
import { Modal } from "../ui/Modal";

function Outer({ onClose, children }: { onClose: () => void; children?: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  return <Modal aria-label="outer"><button>outer</button>{children}</Modal>;
}

describe("nested Escape", () => {
  it("opened later: Escape on the top dialog closes only the top dialog", async () => {
    const outer = vi.fn(), inner = vi.fn();
    const r = render(<Outer onClose={outer} />);
    await act(async () => { await new Promise((res) => setTimeout(res, 20)); });
    r.rerender(<Outer onClose={outer}><Modal aria-label="inner" onClose={inner}><button autoFocus>ok</button></Modal></Outer>);
    await act(async () => { await new Promise((res) => setTimeout(res, 20)); });
    const target = document.activeElement ?? document.body;
    await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer, "the dialog under the prompt closed too").toHaveBeenCalledTimes(0);
  });
});

describe("mounted together", () => {
  it("a dialog mounted with its parent dialog in one render is the top one", async () => {
    const outer = vi.fn(), inner = vi.fn();
    render(<Modal aria-label="outer" onClose={outer}><Modal aria-label="inner" onClose={inner}><button autoFocus>ok</button></Modal></Modal>);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    await act(async () => { (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect([inner.mock.calls.length, outer.mock.calls.length]).toEqual([1, 0]);
  });
});

describe("the top dialog in the stack", () => {
  it("follows the DOM: the inner dialog of a pair mounted together is on top, in the top layer too", async () => {
    render(<Modal aria-label="outer" onClose={() => undefined}><button>o</button><Modal aria-label="inner" onClose={() => undefined}><button autoFocus>i</button></Modal></Modal>);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const [outer, inner] = Array.from(document.querySelectorAll("dialog"));
    expect(isTopDialog(inner.querySelector("button"))).toBe(true);
    expect(isTopDialog(outer.querySelector("button"))).toBe(false);
    // Focus went into the inner dialog, not the outer one's first button.
    expect(inner.contains(document.activeElement)).toBe(true);
    // Where the engine has a top layer, the inner dialog was opened after the outer one.
    if (typeof inner.showModal === "function" && inner.matches(":modal")) {
      const hit = document.elementFromPoint(inner.getBoundingClientRect().left + 2, inner.getBoundingClientRect().top + 2);
      expect(inner.contains(hit)).toBe(true);
    }
  });

  it("a real dialog with Escape through <Modal onClose> (TrustedReposDialog) closes on Escape when it is on top, and not when a prompt is", async () => {
    const onClose = vi.fn();
    render(<TrustedReposDialog onClose={onClose} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const prompt = vi.fn();
    const p = render(<Modal aria-label="prompt" onClose={prompt}><button autoFocus>ok</button></Modal>, { container: document.body.appendChild(document.createElement("div")) });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(0);
    p.unmount();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByRole("dialog").length).toBeGreaterThan(0);
  });
});
