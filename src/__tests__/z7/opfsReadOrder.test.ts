// @vitest-environment node
/**
 * Review Z7-M2 and Z7-L7 (#938): an OPFS worker read during a save of the same note must not find "missing"
 * (the save renames the note away and back), the main thread's fallback read must wait for that note's write, and a
 * worker write the engine cannot do must not leave an empty note behind. The first test is the reviewer's repro
 * ($S/z7-tests/opfsRead.test.ts) with its expectation turned round.
 */
import { describe, expect, it } from "vitest";
import { readViaSyncHandles, writeViaSyncHandles, READ_MISSING, SyncWriteUnsupported, type DirLike, type FileLike } from "../../storage/vault/vaultIoFs";
import { createDirectoryHandleBackend } from "../../storage/vault";
import { FakeDir } from "../helpers/fakeOpfs";

const tick = () => new Promise((r) => setTimeout(r, 0));
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

/** A sync-access-handle OPFS folder; every call takes a turn of the event loop, as the real ones do. */
function dir(opts: { noSyncHandles?: boolean } = {}): DirLike & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const nf = () => Object.assign(new Error("nf"), { name: "NotFoundError" });
  const fh = (name: string): FileLike => {
    let n = name;
    const h: FileLike = {
      kind: "file",
      get name() {
        return n;
      },
      getFile: async () => {
        await tick();
        const b = files.get(n);
        if (!b) throw nf();
        return { size: b.length, arrayBuffer: async () => b.slice().buffer };
      },
      move: async (to: string) => {
        await tick();
        const b = files.get(n);
        if (!b) throw nf();
        files.delete(n);
        files.set(to, b);
        n = to;
      },
    } as FileLike;
    if (!opts.noSyncHandles)
      h.createSyncAccessHandle = async () => {
        await tick();
        let buf = files.get(n) ?? new Uint8Array();
        return {
          truncate(s: number) {
            buf = buf.slice(0, s);
            files.set(n, buf);
          },
          write(d: Uint8Array, { at }: { at: number }) {
            const x = new Uint8Array(Math.max(buf.length, at + d.length));
            x.set(buf);
            x.set(d, at);
            buf = x;
            files.set(n, buf);
            return d.length;
          },
          read(into: Uint8Array, { at }: { at: number }) {
            const p = buf.subarray(at, at + into.length);
            into.set(p);
            return p.length;
          },
          flush() {},
          getSize: () => buf.length,
          close() {},
        };
      };
    return h;
  };
  return {
    kind: "directory",
    name: "",
    files,
    async getDirectoryHandle() {
      throw nf();
    },
    async getFileHandle(n, o) {
      await tick();
      if (!files.has(n)) {
        if (!o?.create) throw nf();
        files.set(n, new Uint8Array());
      }
      return fh(n);
    },
    async removeEntry(n) {
      await tick();
      if (!files.delete(n)) throw nf();
    },
    async *entries() {
      for (const k of files.keys()) yield [k, fh(k)] as [string, FileLike];
    },
  };
}

describe("Z7-M2: the worker reads a note in its path order", () => {
  it("a read sent during a save of an existing note never finds it missing (40 interleavings)", async () => {
    const d = dir();
    d.files.set("a.md", enc("old"));
    let missing = 0;
    for (let k = 0; k < 40; k++) {
      const w = writeViaSyncHandles(d, ["a.md"], enc("new" + k));
      for (let j = 0; j < k % 12; j++) await tick();
      const r = await readViaSyncHandles(d, [["a.md"]]);
      if (r.lengths[0] === READ_MISSING) missing++;
      else expect(dec(r.data)).toBe("new" + k); // sent after the write, so it sees the new version
      await w;
    }
    expect(missing).toBe(0);
  });

  it("many notes read in one batch while each is saved: none missing", async () => {
    const d = dir();
    const names = Array.from({ length: 12 }, (_, i) => `n${i}.md`);
    for (const n of names) d.files.set(n, enc("old"));
    const writes = names.map((n) => writeViaSyncHandles(d, [n], enc("new")));
    const r = await readViaSyncHandles(d, names.map((n) => [n]));
    await Promise.all(writes);
    expect(r.lengths.filter((l) => l === READ_MISSING)).toEqual([]);
  });
});

describe("Z7-M2: the main thread's fallback read waits for the note's write", () => {
  it("read() during a worker save that has renamed the note away returns the new text, not not-found", async () => {
    const fake = new FakeDir();
    let pending = 0;
    let armed = false;
    let release!: () => void;
    let away!: () => void;
    const gone = new Promise<void>((r) => (away = r));
    const v = createDirectoryHandleBackend({
      id: "opfs",
      root: async () => fake as unknown as FileSystemDirectoryHandle,
      // The worker's atomic save, its window held open: the note's name is gone until release().
      writePrimary: async (segments, data) => {
        if (!armed) return false; // the first save goes the usual way

        pending++;
        const f = fake.files.get(segments[0])!;
        fake.files.delete(segments[0]);
        away();
        await new Promise<void>((r) => (release = r));
        f.data = new Blob([data as string]);
        fake.files.set(segments[0], f);
        pending--;
        return true;
      },
      readPrimary: async () => null, // the worker answered READ_MISSING: the main thread decides
      writesPending: () => pending > 0,
    });
    await v.write("a.md", "old");
    armed = true;
    const w = v.write("a.md", "new");
    await gone;
    const r = v.readText("a.md");
    await tick();
    release();
    await w;
    expect(await r).toBe("new");
  });
});

describe("Z7-L7: a worker write this engine cannot do leaves no empty note", () => {
  it("no createSyncAccessHandle: refused, and no entry is left at the note's name", async () => {
    const d = dir({ noSyncHandles: true });
    await expect(writeViaSyncHandles(d, ["new.md"], enc("text"))).rejects.toBeInstanceOf(SyncWriteUnsupported);
    expect([...d.files.keys()]).toEqual([]);
  });
  it("no move (and no in-place allowed): refused, nothing left; an existing note is kept as it was", async () => {
    const d = dir();
    const noMove = { ...d, getFileHandle: async (n: string, o?: { create?: boolean }) => ({ ...(await d.getFileHandle(n, o)), move: undefined }) as FileLike } as DirLike;
    await expect(writeViaSyncHandles(noMove, ["new.md"], enc("text"))).rejects.toBeInstanceOf(SyncWriteUnsupported);
    expect([...d.files.keys()]).toEqual([]);
    d.files.set("old.md", enc("kept"));
    await expect(writeViaSyncHandles(noMove, ["old.md"], enc("text"))).rejects.toBeInstanceOf(SyncWriteUnsupported);
    expect(dec(d.files.get("old.md")!)).toBe("kept");
  });
});
