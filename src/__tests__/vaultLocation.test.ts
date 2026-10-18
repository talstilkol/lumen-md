/**
 * Plan 4.2: the vault in a real folder. Moving copies, verifies byte for
 * byte, then switches; never deletes the source; stops before writing when
 * the target differs; resumes after an interruption. A folder whose
 * permission needs a click is "disconnected" until reconnected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDir, installFakeOpfs } from "./helpers/fakeOpfs";
import { getVaultBackend, createOpfsBackend } from "../storage/vault";
import {
  __resetVaultLocation,
  __setLocationStore,
  cancelPendingMove,
  getPendingMove,
  getVaultStatus,
  isFolderVaultSupported,
  moveVault,
  openFolderAsVault,
  reconnectVaultFolder,
  restoreVaultLocation,
  switchToBrowserStorage,
  VaultMoveConflictError,
  VaultPermissionError,
  type StoredLocation,
} from "../storage/vault/location";
import { readWorkspaceFile, writeWorkspaceBlob, writeWorkspaceFile, isOPFSAvailable } from "../storage/workspace";

const store = new Map<string, unknown>();
const kv = { get: async <T,>(k: string) => store.get(k) as T | undefined, set: async (k: string, v: unknown) => void store.set(k, v), del: async (k: string) => void store.delete(k) };

type Perm = "granted" | "prompt" | "denied";
/** A picked folder with the File System Access permission API. */
function folder(name = "My Vault", perm: { state: Perm; onRequest?: Perm } = { state: "granted" }) {
  const dir = new FakeDir(name) as FakeDir & {
    queryPermission: () => Promise<Perm>;
    requestPermission: () => Promise<Perm>;
  };
  dir.queryPermission = async () => perm.state;
  dir.requestPermission = async () => (perm.state = perm.onRequest ?? perm.state);
  return { dir, handle: dir as unknown as FileSystemDirectoryHandle, perm };
}
const loc = (f: ReturnType<typeof folder>): StoredLocation => ({ kind: "folder", handle: f.handle, name: f.dir.name });
const bytesAt = async (d: FakeDir, path: string) => {
  const parts = path.split("/");
  let cur = d;
  for (const p of parts.slice(0, -1)) cur = await cur.getDirectoryHandle(p);
  return [...new Uint8Array(await (await (await cur.getFileHandle(parts[parts.length - 1])).getFile()).arrayBuffer())];
};

beforeEach(() => {
  store.clear();
  __setLocationStore(kv);
  installFakeOpfs();
  __resetVaultLocation();
});
afterEach(() => __resetVaultLocation());

async function seed() {
  await writeWorkspaceFile("a.md", "# A\n");
  await writeWorkspaceFile("פרויקטים/סיכום.md", "שלום עולם");
  await writeWorkspaceBlob("img/lumen-asset-1.png", new Uint8Array([0, 255, 7]));
  await writeWorkspaceFile(".trash/index.json", "[]");
}

describe("moving the vault into a folder", () => {
  it("copies every file (trash included), byte for byte, then works in the folder; the source stays", async () => {
    await seed();
    const opfs = createOpfsBackend();
    const f = folder();
    const seen: number[] = [];
    const r = await moveVault(loc(f), { onProgress: (p) => seen.push(p.done) });
    expect(r).toEqual({ files: 4, bytes: 4 + 3 + new TextEncoder().encode("שלום עולם").byteLength + 2, unchanged: 0 });
    expect(seen.at(-1)).toBe(4);
    expect(getVaultStatus()).toEqual({ location: "folder", name: "My Vault" });
    expect(await bytesAt(f.dir, "img/lumen-asset-1.png")).toEqual([0, 255, 7]);
    expect(await bytesAt(f.dir, "פרויקטים/סיכום.md")).toEqual([...new TextEncoder().encode("שלום עולם")]);
    expect(await bytesAt(f.dir, ".trash/index.json")).toEqual([...new TextEncoder().encode("[]")]);
    // New saves go to the folder; OPFS keeps what it had.
    await writeWorkspaceFile("a.md", "# A, edited\n");
    expect(await bytesAt(f.dir, "a.md")).toEqual([...new TextEncoder().encode("# A, edited\n")]);
    expect(await opfs.readText("a.md")).toBe("# A\n");
    expect(store.get("lumen-vault-location")).toMatchObject({ kind: "folder", name: "My Vault" });
    expect(store.has("lumen-vault-move")).toBe(false);
  });

  it("stops before writing anything when the folder has different files at the same paths", async () => {
    await seed();
    const f = folder();
    await (await f.dir.getFileHandle("a.md", { create: true })).createWritable().then(async (w) => {
      await w.write("someone else's a.md");
      await w.close();
    });
    const err = await moveVault(loc(f)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VaultMoveConflictError);
    expect((err as VaultMoveConflictError).paths).toEqual(["a.md"]);
    expect([...f.dir.dirs.keys()]).toEqual([]);
    expect(getVaultStatus()).toEqual({ location: "opfs" });
    expect(await readWorkspaceFile("a.md")).toBe("# A\n");
  });

  it("merges into a folder that already has the same files, without rewriting them", async () => {
    await writeWorkspaceFile("a.md", "same");
    const f = folder();
    await (await f.dir.getFileHandle("a.md", { create: true })).createWritable().then(async (w) => {
      await w.write("same");
      await w.close();
    });
    expect(await moveVault(loc(f))).toMatchObject({ files: 1, unchanged: 1 });
  });

  it("an interrupted move is recorded, nothing switches, and a resume finishes it", async () => {
    await seed();
    const f = folder();
    const plain = f.dir.getDirectoryHandle.bind(f.dir);
    let fail = true;
    // The copy into פרויקטים/ fails the first time, as a full disk would.
    f.dir.getDirectoryHandle = (async (n: string, o?: { create?: boolean }) => {
      if (fail && n === "פרויקטים" && o?.create) throw new DOMException("quota", "QuotaExceededError");
      return plain(n, o);
    }) as typeof f.dir.getDirectoryHandle;
    await expect(moveVault(loc(f))).rejects.toThrow(/quota/);
    expect(getVaultStatus()).toEqual({ location: "opfs" });
    expect(getPendingMove()?.written.length).toBeGreaterThan(0);
    // A file the move already wrote and that changed in the source since is
    // the move's own: the resume overwrites it instead of calling it a conflict.
    await writeWorkspaceFile(".trash/index.json", "[1]");
    fail = false;
    const r = await moveVault(loc(f));
    expect(r.files).toBe(4);
    expect(r.unchanged).toBeGreaterThan(0);
    expect(await bytesAt(f.dir, ".trash/index.json")).toEqual([...new TextEncoder().encode("[1]")]);
    expect(getPendingMove()).toBeNull();
    expect(getVaultStatus()).toEqual({ location: "folder", name: "My Vault" });
  });

  it("refuses a folder without permission, before reading anything", async () => {
    await seed();
    const f = folder("Locked", { state: "prompt", onRequest: "denied" });
    await expect(moveVault(loc(f))).rejects.toBeInstanceOf(VaultPermissionError);
    expect(getPendingMove()).toBeNull();
  });

  it("moves back to browser storage the same way, leaving the folder as it was", async () => {
    const f = folder();
    await openFolderAsVault(f.handle);
    await writeWorkspaceFile("only-in-folder.md", "F");
    await moveVault({ kind: "opfs" });
    expect(getVaultStatus()).toEqual({ location: "opfs" });
    expect(await createOpfsBackend().readText("only-in-folder.md")).toBe("F");
    expect(await bytesAt(f.dir, "only-in-folder.md")).toEqual([70]);
  });

  it("cancelling an interrupted move drops the record only", async () => {
    store.set("lumen-vault-move", { from: { kind: "opfs" }, to: { kind: "opfs" }, startedAt: 1, written: ["a.md"], total: 1 });
    await restoreVaultLocation();
    expect(getPendingMove()).not.toBeNull();
    await cancelPendingMove();
    expect(getPendingMove()).toBeNull();
    expect(store.has("lumen-vault-move")).toBe(false);
  });
});

describe("start-up and permission", () => {
  it("reopens a stored folder when the permission is still granted", async () => {
    const f = folder();
    await (await f.dir.getFileHandle("n.md", { create: true })).createWritable().then(async (w) => {
      await w.write("in the folder");
      await w.close();
    });
    store.set("lumen-vault-location", loc(f));
    expect(await restoreVaultLocation()).toEqual({ location: "folder", name: "My Vault" });
    expect(await readWorkspaceFile("n.md")).toBe("in the folder");
  });

  it("a folder that needs a click is disconnected — no reads, no writes anywhere — until reconnected", async () => {
    const f = folder("My Vault", { state: "prompt", onRequest: "granted" });
    store.set("lumen-vault-location", loc(f));
    expect(await restoreVaultLocation()).toEqual({ location: "folder-disconnected", name: "My Vault" });
    expect(isOPFSAvailable()).toBe(false);
    await expect(writeWorkspaceFile("x.md", "x")).rejects.toThrow(/not connected/);
    expect(await createOpfsBackend().stat("x.md")).toBeNull();
    const changed = vi.fn();
    window.addEventListener("lumen-workspace-changed", changed);
    expect(await reconnectVaultFolder()).toBe(true);
    window.removeEventListener("lumen-workspace-changed", changed);
    expect(changed).toHaveBeenCalled();
    expect(getVaultStatus()).toEqual({ location: "folder", name: "My Vault" });
    await writeWorkspaceFile("x.md", "x");
    expect(await bytesAt(f.dir, "x.md")).toEqual([120]);
  });

  it("a refused reconnect stays disconnected; 'use browser storage' switches to OPFS", async () => {
    const f = folder("My Vault", { state: "prompt", onRequest: "denied" });
    store.set("lumen-vault-location", loc(f));
    await restoreVaultLocation();
    expect(await reconnectVaultFolder()).toBe(false);
    expect(getVaultStatus().location).toBe("folder-disconnected");
    await switchToBrowserStorage();
    expect(getVaultStatus()).toEqual({ location: "opfs" });
    expect(getVaultBackend().id).toBe("opfs");
    expect(store.get("lumen-vault-location")).toEqual({ kind: "opfs" });
  });

  it("knows whether the browser can open folders", () => {
    const w = window as unknown as { showDirectoryPicker?: unknown };
    expect(isFolderVaultSupported()).toBe(false);
    w.showDirectoryPicker = async () => null;
    expect(isFolderVaultSupported()).toBe(true);
    delete w.showDirectoryPicker;
  });
});
