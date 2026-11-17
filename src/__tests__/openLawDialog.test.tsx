/**
 * W11.H16 in the open-sources dialog: with "Open Book of Laws (offline)"
 * on, the user imports a file by keyboard (the button opens the file
 * chooser), sees the import's progress and result in the live status, focus
 * comes back to the button, and a typed section is found on the device with
 * a CC BY-SA badge. With the source off there is no import control.
 */
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { readFileSync } from "node:fs";
import { OpenSourcesDialog } from "../sources/open/OpenSourcesDialog";
import { searchLocal } from "../sources/open/search";
import { setSourceEnabled } from "../sources/open/gate";
import { importOpenLaw, type OpenLawStorage } from "../sources/openlaw/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIXTURE = readFileSync("src/__tests__/fixtures/openlaw/israeli_law.synthetic.jsonl", "utf8");
const tick = () => new Promise((r) => setTimeout(r, 0));
const memory = (): OpenLawStorage => {
  const files = new Map<string, string>();
  return {
    read: async (p) => files.get(p) ?? null,
    write: async (p, c) => void files.set(p, c),
  };
};
async function typeInto(el: HTMLInputElement, text: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    set.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
  });
}

function mount(importOpenLaw = (file: File, signal: AbortSignal, onProgress: (p: { done: number; total: number }) => void) => file.text().then((t) => importOpenLaw2(t, signal, onProgress))) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  return { host, root, importOpenLaw };
}
const store = memory();
const importOpenLaw2 = (text: string, signal: AbortSignal, onProgress: (p: { done: number; total: number }) => void) => importOpenLaw(text, store, { signal, onProgress });

describe("W11.H16: importing and searching the Open Book of Laws in the dialog", () => {
  it("off: no import control; on: import by keyboard, live status, focus back on the button, a cc-by-sa result", async () => {
    localStorage.clear();
    const { host, root, importOpenLaw } = mount();
    let picked = 0;
    await act(async () => {
      root.render(
        <OpenSourcesDialog
          loadLocal={async () => ({ laws: [], library: null, openLaw: null })}
          searchLocal={searchLocal}
          searchOnline={async () => []}
          insertion={async () => null}
          onInsert={() => {}}
          onClose={() => {}}
          importOpenLaw={importOpenLaw}
        />,
      );
      await tick();
    });
    expect(host.querySelector("[data-testid=open-law-import]")).toBeNull();
    const sw = host.querySelector<HTMLInputElement>("[data-testid=open-sources-switch-openlaw]")!;
    expect(sw.closest("label")!.textContent).toContain("Open Book of Laws");
    await act(async () => {
      sw.click();
      await tick();
    });
    const pick = host.querySelector<HTMLButtonElement>("[data-testid=open-law-pick]")!;
    expect(pick.textContent).toBe("Import a file…");
    const fileInput = host.querySelector<HTMLInputElement>("[data-testid=open-law-file]")!;
    fileInput.addEventListener("click", (e) => (e.preventDefault(), picked++));
    pick.focus();
    await act(async () => {
      pick.click();
      await tick();
    });
    expect(picked).toBe(1);
    // The browser's file chooser returns a file:
    const dt = new DataTransfer();
    dt.items.add(new File([FIXTURE], "israeli_law.jsonl", { type: "application/json" }));
    fileInput.files = dt.files;
    await act(async () => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      for (let i = 0; i < 10; i++) await tick();
    });
    const status = host.querySelector("[role=status]")!;
    expect(status.textContent).toMatch(/^\d+ laws imported/);
    const again = host.querySelector<HTMLButtonElement>("[data-testid=open-law-pick]")!;
    expect(again.textContent).toBe("Replace with another file…");
    expect(document.activeElement).toBe(again);
    expect(host.querySelector("[data-testid=open-law-import]")!.textContent).toMatch(/laws on this device, imported \d{4}-\d\d-\d\d/);
    const q = host.querySelector<HTMLInputElement>("[data-testid=open-sources-query]")!;
    await typeInto(q, "סעיף 12 לחוק החוזים (חלק כללי)");
    const item = [...host.querySelectorAll<HTMLElement>("[data-testid=open-sources-item]")].find((li) => li.textContent!.includes("החוזים"))!;
    expect(item.dataset.rights).toBe("cc-by-sa");
    expect(item.textContent).toContain("Open Book of Laws");
    act(() => root.unmount());
    host.remove();
    setSourceEnabled("openlaw", false);
  });

  it("a file that is not the dataset: the error is in the status, focus stays on the button", async () => {
    localStorage.clear();
    setSourceEnabled("openlaw", true);
    const { host, root, importOpenLaw } = mount();
    await act(async () => {
      root.render(
        <OpenSourcesDialog
          loadLocal={async () => ({ laws: [], library: null, openLaw: null })}
          searchLocal={searchLocal}
          searchOnline={async () => []}
          insertion={async () => null}
          onInsert={() => {}}
          onClose={() => {}}
          importOpenLaw={importOpenLaw}
        />,
      );
      await tick();
    });
    const fileInput = host.querySelector<HTMLInputElement>("[data-testid=open-law-file]")!;
    const dt = new DataTransfer();
    dt.items.add(new File(['{"heading":"x"}'], "other.json"));
    fileInput.files = dt.files;
    await act(async () => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      for (let i = 0; i < 10; i++) await tick();
    });
    expect(host.querySelector("[role=status]")!.textContent).toMatch(/^Import failed: /);
    expect(document.activeElement).toBe(host.querySelector("[data-testid=open-law-pick]"));
    act(() => root.unmount());
    host.remove();
    setSourceEnabled("openlaw", false);
  });
});
