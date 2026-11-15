import { describe, expect, it } from "vitest";
import { FakeDir } from "../helpers/fakeOpfs";
import { createDirectoryHandleBackend } from "../../storage/vault";

describe("Z6 CAS edges", () => {
  it("writeIf(null): fallback write fails -> no empty file left behind", async () => {
    const dir = new FakeDir();
    const plain = dir.getFileHandle.bind(dir);
    dir.getFileHandle = (async (name: string, opts?: { create?: boolean }) => {
      const h = await plain(name, opts);
      return Object.assign(Object.create(null), { kind: h.kind, name: h.name, getFile: () => h.getFile() });
    }) as typeof dir.getFileHandle;
    const v = createDirectoryHandleBackend({
      id: "webkit",
      root: async () => dir as unknown as FileSystemDirectoryHandle,
      writeFallback: async () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    });
    await expect(v.writeIf("new.md", "ours", null)).rejects.toThrow();
    expect(await v.stat("new.md")).toBe(null);
  });

  it("writeIf(null): createWritable rejects -> no empty file left behind", async () => {
    const dir = new FakeDir();
    const plain = dir.getFileHandle.bind(dir);
    dir.getFileHandle = (async (name: string, opts?: { create?: boolean }) => {
      const h = await plain(name, opts);
      (h as unknown as { createWritable: () => Promise<never> }).createWritable = async () => {
        throw new DOMException("quota", "QuotaExceededError");
      };
      return h;
    }) as typeof dir.getFileHandle;
    const v = createDirectoryHandleBackend({ id: "f", root: async () => dir as unknown as FileSystemDirectoryHandle });
    await expect(v.writeIf("new.md", "ours", null)).rejects.toThrow();
    expect(await v.stat("new.md")).toBe(null);
  });

  it("rename onto a path is serialised with writeIf on that path (no lost note)", async () => {
    const dir = new FakeDir();
    const v = createDirectoryHandleBackend({ id: "f", root: async () => dir as unknown as FileSystemDirectoryHandle });
    await v.write("a.md", "AAA");
    await v.write("b.md", "old");
    const { sha256Hex } = await import("../../storage/vault/cas");
    const h = await sha256Hex(new TextEncoder().encode("old"));
    // writeIf on b.md and rename a.md -> b.md (overwrite) start together.
    const [ok] = await Promise.all([v.writeIf("b.md", "from sync", h), v.rename("a.md", "b.md", { overwrite: true })]);
    const b = await v.readText("b.md");
    // Either the rename landed (b = AAA) or the CAS refused; never: a.md gone AND b = "from sync".
    const aGone = (await v.stat("a.md")) === null;
    expect(!(aGone && b === "from sync" && ok)).toBe(true);
  });
});
