/**
 * Plan W13.P4 — what is stored on this device: the inventory by category
 * with sizes, deletion per category and of everything (after which the
 * storage estimate is ~0), crypto-shredding (a deleted key leaves no way to
 * decrypt an old copy), the JSON report, and the dialog.
 */
import { describe, it, expect, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { createElement } from "react";
import { CATEGORIES, inventory, reportJson, wipe, type DirLike, type StorageDeps } from "../privacy/localData";

vi.mock("../ui/PromptDialog", () => ({ uiConfirm: vi.fn(async () => true) }));
import { LocalDataDialog } from "../privacy/LocalDataDialog";

type Node = { size?: number; children?: Record<string, Node> };
function dir(tree: Record<string, Node>): DirLike {
  return {
    async *entries() {
      for (const [name, n] of Object.entries(tree)) yield [name, n.children ? { kind: "directory" as const, ...dir(n.children) } : { kind: "file" as const, getFile: async () => ({ size: n.size ?? 0 }) }];
    },
    async removeEntry(name: string) {
      delete tree[name];
    },
  };
}

/** A fake browser storage whose estimate is the sum of what is left. */
function fakeStorage() {
  const opfs: Record<string, Node> = { "Welcome.md": { size: 2000 }, notes: { children: { "a.md": { size: 3000 } } }, models: { children: { "w.onnx": { size: 50_000_000 } } } };
  const caches = new Map<string, number>([["transformers-cache", 80_000_000], ["lumen-reading-fonts", 120_000], ["workbox-precache", 2_000_000]]);
  const dbs = new Map<string, number>([["lumen-history", 400_000], ["lumen-e2ee-keyring", 4000], ["lumen-vault-index", 90_000]]);
  const local = new Map<string, string>([["lumen-md", '{"state":{}}'], ["lumen.zotero.apiKey", "k-123"], ["lumen-reading", "{}"]]);
  const storage = { get length() { return local.size; }, key: (i: number) => [...local.keys()][i] ?? null, getItem: (k: string) => local.get(k) ?? null, removeItem: (k: string) => void local.delete(k), setItem: (k: string, v: string) => void local.set(k, v), clear: () => local.clear() } as unknown as Storage;
  const sum = (t: Record<string, Node>): number => Object.values(t).reduce((n, x) => n + (x.children ? sum(x.children) : x.size ?? 0), 0);
  const deps: StorageDeps = {
    estimate: async () => ({ usage: sum(opfs) + [...caches.values()].reduce((a, b) => a + b, 0) + [...dbs.values()].reduce((a, b) => a + b, 0), quota: 1e10, usageDetails: { indexedDB: [...dbs.values()].reduce((a, b) => a + b, 0) } }),
    caches: { keys: async () => [...caches.keys()], delete: async (n) => caches.delete(n), size: async (n) => caches.get(n) ?? 0 },
    idb: { databases: async () => [...dbs.keys()].map((name) => ({ name })), deleteDatabase: async (n) => void dbs.delete(n) },
    opfs: async () => dir(opfs),
    local: storage,
  };
  return { deps, dbs, caches, local };
}

describe("the inventory", () => {
  it("lists every category with what it holds and its size", async () => {
    const { deps } = fakeStorage();
    const r = await inventory(deps, new Date("2026-11-17T00:00:00Z"));
    expect(r.categories.map((c) => c.category)).toEqual([...CATEGORIES]);
    const by = Object.fromEntries(r.categories.map((c) => [c.category, c]));
    expect(by.notes.items).toEqual(expect.arrayContaining(["Welcome.md", "notes", "indexedDB:lumen-vault-index"]));
    expect(by.notes.bytes).toBe(5000);
    expect(by.models.items).toEqual(["models", "transformers-cache"]);
    expect(by.models.bytes).toBe(130_000_000);
    expect(by.caches.items).toEqual(["lumen-reading-fonts", "workbox-precache"]);
    expect(by.history.items).toEqual(["indexedDB:lumen-history"]);
    expect(by.keyring.items).toEqual(expect.arrayContaining(["indexedDB:lumen-e2ee-keyring", "localStorage:lumen.zotero.apiKey"]));
    expect(by.settings.items).toEqual(["localStorage:lumen-md", "localStorage:lumen-reading"]);
    expect(r.usage).toBeGreaterThan(130_000_000);
    expect(JSON.parse(reportJson(r))).toMatchObject({ format: "lumen-local-data/1", created: "2026-11-17T00:00:00.000Z" });
  });

  it("deletes one category and leaves the others", async () => {
    const { deps, caches, dbs } = fakeStorage();
    expect(await wipe("models", deps)).toEqual(["opfs:models", "cache:transformers-cache"]);
    expect([...caches.keys()]).toEqual(["lumen-reading-fonts", "workbox-precache"]);
    expect(dbs.has("lumen-history")).toBe(true);
  });

  it("after “delete everything” the storage estimate is ~0 (acceptance)", async () => {
    const { deps } = fakeStorage();
    expect((await deps.estimate()).usage).toBeGreaterThan(1e8);
    await wipe("all", deps);
    expect((await deps.estimate()).usage).toBe(0);
    expect((await inventory(deps)).categories.every((c) => c.items.length === 0)).toBe(true);
  });
});

describe("crypto-shredding (acceptance: a destroyed key leaves an old copy undecryptable)", () => {
  it("deleting the keyring removes the only key; the old ciphertext no longer decrypts", async () => {
    const { deps, local } = fakeStorage();
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
    local.set("lumen-vault-key", btoa(String.fromCharCode(...raw)));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const oldCopy = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode("secret note"));
    await wipe("keyring", deps);
    expect(local.has("lumen-vault-key")).toBe(false);
    expect(local.has("lumen-md")).toBe(true);
    // Whatever key is tried now, it isn't the one: AES-GCM refuses.
    const guess = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    await expect(crypto.subtle.decrypt({ name: "AES-GCM", iv }, guess, oldCopy)).rejects.toBeTruthy();
  });
});

describe("the dialog", () => {
  it("shows each category, deletes one after a confirmation, and saves the report", async () => {
    const { deps, caches } = fakeStorage();
    const save = vi.fn();
    render(createElement(LocalDataDialog, { deps, onClose: () => undefined, save }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
    for (const c of CATEGORIES) expect(screen.getByTestId(`local-data-${c}`)).toBeTruthy();
    const row = screen.getByTestId("local-data-caches");
    await act(async () => {
      fireEvent.click(row.querySelector("button")!);
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(caches.has("lumen-reading-fonts")).toBe(false);
    expect(screen.getByRole("status").textContent).not.toBe("");
    fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent?.includes("JSON"))!);
    expect(save.mock.calls[0][0]).toMatch(/^lumen-local-data-\d{4}-\d{2}-\d{2}\.json$/);
  });
});
