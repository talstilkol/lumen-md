/**
 * Plan W7.24 in a browser: the open-sources dialog works by keyboard alone
 * (type, ↑/↓, Enter inserts, Esc closes), every result shows a rights badge,
 * the switches are labelled checkboxes, and the gated fetch sends nothing
 * before yes and records one consented ledger entry after it.
 */
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { OpenSourcesDialog } from "../sources/open/OpenSourcesDialog";
import { searchLocal, type OpenResult } from "../sources/open/search";
import { gatedFetch, setSourceEnabled } from "../sources/open/gate";
import { ledgerEntries } from "../ai/privacyLedger";
import { setAiPolicy } from "../ai/policy";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tick = () => new Promise((r) => setTimeout(r, 0));
async function typeInto(el: HTMLInputElement, text: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { set.call(el, text); el.dispatchEvent(new Event("input", { bubbles: true })); await tick(); });
}
async function key(el: Element, k: string, extra: KeyboardEventInit = {}) {
  await act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...extra })); await tick(); });
}

describe("W7.24 dialog in a real browser: keyboard only, badges, ledger", () => {
  it("type, arrows, Enter inserts; Esc closes; every result has a badge", async () => {
    localStorage.clear();
    const host = document.createElement("div"); document.body.appendChild(host);
    const inserted: string[] = []; let closed = 0;
    const extra: OpenResult = { key: "k2", source: "knesset", kind: "law", title: "חוק הגנת הפרטיות", detail: "", rights: "section-6", url: "https://knesset.gov.il/x", local: true, payload: { lawId: 1, lawName: "חוק הגנת הפרטיות" } };
    const root = createRoot(host);
    await act(async () => {
      root.render(<OpenSourcesDialog loadLocal={async () => ({ laws: [], library: null })} searchLocal={(q, s, k) => [...searchLocal(q, s, k), ...(q ? [extra] : [])]} searchOnline={async () => []} insertion={async (r) => "INSERT:" + r.key} onInsert={(m) => inserted.push(m)} onClose={() => closed++} />);
      await tick();
    });
    const input = host.querySelector<HTMLInputElement>("[data-testid=open-sources-query]")!;
    expect(document.activeElement === input).toBe(true);
    await typeInto(input, "בראשית א:א");
    const items = host.querySelectorAll("[data-testid=open-sources-item]");
    expect(items.length).toBe(2);
    expect(host.querySelectorAll("[data-testid=open-sources-badge]").length).toBe(2);
    expect(input.getAttribute("aria-activedescendant")).toBe("os-opt-0");
    await key(input, "ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBe("os-opt-1");
    await key(input, "Enter");
    await act(async () => { await tick(); await tick(); });
    expect(inserted).toEqual(["INSERT:k2"]);
    expect(closed).toBe(1);
    await key(input, "Escape");
    expect(closed).toBe(2);
    // The switches are reachable and real checkboxes with labels.
    const sw = host.querySelector<HTMLInputElement>("[data-testid=open-sources-switch-knesset]")!;
    expect(sw.type).toBe("checkbox");
    expect(sw.closest("label")!.textContent!.length > 0).toBe(true);
    expect(host.querySelector("[role=dialog]")!.getAttribute("aria-modal")).toBe("true");
    act(() => root.unmount());
  });

  it("the gated fetch: nothing before yes; after yes, one consented ledger entry under local-only", async () => {
    setAiPolicy("local-only");
    const calls: string[] = [];
    (globalThis as { fetch: typeof fetch }).fetch = (async (u: RequestInfo | URL) => { calls.push(String(u)); return new Response('{"value":[]}', { status: 200, headers: { "content-type": "application/json" } }); }) as typeof fetch;
    setSourceEnabled("knesset", true);
    const no = gatedFetch({ source: "knesset", reason: "Knesset records (OData): the law or bill name only", confirm: async () => false, enabled: () => true });
    let declined = false;
    try { await no("https://knesset.gov.il/OdataV4/ParliamentInfo/KNS_IsraelLaw?$top=1"); } catch { declined = true; }
    expect(declined).toBe(true);
    expect(calls.length).toBe(0);
    const yes = gatedFetch({ source: "knesset", reason: "Knesset records (OData): the law or bill name only", confirm: async () => true, enabled: () => true });
    await yes("https://knesset.gov.il/OdataV4/ParliamentInfo/KNS_IsraelLaw?$top=1");
    expect(calls.length).toBe(1);
    const e = ledgerEntries().filter((x) => x.host === "knesset.gov.il");
    expect(e.map((x) => [x.decision, x.consent, x.category])).toEqual([["allowed", true, "cloud-text"]]);
  });
});

describe("W7.24 world-class pass: the trap, what Enter inserts, axe", () => {
  const results: OpenResult[] = [
    { key: "k1", source: "knesset", kind: "law", title: "חוק הגנת הפרטיות", detail: "", rights: "section-6", url: "https://example.org/k", local: true, payload: {} },
    { key: "s1", source: "sefaria", kind: "verse", title: "Rashi on Genesis 1:1", detail: "", rights: "link-only", url: "https://example.org/s", local: false, payload: {} },
  ] as OpenResult[];
  async function mountWith(): Promise<{ host: HTMLElement; unmount: () => void }> {
    localStorage.clear();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<OpenSourcesDialog loadLocal={async () => ({ laws: [], library: null })} searchLocal={(q) => (q ? results : [])} searchOnline={async () => []} insertion={async (r) => r.key} onInsert={() => {}} onClose={() => {}} />);
      await tick();
    });
    await typeInto(host.querySelector<HTMLInputElement>("[data-testid=open-sources-query]")!, "פרטיות");
    return { host, unmount: () => act(() => root.unmount()) };
  }

  it("Tab from the last control wraps to the first, Shift+Tab from the first to the last: focus never leaves the dialog", async () => {
    const { host, unmount } = await mountWith();
    const { focusableIn } = await import("../ui/useFocusTrap");
    const dialog = host.querySelector<HTMLElement>("[role=dialog]")!;
    const items = focusableIn(dialog);
    expect(items.length).toBeGreaterThan(4);
    const last = items[items.length - 1];
    last.focus();
    await key(last, "Tab");
    expect(document.activeElement).toBe(items[0]);
    await key(items[0], "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(last);
    unmount();
  });

  it("each result says what Enter will insert: the text with its credit, or only a link when the licence allows no copy", async () => {
    const { host, unmount } = await mountWith();
    const modes = [...host.querySelectorAll<HTMLElement>("[data-testid=open-sources-inserts]")].map((n) => [n.dataset.mode, n.textContent]);
    expect(modes).toEqual([
      ["copy", "Enter inserts the text itself, with its credit"],
      ["link", "Enter inserts a link only: the licence allows no copy"],
    ]);
    // Part of the option's text, so a screen reader reads it with the result.
    expect(host.querySelector("#os-opt-1")!.textContent).toContain("link only");
    unmount();
  });

  it("axe: no serious or critical violation with results on screen", async () => {
    const { host, unmount } = await mountWith();
    const axe = (await import("axe-core")).default;
    const r = await axe.run(host, { resultTypes: ["violations"], rules: { "color-contrast": { enabled: false } } });
    expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
    unmount();
  });
});
