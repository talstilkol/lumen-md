/**
 * R8-L10: a desktop vault moved into a folder inside itself (or into the
 * folder that holds it) is refused before anything is written, also when the
 * two paths are spelled differently: a trailing separator, `.`/`..`, `\`, or
 * another letter case on the case-insensitive file systems of macOS and Windows.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryBackend, setVaultBackend } from "../storage/vault";
import { __resetVaultLocation, __setDesktopInvoke, __setLocationStore, getPendingMove, moveVault, type StoredLocation } from "../storage/vault/location";
import { desktopRootKey, desktopRootsNested, desktopRootsNestedOnDisk, VaultNestingUnknownError } from "../storage/vault/moveCheck";

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

  it("one Unicode form (R8b-L1): macOS's NFD names and Hebrew points in another order are the same text", () => {
    const nfc = "/Users/x/Caf\u00e9";
    const nfd = "/Users/x/Cafe\u0301";
    expect(desktopRootKey(nfc, true)).toBe(desktopRootKey(nfd, true));
    expect(desktopRootsNested(nfc, `${nfd}/sub`, true)).toBe(true);
    expect(desktopRootsNested(nfd, `${nfc}/sub`, false)).toBe(true);
    // shin + shin dot + qamats, typed with the vowel first: the same word after canonical ordering.
    const a = "/Users/x/\u05e9\u05c1\u05b8\u05dc\u05d5\u05b9\u05dd";
    const b = "/Users/x/\u05e9\u05b8\u05c1\u05dc\u05d5\u05b9\u05dd";
    expect(a).not.toBe(b);
    expect(desktopRootsNested(a, `${b}/sub`, true)).toBe(true);
    expect(desktopRootKey(a, false)).toBe(desktopRootKey(b, false));
  });

  it("`..` never climbs above the root, a drive or a share (R8b-L1)", () => {
    expect(desktopRootKey("/../Users/x", false)).toBe("/Users/x");
    expect(desktopRootKey("/../../Users/x/../x/Vault", false)).toBe("/Users/x/Vault");
    expect(desktopRootsNested("/../Users/x", "/Users/x/Vault", false)).toBe(true);
    expect(desktopRootKey("C:\\..\\Notes", true)).toBe("c:/notes");
    expect(desktopRootKey("\\\\server\\share\\..\\..\\Vault", true)).toBe("//server/share/vault");
    expect(desktopRootKey("../a", false)).toBe("../a"); // relative: kept as written
  });

  it("asks the disk when the spellings differ, and keeps the spelling answer when the app cannot say (R8b-L1)", async () => {
    const asked: unknown[] = [];
    const disk = (answer: unknown) => (async (cmd: string, args?: Record<string, unknown>) => {
      asked.push([cmd, args]);
      if (answer instanceof Error) throw answer;
      return answer;
    }) as never;
    // /tmp and /private/tmp on macOS: only the disk knows.
    expect(await desktopRootsNestedOnDisk("/tmp/Vault", "/private/tmp/Vault/sub", disk(true))).toBe(true);
    expect(asked).toEqual([["vault_roots_nested", { a: "/tmp/Vault", b: "/private/tmp/Vault/sub" }]]);
    expect(await desktopRootsNestedOnDisk("/a/Vault", "/a/Other", disk(false))).toBe(false);
    // Not allowed by the isolation app yet, an older app, or a non-boolean answer: unknown, so the
    // move is refused (review 9, L7: the spelling alone can miss a nesting the disk would see).
    await expect(desktopRootsNestedOnDisk("/a/Vault", "/a/Other", disk(new Error("vault_roots_nested is not allowed from the webview")))).rejects.toThrow(VaultNestingUnknownError);
    await expect(desktopRootsNestedOnDisk("/a/Vault", "/a/Other", disk(new Error("not allowed")))).rejects.toThrow(/could not check on disk .*\(not allowed\), so the vault was not moved/);
    for (const odd of ["yes", null, undefined, 1]) await expect(desktopRootsNestedOnDisk("/a/Vault", "/a/Other", disk(odd))).rejects.toThrow(VaultNestingUnknownError);
    asked.length = 0;
    expect(await desktopRootsNestedOnDisk("/a/Vault", "/a/Vault/sub", disk(false))).toBe(true);
    expect(asked).toEqual([]); // the spelling already says nested: the disk is not asked
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

  it("refuses a move the disk says is nested though the spellings differ (R8b-L1)", async () => {
    __setDesktopInvoke((async (cmd: string) => {
      calls.push(cmd);
      return cmd === "vault_roots_nested" ? true : null;
    }) as never);
    await expect(moveVault(at("/private/tmp/Vault/sub"), { from: at("/tmp/Vault") })).rejects.toThrow(/inside itself|contains it/);
    expect(calls).toContain("vault_roots_nested");
    expect(calls.filter((c) => /write|mkdir|copy|use/.test(c))).toEqual([]);
  });

  it("refuses, before writing, a move the disk can't judge (review 9, L7: fail closed)", async () => {
    // the default invoke of this suite answers null for every command: no answer about nesting
    await expect(moveVault(at("/a/Other"), { from: at("/a/Vault") })).rejects.toThrow(VaultNestingUnknownError);
    expect(calls).toContain("vault_roots_nested");
    expect(calls.filter((c) => /write|mkdir|copy|use/.test(c))).toEqual([]);
    expect(getPendingMove()).toBeNull();
  });
});
