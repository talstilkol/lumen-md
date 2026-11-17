/**
 * W13.K3 (F16): the per-vault consent for the system search, in Settings →
 * Privacy. The bridge is the stub ("needs desktop command (owner: isolation
 * allow-list)") in the app; a fake bridge stands in for the desktop shell.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import OsSearchIndexSwitch from "../ui/settings/OsSearchIndexSwitch";
import { NEEDS_COMMAND, stubBridge, vaultStore, type OsSearchBridgeStatus } from "../desktop/osSearchBridge";
import { domainOf, type OsSearchItem, type VaultRef } from "../desktop/osSearchIndex";

const A: VaultRef = { id: "vault-a", name: "A" };
const B: VaultRef = { id: "vault-b", name: "B" };
const NOTES: Record<string, string> = { "one.md": "# One\nhello #tag", "two.md": "two", ".hidden/x.md": "x", "secret.md": "---\nprivate: true\n---\nno" };
const notes = async () => ({ paths: async () => Object.keys(NOTES), read: async (p: string) => NOTES[p] ?? null });

function fakeBridge() {
  const index = new Map<string, OsSearchItem>();
  const cleared: string[] = [];
  const b: OsSearchBridgeStatus = {
    available: true,
    reason: null,
    index: async (items) => items.forEach((i) => index.set(i.id, i)),
    remove: async (ids) => ids.forEach((i) => index.delete(i)),
    clearDomain: async (d) => {
      cleared.push(d);
      for (const [k, v] of index) if (v.domain === d) index.delete(k);
    },
  };
  return { b, index, cleared };
}

beforeEach(() => localStorage.clear());

describe("system search consent (Settings → Privacy)", () => {
  it("the app's stub: off, cannot be turned on, and says it needs the desktop command", () => {
    render(<OsSearchIndexSwitch vault={A} notes={notes} />);
    const box = screen.getByRole("checkbox", { name: /Spotlight or Windows Search/ }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(true);
    expect(screen.getByTestId("os-search-availability").textContent).toBe(`Not available yet: ${NEEDS_COMMAND}`);
    expect(box.getAttribute("aria-describedby")).toContain(screen.getByTestId("os-search-availability").id);
    expect(stubBridge.available).toBe(false);
  });

  it("on: indexes this vault's notes (not hidden or private ones); off: clears the vault's whole domain and forgets it", async () => {
    const { b, index, cleared } = fakeBridge();
    render(<OsSearchIndexSwitch bridge={b} vault={A} notes={notes} />);
    const box = screen.getByRole("checkbox") as HTMLInputElement;
    expect(box.disabled).toBe(false);
    fireEvent.click(box);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Notes in the system search: 2."));
    expect([...index.values()].map((i) => i.title).sort()).toEqual(["One", "two"]);
    expect(vaultStore(A).enabled()).toBe(true);
    expect(vaultStore(B).enabled()).toBe(false); // per vault
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/removed from the system search/));
    expect(cleared).toEqual([domainOf(A)]);
    expect(index.size).toBe(0);
    expect(vaultStore(A).enabled()).toBe(false);
    expect(vaultStore(A).load()).toBeNull();
    expect(box.checked).toBe(false);
  });

  it("consent given earlier can still be withdrawn when the bridge is not available", async () => {
    vaultStore(A).setEnabled(true);
    vaultStore(A).save({ x: "y" });
    render(<OsSearchIndexSwitch vault={A} notes={notes} />);
    const box = screen.getByRole("checkbox") as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(false);
    fireEvent.click(box);
    await waitFor(() => expect(vaultStore(A).enabled()).toBe(false));
    expect(vaultStore(A).load()).toBeNull();
  });

  it("a failure is announced and consent is not left on", async () => {
    const { b } = fakeBridge();
    const bad = { ...b, index: async () => Promise.reject(new Error("index refused")) };
    render(<OsSearchIndexSwitch bridge={bad} vault={A} notes={notes} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/^Could not change the system search/);
    expect(vaultStore(A).enabled()).toBe(false);
  });
});
