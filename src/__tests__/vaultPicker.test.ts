/**
 * W13.M6: the mobile vault screen. Cards from a cache (no vault opened),
 * a mark on a vault whose last opening never finished, Rename, Move to
 * Recently deleted and Restore (the notes untouched), Open in safe mode —
 * in Hebrew, right to left, by keyboard.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { afterStart, beginOpen, checkName, daysLeft, emptyRegistry, formatBytes, opened, purgeExpired, readRegistry, refreshStats, rename, restore, trash, VaultPickerError, writeRegistry, REGISTRY_KEY, type KV, type Registry, type VaultCard } from "../mobile/vaultRegistry";
import { whereOf } from "../mobile/vaultPickerActions";
import { VaultPicker } from "../mobile/VaultPicker";

const DAY = 86_400_000;
const memKV = (init?: Registry): KV & { data: Map<string, unknown> } => {
  const data = new Map<string, unknown>(init ? [[REGISTRY_KEY, structuredClone(init)]] : []);
  return { data, get: async (k) => structuredClone(data.get(k)), set: async (k, v) => void data.set(k, structuredClone(v)) };
};
const card = (id: string, over: Partial<VaultCard> = {}): Omit<VaultCard, "failedLastOpen" | "openedAt"> => ({ id, name: id, where: "On this iPhone", location: { kind: "mobile", store: "documents", name: id }, files: 12, bytes: 2048, sync: "off", plugins: 0, ...over });

describe("the registry", () => {
  it("a vault opening that never finished is marked at the next start, and cleared once it opens", () => {
    let r = opened(emptyRegistry(), card("work"), 1);
    r = beginOpen(r, "work"); // …the app died here
    r = afterStart(r);
    expect(r.vaults[0].failedLastOpen).toBe(true);
    expect(r.opening).toBeNull();
    r = opened(beginOpen(r, "work"), card("work"), 2);
    expect(r.vaults[0]).toMatchObject({ failedLastOpen: false, openedAt: 2 });
  });

  it("newest first; a rename survives re-opening; stats refresh without touching the opening time", () => {
    let r = opened(emptyRegistry(), card("a"), 1);
    r = opened(r, card("b"), 2);
    expect(r.vaults.map((c) => c.id)).toEqual(["b", "a"]);
    r = rename(r, "a", "  יומן   אישי ");
    r = opened(r, card("a", { name: "a" }), 3);
    expect(r.vaults[0]).toMatchObject({ id: "a", name: "יומן אישי" });
    r = refreshStats(r, "a", { files: 99 });
    expect(r.vaults[0]).toMatchObject({ files: 99, openedAt: 3 });
  });

  it("names: not empty, ≤ 80, no slashes, unique", () => {
    const r = opened(opened(emptyRegistry(), card("a"), 1), card("b"), 2);
    for (const [name, code] of [["   ", "name-empty"], ["x".repeat(81), "name-long"], ["a/b", "name-chars"], ["B", "name-taken"]] as const) {
      expect(() => checkName(r, "a", name)).toThrow(VaultPickerError);
      try {
        checkName(r, "a", name);
      } catch (e) {
        expect((e as VaultPickerError).code).toBe(code);
      }
    }
    expect(checkName(r, "a", "ספרים 📚")).toBe("ספרים 📚");
  });

  it("delete goes to Recently deleted with its data untouched; restore brings it back; the open vault cannot be deleted", () => {
    let r = opened(opened(emptyRegistry(), card("a"), 1), card("b"), 2);
    expect(() => trash(r, "b", "b", 10)).toThrow(/is-open/);
    r = trash(r, "a", "b", 10);
    expect(r.vaults.map((c) => c.id)).toEqual(["b"]);
    expect(r.trash[0]).toMatchObject({ id: "a", trashedAt: 10, location: { kind: "mobile", store: "documents", name: "a" } });
    r = restore(r, "a");
    expect(r.trash).toEqual([]);
    expect(r.vaults.map((c) => c.id)).toEqual(["b", "a"]);
    expect("trashedAt" in r.vaults[1]).toBe(false);
  });

  it("after 30 days a deleted entry is forgotten (never its files)", () => {
    let r = trash(opened(emptyRegistry(), card("a"), 1), "a", null, 0);
    expect(daysLeft(r.trash[0], 29 * DAY)).toBe(1);
    expect(purgeExpired(r, 29 * DAY).trash).toHaveLength(1);
    r = purgeExpired(r, 30 * DAY);
    expect(r.trash).toEqual([]);
  });

  it("a damaged or blocked cache is an empty list", async () => {
    expect(await readRegistry({ get: async () => ({ v: 2 }), set: async () => undefined })).toEqual(emptyRegistry());
    expect(await readRegistry({ get: () => Promise.reject(new Error("blocked")), set: async () => undefined })).toEqual(emptyRegistry());
    expect((await readRegistry({ get: async () => ({ v: 1, vaults: [{ id: "" }, { id: "x", name: "X" }], trash: null, opening: 5 }), set: async () => undefined })).vaults).toHaveLength(1);
  });

  it("where a vault is, and sizes", () => {
    const tr = (k: string, v?: Record<string, string | number>) => `${k}${v ? JSON.stringify(v) : ""}`;
    expect(whereOf({ kind: "opfs" }, tr, "iPhone")).toBe("vaults.where.browser");
    expect(whereOf({ kind: "mobile", store: "documents", name: "Lumen" }, tr, "iPhone")).toBe('vaults.where.files{"name":"Lumen"}');
    expect(whereOf({ kind: "mobile", store: "saf", name: "Notes" }, tr, "Android")).toBe('vaults.where.folder{"name":"Notes"}');
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(null)).toBe("");
  });
});

describe("the screen (Hebrew, right to left, keyboard)", () => {
  afterEach(() => {
    document.documentElement.lang = "en";
    document.documentElement.dir = "ltr";
  });

  const setup = async () => {
    document.documentElement.lang = "he";
    document.documentElement.dir = "rtl";
    let r = opened(emptyRegistry(), card("home", { name: "בית", files: 1234, sync: "on", plugins: 3 }), 2);
    r = opened(r, card("work", { name: "עבודה" }), 1);
    r = afterStart(beginOpen(r, "work")); // work never finished opening
    const store = memKV(r);
    const opens: Array<[string, boolean]> = [];
    let closed = 0;
    await act(async () => {
      render(createElement(VaultPicker, { onClose: () => void closed++, openId: "home", store, now: () => 100, open: async (c, o) => (opens.push([c.id, !!o?.safeMode]), true) }));
    });
    await act(async () => {});
    return { store, opens, closed: () => closed };
  };

  it("shows each vault's details without opening it, and marks the one that failed", async () => {
    await setup();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    const home = document.querySelector('[data-card="home"]')!;
    const work = document.querySelector('[data-card="work"]')!;
    expect(home.textContent).toMatch(/1,234|1234/);
    expect(screen.getAllByTestId("vault-failed")).toHaveLength(1);
    expect(work.querySelector('[data-testid="vault-failed"]')).not.toBeNull();
  });

  it("the menu opens by keyboard; safe mode opens the failed vault in safe mode", async () => {
    const { opens } = await setup();
    const menuButton = screen.getAllByRole("button", { name: /עבודה|work|vaults\.menu/ }).find((b) => b.getAttribute("aria-haspopup") === "menu")!;
    await act(async () => fireEvent.click(menuButton));
    expect(menuButton.getAttribute("aria-expanded")).toBe("true");
    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);
    await act(async () => fireEvent.keyDown(items[0], { key: "ArrowDown" }));
    expect(document.activeElement).toBe(items[1]);
    await act(async () => fireEvent.click(items[0]));
    expect(opens).toEqual([["work", true]]);
  });

  it("delete → Recently deleted (saved), then Restore; focus never drops to <body>", async () => {
    const { store } = await setup();
    const menuButton = document.querySelector<HTMLButtonElement>('[data-card="work"] .vault-menu-button')!;
    await act(async () => fireEvent.click(menuButton));
    await act(async () => fireEvent.click(screen.getByTestId("vault-trash")));
    await act(async () => {});
    expect(screen.getAllByRole("listitem").filter((li) => li.hasAttribute("data-card"))).toHaveLength(1);
    expect(((await store.get(REGISTRY_KEY)) as Registry).trash.map((c) => c.id)).toEqual(["work"]);
    expect(document.activeElement).not.toBe(document.body);
    await act(async () => fireEvent.click(screen.getByTestId("vault-restore")));
    await act(async () => {});
    expect(((await store.get(REGISTRY_KEY)) as Registry).vaults.map((c) => c.id).sort()).toEqual(["home", "work"]);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("the open vault cannot be deleted from here (the item is disabled)", async () => {
    await setup();
    const first = document.querySelector<HTMLButtonElement>('[data-card="home"] .vault-menu-button')!;
    await act(async () => fireEvent.click(first));
    expect((screen.getByTestId("vault-trash") as HTMLButtonElement).disabled).toBe(true);
  });

  it("rename in place, saved to the cache", async () => {
    const { store } = await setup();
    const menuButton = document.querySelector<HTMLButtonElement>('[data-card="home"] .vault-menu-button')!;
    await act(async () => fireEvent.click(menuButton));
    const renameItem = screen.getAllByRole("menuitem").find((b) => /vaults\.rename|שינוי שם|Rename/.test(b.textContent ?? ""))!;
    await act(async () => fireEvent.click(renameItem));
    const input = document.querySelector<HTMLInputElement>("input[id^=rename-]")!;
    await act(async () => fireEvent.change(input, { target: { value: "בית ראשי" } }));
    await act(async () => fireEvent.submit(input.form!));
    await act(async () => {});
    expect(((await store.get(REGISTRY_KEY)) as Registry).vaults.find((c) => c.id === "home")?.name).toBe("בית ראשי");
  });
});

describe("writes", () => {
  it("writeRegistry stores the whole registry", async () => {
    const s = memKV();
    await writeRegistry(s, opened(emptyRegistry(), card("a"), 1));
    expect(((await s.get(REGISTRY_KEY)) as Registry).vaults).toHaveLength(1);
  });
});
