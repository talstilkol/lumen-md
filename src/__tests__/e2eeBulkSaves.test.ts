/**
 * The 10,000-note re-key test (e2eeKeyring.test.ts) ran past the shim's
 * 15-minute limit (L1, W6.3). The re-key itself was quick; the first syncs
 * around it were quadratic. The store saves the whole device state (the base
 * of every path) at once, and the engine saved it once per uploaded blob and
 * once per base entry: 2 × 10,000 saves of a state that grows to 10,000
 * entries. A first sync of 2,000 notes took 3.2 s, of 3,000 8.2 s. The tree
 * check also scanned every live path for every change.
 *
 * Now base entries of the bulk loops, blob names recorded before upload and
 * deleted names are saved SAVE_BATCH (128) at a time, and the crash-safety
 * order holds: a blob's name is in the saved `pending` before the blob is
 * written. A round cut off mid-way leaves no orphan and converges.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { memoryProvider, type SyncProvider } from "../sync/e2ee/provider";
import { SAVE_BATCH } from "../sync/e2ee/engineTypes";
import { joinVault, newVault, snapshot, type Device } from "./helpers/e2ee";
import { HEADER_NAME } from "../sync/e2ee/header";
import { KEYRING_NAME } from "../sync/e2ee/keyring";

function countSaves(d: Device): { saves: () => number } {
  let n = 0;
  const save = d.store.save.bind(d.store);
  d.store.save = async (s) => {
    n++;
    return save(s);
  };
  return { saves: () => n };
}

describe("encrypted sync: bulk rounds save the device state in batches (FC1)", () => {
  it("a first sync of 2,000 notes up and down saves the state about 2,000 / SAVE_BATCH times, not 2 × 2,000", async () => {
    const p = memoryProvider();
    const a = await newVault(p);
    const ca = countSaves(a);
    for (let i = 0; i < 2000; i++) a.files.set(`n/${i % 20}/${i}.md`, `note ${i} — שלום`);
    expect((await a.sync.sync()).uploaded).toBe(2000);
    // Uploads: 2,000 / 128 pre-registrations; commit; base entries: 2,000 / 128; a few fixed saves.
    expect(ca.saves()).toBeLessThan(2 * Math.ceil(2000 / SAVE_BATCH) + 12);
    const b = await joinVault("B", p);
    const cb = countSaves(b);
    expect((await b.sync.sync()).downloaded).toBe(2000);
    expect(cb.saves()).toBeLessThan(Math.ceil(2000 / SAVE_BATCH) + 12);
    expect(snapshot(b)).toEqual(snapshot(a));
  }, 120_000);

  it("every blob's name is in the saved pending list before the blob is written", async () => {
    const inner = memoryProvider();
    let a: Device | null = null;
    const unsaved: string[] = [];
    const p: SyncProvider = {
      ...inner,
      id: inner.id,
      get: (n) => inner.get(n),
      list: () => inner.list(),
      delete: (n) => inner.delete(n),
      put: (n, d, c) => {
        const saved = a?.store.state?.pending ?? [];
        const meta = n === HEADER_NAME || n === KEYRING_NAME || !c || c.ifNoneMatch !== "*";
        if (a && !meta && !saved.includes(n)) unsaved.push(n);
        return inner.put(n, d, c);
      },
    };
    a = await newVault(p);
    for (let i = 0; i < 300; i++) a.files.set(`n/${i}.md`, `note ${i}`);
    await a.sync.sync();
    expect(unsaved).toEqual([]);
  }, 120_000);

  it("a round cut off mid-upload and mid-download converges, with no orphan blob left", async () => {
    const inner = memoryProvider();
    let failPutAt = -1;
    let failGetAt = -1;
    let puts = 0;
    let gets = 0;
    const p: SyncProvider = {
      ...inner,
      id: inner.id,
      get: (n) => (++gets === failGetAt ? Promise.reject(new Error("network down")) : inner.get(n)),
      list: () => inner.list(),
      delete: (n) => inner.delete(n),
      put: (n, d, c) => (++puts === failPutAt ? Promise.reject(new Error("network down")) : inner.put(n, d, c)),
    };
    const a = await newVault(p);
    for (let i = 0; i < 400; i++) a.files.set(`n/${i}.md`, `note ${i}`);
    puts = 0;
    failPutAt = 250;
    await expect(a.sync.sync()).rejects.toThrow(/network down/);
    failPutAt = -1;
    expect((await a.sync.sync()).uploaded).toBe(400);
    await a.sync.sync();
    const b = await joinVault("B", p);
    gets = 0;
    failGetAt = 200;
    await expect(b.sync.sync()).rejects.toThrow(/network down/);
    failGetAt = -1;
    await b.sync.sync();
    expect(snapshot(b)).toEqual(snapshot(a));
    // Every object is the header, the keyring, a manifest or a blob the manifest names: no orphans.
    const objects = (await inner.list()).filter((n) => n !== HEADER_NAME && n !== KEYRING_NAME);
    expect(objects.length).toBeLessThanOrEqual(400 + 2);
    expect(a.store.state!.pending).toEqual([]);
  }, 120_000);
});
