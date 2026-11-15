/**
 * W11.Q10 (research R5.12): the OPFS write worker's logic
 * (src/storage/vault/vaultIoFs.ts): every write with a sync access handle,
 * atomically (atomic.ts), flushed and size-checked.
 *
 * OPFS itself exists only in a browser, and sync access handles only in a
 * dedicated worker, so the folder here is an in-memory model of the OPFS
 * calls the worker makes (getFileHandle, createSyncAccessHandle, move,
 * removeEntry, entries). It can fail a write part-way, the way a crash or a
 * full disk does. The worker in a real Chromium is exercised by
 * `node scripts/perf/opfs-bench.mjs --selftest`.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { errorFromAnswer, handleWrite, SyncWriteUnsupported, writeViaSyncHandles, type DirLike, type FileLike, type SyncHandle } from "../storage/vault/vaultIoFs";
import { explainError, errorKind } from "../lib/userError";

type Fault = { failAfterBytes?: number; flushError?: string; shortSize?: boolean };

interface MemDir extends DirLike {
  files: Map<string, Uint8Array>;
  dirs: Map<string, MemDir>;
}

/** An in-memory OPFS folder tree. `fault(name)` decides how a write to that file fails. */
function memoryOpfs(opts: { noMove?: boolean; noSync?: boolean; fault?: (name: string) => Fault | undefined } = {}): MemDir {
  const make = (name: string): MemDir => {
    const files = new Map<string, Uint8Array>();
    const dirs = new Map<string, MemDir>();
    const notFound = () => Object.assign(new Error("not found"), { name: "NotFoundError" });
    const fileHandle = (fname: string): FileLike => {
      const h: FileLike = {
        kind: "file",
        name: fname,
        getFile: async () => {
          const b = files.get(fname);
          if (!b) throw notFound();
          return { size: b.byteLength, arrayBuffer: async () => b.slice().buffer as ArrayBuffer };
        },
      };
      if (!opts.noSync)
        h.createSyncAccessHandle = async (): Promise<SyncHandle> => {
          const f = opts.fault?.(fname) ?? {};
          let buf = files.get(fname) ?? new Uint8Array(0);
          return {
            truncate(n) {
              buf = buf.slice(0, n);
              files.set(fname, buf);
            },
            write(data, { at }) {
              let take = data.byteLength;
              if (f.failAfterBytes !== undefined) {
                take = Math.max(0, Math.min(take, f.failAfterBytes - at));
                const part = new Uint8Array(Math.max(buf.byteLength, at + take));
                part.set(buf);
                part.set(data.subarray(0, take), at);
                buf = part;
                files.set(fname, buf);
                if (take < data.byteLength) throw Object.assign(new Error("The operation failed for reasons unrelated to the database itself"), { name: "InvalidStateError" });
                return take;
              }
              const next = new Uint8Array(Math.max(buf.byteLength, at + take));
              next.set(buf);
              next.set(data, at);
              buf = next;
              files.set(fname, buf);
              return take;
            },
            flush() {
              if (f.flushError) throw Object.assign(new Error("flush failed"), { name: f.flushError });
            },
            getSize: () => (f.shortSize ? buf.byteLength - 1 : buf.byteLength),
            close() {},
          };
        };
      if (!opts.noMove)
        h.move = async (to: string) => {
          if (files.has(to)) throw Object.assign(new Error("exists"), { name: "InvalidModificationError" });
          const b = files.get(fname);
          if (!b) throw notFound();
          files.delete(fname);
          files.set(to, b);
          h.name = to;
          fname = to;
        };
      return h;
    };
    return {
      kind: "directory",
      name,
      files,
      dirs,
      async getDirectoryHandle(n, o) {
        if (!dirs.has(n)) {
          if (!o?.create) throw notFound();
          dirs.set(n, make(n));
        }
        return dirs.get(n)!;
      },
      async getFileHandle(n, o) {
        if (!files.has(n)) {
          if (!o?.create) throw notFound();
          files.set(n, new Uint8Array(0));
        }
        return fileHandle(n);
      },
      async removeEntry(n) {
        if (!files.delete(n) && !dirs.delete(n)) throw notFound();
      },
      async *entries() {
        for (const n of files.keys()) yield [n, fileHandle(n)] as [string, FileLike];
        for (const [n, d] of dirs) yield [n, d] as [string, DirLike];
      },
    };
  };
  return make("");
}

const text = (b: Uint8Array | undefined) => new TextDecoder().decode(b);
const enc = (s: string) => new TextEncoder().encode(s);
const leftovers = (names: Iterable<string>) => [...names].filter((n) => n.startsWith(".lumen-"));

describe("OPFS writes through sync access handles, atomically (W11.Q10)", () => {
  it("writes a new note, in its folders, with no leftovers", async () => {
    const root = memoryOpfs();
    await writeViaSyncHandles(root, ["notes", "a.md"], enc("שלום"));
    const notes = root.dirs.get("notes")!;
    expect(text(notes.files.get("a.md"))).toBe("שלום");
    expect(leftovers(notes.files.keys())).toEqual([]);
  });

  it("replaces a note whole", async () => {
    const root = memoryOpfs();
    await writeViaSyncHandles(root, ["a.md"], enc("old version"));
    await writeViaSyncHandles(root, ["a.md"], enc("new"));
    expect(text(root.files.get("a.md"))).toBe("new");
    expect(leftovers(root.files.keys())).toEqual([]);
  });

  it("a write interrupted part-way leaves the old note whole and no partial file", async () => {
    const root = memoryOpfs({ fault: (n) => (n.startsWith(".lumen-tmp") ? { failAfterBytes: 3 } : undefined) });
    root.files.set("a.md", enc("the old version, whole"));
    await expect(writeViaSyncHandles(root, ["a.md"], enc("a longer new version"))).rejects.toThrow();
    expect(text(root.files.get("a.md"))).toBe("the old version, whole");
    expect(leftovers(root.files.keys())).toEqual([]);
  });

  it("a write the platform cut short (size check) never replaces the note", async () => {
    const root = memoryOpfs({ fault: (n) => (n.startsWith(".lumen-tmp") ? { shortSize: true } : undefined) });
    root.files.set("a.md", enc("old"));
    await expect(writeViaSyncHandles(root, ["a.md"], enc("new text"))).rejects.toThrow(/cut short/);
    expect(text(root.files.get("a.md"))).toBe("old");
    expect(leftovers(root.files.keys())).toEqual([]);
  });

  it("a long Hebrew name uses the journal and leaves nothing behind", async () => {
    const root = memoryOpfs();
    const name = `${"פתק ארוך מאוד ".repeat(10)}.md`;
    expect(new TextEncoder().encode(name).byteLength).toBeGreaterThan(200);
    await writeViaSyncHandles(root, [name], enc("x"));
    await writeViaSyncHandles(root, [name], enc("y"));
    expect(text(root.files.get(name))).toBe("y");
    expect(leftovers(root.files.keys())).toEqual([]);
  });

  it("refuses up front, without touching the note, when sync access handles or move() are missing", async () => {
    const noSync = memoryOpfs({ noSync: true });
    noSync.files.set("a.md", enc("keep"));
    await expect(writeViaSyncHandles(noSync, ["a.md"], enc("new"))).rejects.toBeInstanceOf(SyncWriteUnsupported);
    expect(text(noSync.files.get("a.md"))).toBe("keep");
    const noMove = memoryOpfs({ noMove: true });
    noMove.files.set("a.md", enc("keep"));
    await expect(writeViaSyncHandles(noMove, ["a.md"], enc("new"))).rejects.toBeInstanceOf(SyncWriteUnsupported);
    expect(text(noMove.files.get("a.md"))).toBe("keep");
    // Where the main thread cannot write at all, the worker writes in place rather than not at all.
    await writeViaSyncHandles(noMove, ["a.md"], enc("new"), { inPlaceIfNoMove: true });
    expect(text(noMove.files.get("a.md"))).toBe("new");
  });
});

describe("the worker's answers (W11.Q10)", () => {
  it("answers ok, and an error with its name kept, and says when the engine cannot do it", async () => {
    const root = memoryOpfs();
    const bytes = enc("hi").buffer as ArrayBuffer;
    expect(await handleWrite({ id: 1, parts: ["a.md"], bytes }, async () => root)).toEqual({ id: 1, ok: true });
    const full = memoryOpfs({ fault: (n) => (n.startsWith(".lumen-tmp") ? { flushError: "QuotaExceededError" } : undefined) });
    const a = await handleWrite({ id: 2, parts: ["a.md"], bytes }, async () => full);
    expect(a).toMatchObject({ id: 2, ok: false, name: "QuotaExceededError", unsupported: false });
    const old = await handleWrite({ id: 3, parts: ["a.md"], bytes }, async () => memoryOpfs({ noSync: true }));
    expect(old).toMatchObject({ ok: false, unsupported: true });
  });

  it("a full disk reaches the person as the out-of-storage explanation, not a generic failure", async () => {
    const full = memoryOpfs({ fault: (n) => (n.startsWith(".lumen-tmp") ? { flushError: "QuotaExceededError" } : undefined) });
    full.files.set("a.md", enc("still here"));
    const a = await handleWrite({ id: 1, parts: ["a.md"], bytes: enc("new").buffer as ArrayBuffer }, async () => full);
    if (a.ok) throw new Error("expected a failure");
    const err = errorFromAnswer(a);
    expect(err.name).toBe("QuotaExceededError");
    expect(errorKind(err)).toBe("quota");
    expect(explainError(err, "test")).toBe("This device is out of storage space. Your text is still open here; free some space or export the vault, then try again.");
    // And the note was not damaged.
    expect(text(full.files.get("a.md"))).toBe("still here");
    expect(leftovers(full.files.keys())).toEqual([]);
  });
});
