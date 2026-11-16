/**
 * R8-L10: a desktop vault moved into a folder inside itself (or into the
 * folder that holds it) is refused before anything is written, also when the
 * two paths are spelled differently: a trailing separator, `.`/`..`, `\`, or
 * another letter case on the case-insensitive file systems of macOS and Windows.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryBackend, setVaultBackend } from "../storage/vault";
import { __resetVaultLocation, __setDesktopInvoke, __setLocationStore, getPendingMove, moveVault, type StoredLocation } from "../storage/vault/location";
import { desktopRootKey, desktopRootsNested } from "../storage/vault/moveCheck";

describe("desktop vault roots", () => {
  it("one spelling per folder: separators, dots, and case where the file system ignores it", () => {
    expect(desktopRootKey("/Users/x/Vault/", false)).toBe("/Users/x/Vault");
    expect(desktopRootKey("/Users//x/./A/../Vault", false)).toBe("/Users/x/Vault");
    expect(desktopRootKey("C:\\Users\\x\\Vault\\", true)).toBe("c:/users/x/vault");
    expect(desktopRootKey("/Users/x/Vault", true)).toBe(desktopRootKey("/users/X/vault/", true));
    expect(desktopRootKey("/home/x/Vault", false)).not.toBe(desktopRootKey("/home/x/vault", false)); // Linux: case matters
    expect(desktopRootKey("\\\\server\\share\\Vault", true)).toBe("//server/share/vault");
  });

  it("nested: the same folder, or one inside the other after a separator", () => {
    expect(desktopRootsNested("/Users/x/Vault", "/Users/x/Vault/sub", false)).toBe(true);
    expect(desktopRootsNested("/Users/x/Vault/sub/deeper", "/Users/x/Vault", false)).toBe(true);
    expect(desktopRootsNested("/Users/x/Vault", "/Users/x/Vault2", false)).toBe(false); // a prefix, not a parent
    expect(desktopRootsNested("/Users/x/Vault", "/Users/x/Other", false)).toBe(false);
    // macOS / Windows: another case is the same folder.
    expect(desktopRootsNested("/Users/x/Vault", "/users/x/vault/sub", true)).toBe(true);
    expect(desktopRootsNested("C:\\Notes\\Vault", "c:/notes/vault/Archive", true)).toBe(true);
    expect(desktopRootsNested("/Users/x/Vault", "/users/x/vault/sub", false)).toBe(false);
    expect(desktopRootsNested("/Users/x/Vault/../Vault/sub", "/Users/x/Vault", false)).toBe(true);
    expect(desktopRootsNested("/", "/anything", false)).toBe(true);
  });
});

describe("moving a desktop vault", () => {
  const store = new Map<string, unknown>();
  const calls: string[] = [];
  beforeEach(() => {
    store.clear();
    calls.length = 0;
    __setLocationStore({ get: async <T,>(k: string) => store.get(k) as T | undefined, set: async (k: string, v: unknown) => void store.set(k, v), del: async (k: string) => void store.delete(k) });
    __setDesktopInvoke((async (cmd: string) => {
      calls.push(cmd);
      return null;
    }) as never);
    const mem = createMemoryBackend();
    void mem.write("note.md", "text");
    setVaultBackend(mem);
  });
  afterEach(() => {
    __setDesktopInvoke(null);
    __resetVaultLocation();
  });

  const at = (root: string): StoredLocation => ({ kind: "desktop", root, name: root.split(/[\\/]/).filter(Boolean).pop() ?? root });

  it("refuses a folder inside the vault and the folder that holds it, before writing", async () => {
    await expect(moveVault(at("/Users/x/Vault/sub"), { from: at("/Users/x/Vault") })).rejects.toThrow(/inside itself/);
    await expect(moveVault(at("/Users/x"), { from: at("/Users/x/Vault/") })).rejects.toThrow(/contains it/);
    await expect(moveVault(at("/Users/x/Vault/./sub/.."), { from: at("/Users/x/Vault") })).rejects.toThrow(/already there|inside itself/);
    expect(calls.filter((c) => /write|mkdir|copy|use/.test(c))).toEqual([]);
    expect(getPendingMove()).toBeNull();
  });
});
