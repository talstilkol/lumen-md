/**
 * Review Z6-M3 and Z6-L3 (#932): a create that fails leaves no empty file, and rename and save recovery are under the
 * per-path lock, in one lock order (src/storage/vault/shared.ts PathLock). Each race is forced with a gate on one
 * step of the fake file system, so it does not depend on timing luck. The fakes are the repository's
 * (helpers/fakeOpfs, fakeMobile, fakeTauriVault).
 */
import { describe, expect, it } from "vitest";
import { FakeDir } from "../helpers/fakeOpfs";
import { fakeCapacitorFilesystem } from "../helpers/fakeMobile";
import { fakeTauriVault } from "../helpers/fakeTauriVault";
import { createDirectoryHandleBackend } from "../../storage/vault";
import { capacitorFs, createMobileBackend, type MobileFs } from "../../storage/vault/mobile";
import { createTauriBackend } from "../../storage/vault/tauri";
import { sha256Hex } from "../../storage/vault/cas";
import { PathLock } from "../../storage/vault/shared";

const hash = (s: string) => sha256Hex(new TextEncoder().encode(s));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A gate: `wait()` blocks until `open()`; `reached` resolves when someone first waits. */
function gate() {
  let open!: () => void;
  let reach!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  const reached = new Promise<void>((r) => (reach = r));
  return { open, reached, wait: () => (reach(), opened) };
}

type Writable = { write(d: unknown): Promise<void>; close(): Promise<void> };
/** Every writable of `dir`'s files: `onClose(chunks)` runs before the real close. */
function hookWrites(dir: FakeDir, onClose: (chunks: unknown[], name: string) => Promise<void>) {
  const plain = dir.getFileHandle.bind(dir);
  dir.getFileHandle = (async (name: string, opts?: { create?: boolean }) => {
    const h = await plain(name, opts);
    const make = h.createWritable.bind(h);
    (h as unknown as { createWritable: () => Promise<Writable> }).createWritable = async () => {
      const w = (await make()) as Writable;
      const chunks: unknown[] = [];
      return {
        write: async (d: unknown) => {
          chunks.push(d);
          await w.write(d);
        },
        close: async () => {
          await onClose(chunks, name);
          await w.close();
        },
      };
    };
    return h;
  }) as typeof dir.getFileHandle;
}

describe("directory-handle backend: a rename waits for a writeIf on its target (Z6-L3)", () => {
  it("a rename onto b.md cannot land between writeIf(b.md)'s compare and its swap", async () => {
    const dir = new FakeDir();
    const v = createDirectoryHandleBackend({ id: "f", root: async () => dir as unknown as FileSystemDirectoryHandle });
    await v.write("a.md", "AAA");
    await v.write("b.md", "old");
    const g = gate();
    hookWrites(dir, async (chunks) => {
      if (chunks.includes("from sync")) await g.wait();
    });
    const w = v.writeIf("b.md", "from sync", await hash("old"));
    // writeIf has compared b.md and staged its bytes; its swap waits at the gate.
    await g.reached;
    const r = v.rename("a.md", "b.md", { overwrite: true });
    await sleep(30);
    g.open();
    const [ok] = await Promise.all([w, r]);
    const b = await v.readText("b.md");
    // Either order is fine; a.md's text must not be lost under a "successful" sync write.
    expect(ok).toBe(true);
    expect(await v.stat("a.md")).toBe(null);
    expect(b).toBe("AAA");
  });

  it("two renames over each other's paths finish (one lock order: no deadlock)", async () => {
    const dir = new FakeDir();
    const v = createDirectoryHandleBackend({ id: "f", root: async () => dir as unknown as FileSystemDirectoryHandle });
    await v.write("x.md", "X");
    await v.write("y.md", "Y");
    const both = Promise.allSettled([v.rename("x.md", "y.md", { overwrite: true }), v.rename("y.md", "x.md", { overwrite: true })]);
    const done = await Promise.race([both.then(() => "done"), sleep(2000).then(() => "stuck")]);
    expect(done).toBe("done");
    const left = [await v.stat("x.md"), await v.stat("y.md")].filter(Boolean);
    expect(left).toHaveLength(1);
  });
});

describe("directory-handle backend: save recovery under the note's lock (Z6-L3)", () => {
  it("a recovery started before writeIf(null) never overwrites what that writeIf wrote", async () => {
    const dir = new FakeDir();
    let pending = false;
    const v = createDirectoryHandleBackend({ id: "f", root: async () => dir as unknown as FileSystemDirectoryHandle, writesPending: () => pending });
    // An interrupted save of n.md (./atomic.ts): its old version is aside, the note itself is missing.
    await v.write("seed.md", "x");
    const old = await dir.getFileHandle(".lumen-old~n.md~0000000000000001", { create: true });
    const ow = await old.createWritable();
    await ow.write("OLD");
    await ow.close();
    // The recovery has listed the folder (n.md missing) and decided to restore it; it waits at the gate as it opens
    // the old version to move it into place.
    const g = gate();
    const plain = dir.getFileHandle.bind(dir);
    dir.getFileHandle = (async (name: string, opts?: { create?: boolean }) => {
      if (name.startsWith(".lumen-old~")) await g.wait();
      return plain(name, opts);
    }) as typeof dir.getFileHandle;
    const recovering = v.read("m.md").catch(() => null);
    await g.reached;
    // A save of the OPFS worker is in flight now, so writeIf does not run a recovery of its own.
    pending = true;
    const w = v.writeIf("n.md", "new", null);
    await sleep(30);
    g.open();
    const ok = await w;
    await recovering;
    const n = await v.readText("n.md");
    // writeIf(null) may only succeed while nothing is at n.md, and then what it wrote stays.
    if (ok) expect(n).toBe("new");
    else expect(n).toBe("OLD");
    expect(ok).toBe(false);
  });
});

describe("mobile backend: a rename is one step for writeIf (Z6-L3)", () => {
  it("writeIf(null) never sees the target missing half way through a rename that replaces it", async () => {
    const cap = fakeCapacitorFilesystem();
    const fs = capacitorFs(cap.plugin, "DOCUMENTS");
    const g = gate();
    let renaming = false;
    const gated: MobileFs = {
      ...fs,
      remove: async (p) => {
        await fs.remove(p);
        if (renaming && p === "b.md") await g.wait();
      },
    };
    const v = createMobileBackend(gated);
    await v.write("a.md", "AAA");
    await v.write("b.md", "old");
    renaming = true;
    const r = v.rename("a.md", "b.md", { overwrite: true });
    // The rename removed b.md and has not moved a.md onto it yet.
    await g.reached;
    renaming = false;
    const w = v.writeIf("b.md", "new", null);
    await sleep(30);
    g.open();
    const [ok] = await Promise.all([w, r]);
    expect(ok).toBe(false);
    expect(await v.readText("b.md")).toBe("AAA");
  });
});

describe("desktop backend: a rename waits for a writeIf on its paths (Z6-L3)", () => {
  it("vault_rename is not sent while writeIf(b.md) runs", async () => {
    const t = fakeTauriVault("/home/tal/Notes");
    const g = gate();
    const sent: string[] = [];
    const invoke = (async (cmd: string, args?: unknown, o?: unknown) => {
      sent.push(cmd);
      if (cmd === "vault_write_if") await g.wait();
      return (t.invoke as (c: string, a?: unknown, o?: unknown) => Promise<unknown>)(cmd, args, o);
    }) as typeof t.invoke;
    const v = createTauriBackend(invoke, "/home/tal/Notes");
    await v.write("a.md", "AAA");
    await v.write("b.md", "old");
    const w = v.writeIf("b.md", "from sync", await hash("old"));
    await g.reached;
    const r = v.rename("a.md", "b.md", { overwrite: true });
    await sleep(30);
    expect(sent).not.toContain("vault_rename");
    g.open();
    await Promise.all([w, r]);
    expect(sent.indexOf("vault_rename")).toBeGreaterThan(sent.indexOf("vault_write_if"));
    expect(await v.readText("b.md")).toBe("AAA");
  });
});

describe("PathLock.runAll", () => {
  it("takes several paths in ascending order, once each", async () => {
    const lock = new PathLock();
    const order: string[] = [];
    const hold = gate();
    const first = lock.run("b", async () => {
      order.push("b held");
      await hold.wait();
    });
    const all = lock.runAll(["c", "b", "a", "b"], async () => void order.push("all"));
    const a = lock.run("a", async () => void order.push("a alone"));
    await hold.reached;
    await sleep(10);
    // runAll took "a", then waits for "b": a later "a" waits behind it.
    expect(order).toEqual(["b held"]);
    hold.open();
    await Promise.all([first, all, a]);
    expect(order).toEqual(["b held", "all", "a alone"]);
  });
});
