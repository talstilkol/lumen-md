/**
 * R12.19 / W10.C28 in the dialog: a register result shows its licence light
 * and terms, and the dialog stays a valid combobox + listbox — the options
 * hold no link (axe nested-interactive), the terms link of the selected
 * result sits outside the list, and the hint / "nothing found" line is not
 * an item of the listbox (axe aria-required-children). axe runs on it.
 */
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axe from "axe-core";
import { OpenSourcesDialog } from "../sources/open/OpenSourcesDialog";
import { REGISTER_TERMS } from "../sources/open/rights";
import type { OpenResult } from "../sources/open/search";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tick = () => new Promise((r) => setTimeout(r, 0));

const reg = (n: string, name: string): OpenResult =>
  ({ key: `amutot:${n}`, source: "registers", kind: "register", title: name, detail: n, rights: REGISTER_TERMS.amutot.rights, url: `https://example.org/${n}`, local: false, payload: { record: { number: n, name } }, terms: REGISTER_TERMS.amutot }) as unknown as OpenResult;

async function open(results: OpenResult[]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<OpenSourcesDialog loadLocal={async () => ({ laws: [], library: null })} searchLocal={() => results} searchOnline={async () => []} insertion={async (r) => r.title} onInsert={() => undefined} onClose={() => undefined} />);
    await tick();
  });
  return { host, root };
}

describe("open sources: register terms and the listbox (R12.19, W10.C28)", () => {
  it("empty: the hint is beside the listbox, not an item of it", async () => {
    const { host, root } = await open([]);
    const list = host.querySelector("#os-results")!;
    expect(list.querySelectorAll("li")).toHaveLength(0);
    expect(host.querySelector("[data-testid=open-sources-empty]")!.closest("[role=listbox]")).toBeNull();
    act(() => root.unmount());
    host.remove();
  });

  it("with register results: options hold no link; the selected one's terms link is outside the list; axe clean", async () => {
    const { host, root } = await open([reg("580123456", "עמותת ידידי הספרייה"), reg("580654321", "עמותת לב הספר")]);
    const input = host.querySelector<HTMLInputElement>("[data-testid=open-sources-query]")!;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      set.call(input, "עמותת");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await tick();
    });
    const options = host.querySelectorAll("[role=option]");
    expect(options).toHaveLength(2);
    for (const o of options) {
      expect(o.querySelector("a, button, input")).toBeNull();
      expect(o.querySelector("[data-testid=open-sources-terms]")!.textContent).toContain(REGISTER_TERMS.amutot.noteEn);
    }
    const link = host.querySelector<HTMLAnchorElement>("[data-testid=open-sources-terms-link] a")!;
    expect(link.closest("[role=listbox]")).toBeNull();
    expect(link.href).toBe(REGISTER_TERMS.amutot.termsUrl);
    expect((await axe.run(host, { resultTypes: ["violations"] })).violations.map((v) => v.id)).toEqual([]);
    act(() => root.unmount());
    host.remove();
  });
});
