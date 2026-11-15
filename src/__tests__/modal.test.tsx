/**
 * The modal dialog primitive (plan 10.1, W10.E5–E8): a native <dialog>
 * opened with showModal(), Tab kept inside, Escape and other close
 * requests to `onClose`, focus back to the opener, `closedby`, the
 * embedded form, refs. Runs where showModal exists (Chromium, happy-dom)
 * and where it does not (jsdom: the `open` attribute and the trap).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createRef, useState } from "react";
import { Modal } from "../ui/Modal";

afterEach(() => cleanup());

const tick = () => act(() => new Promise((r) => setTimeout(r, 0)));
const tab = (shiftKey = false) => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab", shiftKey });
const activeText = () => (document.activeElement as HTMLElement | null)?.textContent ?? "";

function Host({ onClose, guarded = false, closedBy }: { onClose?: () => void; guarded?: boolean; closedBy?: "any" | "closerequest" | "none" }) {
  const [open, setOpen] = useState(false);
  const close = () => {
    onClose?.();
    setOpen(false);
  };
  return (
    <>
      <button onClick={() => setOpen(true)}>opener</button>
      <button>behind</button>
      {open && (
        <Modal aria-label="Settings" onClose={guarded ? undefined : close} closedBy={closedBy} data-testid="m">
          <button>one</button>
          <input aria-label="two" />
          <button>three</button>
        </Modal>
      )}
    </>
  );
}

const openHost = async (props: Parameters<typeof Host>[0] = {}) => {
  const r = render(<Host {...props} />);
  const opener = r.getByText("opener");
  opener.focus();
  fireEvent.click(opener);
  await tick();
  return r;
};

describe("Modal", () => {
  it("is a native <dialog>, open and labelled, with the modal semantics", async () => {
    // Does this engine know `:modal` (a real browser does, happy-dom does not)?
    let engineHasModal = false;
    if (typeof HTMLDialogElement !== "undefined" && typeof HTMLDialogElement.prototype.showModal === "function") {
      const probe = document.createElement("dialog");
      document.body.append(probe);
      probe.showModal();
      try {
        engineHasModal = probe.matches(":modal");
      } catch {
        // why: a selector engine without `:modal` throws: nothing to check there
      }
      probe.close();
      probe.remove();
    }
    const { getByRole } = await openHost();
    const d = getByRole("dialog", { name: "Settings" });
    expect(d.tagName).toBe("DIALOG");
    expect((d as HTMLDialogElement).open).toBe(true);
    expect(d.getAttribute("aria-modal")).toBe("true");
    expect(d.classList.contains("lumen-modal")).toBe(true);
    expect(d.getAttribute("closedby")).toBe("closerequest");
    // In the top layer, the rest of the page inert.
    if (engineHasModal) expect(d.matches(":modal")).toBe(true);
  });

  it("calls showModal() when the engine has it", async () => {
    if (typeof HTMLDialogElement === "undefined" || typeof HTMLDialogElement.prototype.showModal !== "function") return;
    const spy = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    await openHost();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("moves focus in, keeps Tab and Shift+Tab inside, and gives focus back to the opener on close", async () => {
    const onClose = vi.fn();
    const { getByRole, queryByRole, getByText } = await openHost({ onClose });
    const d = getByRole("dialog");
    expect(d.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 10; i++) {
      tab();
      expect(d.contains(document.activeElement), `Tab ${i + 1}`).toBe(true);
    }
    getByText("three").focus();
    tab();
    expect(activeText()).toBe("one");
    tab(true);
    expect(activeText()).toBe("three");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    await tick();
    await tick();
    expect(queryByRole("dialog")).toBeNull();
    expect(activeText()).toBe("opener");
  });

  it("a close request that is not a key (the back gesture: `cancel`) calls onClose once, and never closes behind React's back", async () => {
    const onClose = vi.fn();
    const { getByRole } = await openHost({ onClose });
    const d = getByRole("dialog") as HTMLDialogElement;
    const cancel = new Event("cancel", { cancelable: true });
    d.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("without onClose (a dialog that must not be dismissed): closedby=none, Escape and cancel do nothing", async () => {
    const { getByRole } = await openHost({ guarded: true });
    const d = getByRole("dialog") as HTMLDialogElement;
    expect(d.getAttribute("closedby")).toBe("none");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    const cancel = new Event("cancel", { cancelable: true });
    d.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    await tick();
    expect(getByRole("dialog")).toBe(d);
  });

  it("closedBy any: a click on the dialog itself (its backdrop area) closes; a click on its content does not", async () => {
    const onClose = vi.fn();
    const { getByRole, getByText } = await openHost({ onClose, closedBy: "any" });
    fireEvent.click(getByText("one"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("embedded: a labelled region, no dialog, no trap", async () => {
    const { getByRole, queryByRole } = render(
      <Modal embedded aria-labelledby="t" onClose={() => {}}>
        <h2 id="t">Theme</h2>
        <button>x</button>
      </Modal>,
    );
    await tick();
    expect(queryByRole("dialog")).toBeNull();
    expect(getByRole("region", { name: "Theme" }).tagName).toBe("DIV");
  });

  it("the component's own ref sees the dialog element", async () => {
    const ref = createRef<HTMLElement>();
    const { getByRole } = render(
      <Modal ref={ref} aria-label="Reader">
        <button>a</button>
      </Modal>,
    );
    await tick();
    expect(ref.current).toBe(getByRole("dialog"));
  });

  it("a dialog opened over another (a prompt over the settings screen): Escape closes only the top one", async () => {
    const outer = vi.fn();
    const inner = vi.fn();
    function Stack() {
      const [second, setSecond] = useState(false);
      return (
        <Modal aria-label="Outer" onClose={outer}>
          <button onClick={() => setSecond(true)}>more</button>
          {second && (
            <Modal aria-label="Inner" onClose={inner}>
              <button>i</button>
            </Modal>
          )}
        </Modal>
      );
    }
    const { getByText } = render(<Stack />);
    await tick();
    fireEvent.click(getByText("more"));
    await tick();
    expect(activeText()).toBe("i");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });
});
