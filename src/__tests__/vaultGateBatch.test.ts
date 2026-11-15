/**
 * W10.E51 (plan W7.4): the encryption gate every vault goes through passes the
 * store's batch read and write on. Before this, it had no readMany/writeMany,
 * so a bulk edit's "one batch" was a read, a stat and a write per note on
 * every real vault. It still refuses to batch over an encrypted vault, and it
 * never hands ciphertext over as a note.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, getVaultBackend, setVaultBackend } from "../storage/vault";
import { ENCRYPTED_PREFIX, HEADER_PATH } from "../storage/vault/encrypted/paths";
import { readWorkspaceTexts, writeWorkspaceFile, writeWorkspaceFilesIf } from "../storage/workspace";
import type { VaultBackend } from "../storage/vault/types";

/** A memory store with batch methods that count their calls (the real handle backend has them; the memory one does not). */
function batchingStore() {
  const inner = createMemoryBackend() as VaultBackend;
  const calls = { readMany: 0, writeMany: 0 };
  inner.readMany = vi.fn(async (paths: readonly string[]) => {
    calls.readMany++;
    const out = new Map<string, File>();
    for (const p of paths) {
      const b = await inner.read(p).catch(() => null);
      const st = await inner.stat(p);
      if (b && st) out.set(p, new File([b], p.split("/").pop()!, { lastModified: st.mtime }));
    }
    return out;
  });
  inner.writeMany = vi.fn(async (items, lock) => {
    calls.writeMany++;
    const out = new Map<string, boolean | Error>();
    for (const it of items)
      out.set(
        it.path,
        await lock(it.path, async () => {
          await inner.write(it.path, it.data);
          return true;
        }),
      );
    return out;
  });
  return { inner, calls };
}

afterEach(() => setVaultBackend(null));

describe("the vault gate passes batch I/O on (W10.E51)", () => {
  it("a plain vault: readWorkspaceTexts and writeWorkspaceFilesIf use the store's readMany and writeMany, once each", async () => {
    const { inner, calls } = batchingStore();
    setVaultBackend(inner);
    for (let i = 0; i < 5; i++) await writeWorkspaceFile(`n/${i}.md`, `note ${i}`);
    const read = await readWorkspaceTexts(["n/0.md", "n/1.md", "n/2.md", "n/3.md", "n/4.md"]);
    expect(calls.readMany).toBe(1);
    expect([...read.values()].map((r) => r.text)).toEqual(["note 0", "note 1", "note 2", "note 3", "note 4"]);
    const wrote = await writeWorkspaceFilesIf([...read].map(([path, r]) => ({ path, content: r.text + "!", expect: r.stamp })));
    expect(calls.writeMany).toBe(1);
    expect([...wrote.values()]).toEqual([true, true, true, true, true]);
    expect(typeof getVaultBackend().readMany).toBe("function");
  });

  it("ciphertext in a vault without a header is left out of the batch, so read() deals with it as before", async () => {
    const { inner } = batchingStore();
    setVaultBackend(inner);
    await writeWorkspaceFile("a.md", "plain");
    await inner.write("b.md", new Uint8Array([...ENCRYPTED_PREFIX, 1, 2, 3]));
    const files = await getVaultBackend().readMany!(["a.md", "b.md"]);
    expect([...files.keys()]).toEqual(["a.md"]);
  });

  it("an encrypted vault (a header is there): no batch, null from writeMany, an empty readMany; the caller goes file by file", async () => {
    const { inner, calls } = batchingStore();
    await inner.write(HEADER_PATH, "{}");
    setVaultBackend(inner);
    expect(await getVaultBackend().writeMany!([], async (_p, fn) => fn())).toBeNull();
    expect((await getVaultBackend().readMany!(["x.md"])).size).toBe(0);
    expect(calls).toEqual({ readMany: 0, writeMany: 0 });
  });
});
