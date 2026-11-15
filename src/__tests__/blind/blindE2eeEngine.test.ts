/**
 * Blind tests (plan W6.15, W10.D18): the encrypted sync engine — rounds,
 * conflicts, replay and fork detection, interrupted rounds, the freeze and
 * its call-off, unverified devices and the pairing hold on key changes.
 *
 * Written from the spec only: docs/src/content/docs/sync/e2ee.md ("A sync
 * round", "Conflicts", "Rollback and replay protection", "New devices"),
 * docs/sync-protocol.md §4, §5 (Re-key, Calling a freeze off), §6, §9,
 * docs/src/content/docs/sync/e2ee-keys.md and the declarations tsc emits for
 * src/sync/e2ee/engine*.ts, conflict.ts, localFiles.ts, state.ts and
 * provider.ts (signatures and doc comments, no function bodies, no existing
 * engine tests). Lane X-BL, against verify/train-5 (c3f055218e).
 */
import { describe, expect, it } from "vitest";
import {
  KeyChangeInProgressError,
  memoryProvider,
  RollbackError,
  type ConflictResolution,
} from "../../sync/e2ee";
import { PairingPendingError } from "../../sync/e2ee/engine";
import { conflictCopyPath, keepBothResolver, type ConflictInput, type ConflictResolver } from "../../sync/e2ee/conflict";
import { isSyncedPath } from "../../sync/e2ee/localFiles";
import { FREEZE_TTL_MS, manifestName, manifestNameFor, openManifest } from "../../sync/e2ee/manifest";
import { KEYRING_NAME, keyringContents, decodeKeyring } from "../../sync/e2ee/keyring";
import {
  caught,
  contains,
  dec,
  deviceOn,
  forcePut,
  getObj,
  newVault,
  opaqueNames,
  passphraseDevice,
  providerFrom,
  snapshot,
  switchable,
  type Device,
} from "./_e2eeHarness";

/** A resolver that records what it was asked and answers `answer`. */
function recording(answer: ConflictResolution | ((c: ConflictInput) => ConflictResolution)) {
  const calls: ConflictInput[] = [];
  const resolver = async (c: ConflictInput) => {
    calls.push(c);
    return typeof answer === "function" ? answer(c) : answer;
  };
  return { calls, resolver };
}

async function pair(resolver?: ConflictResolver) {
  const v = await newVault();
  const b = await passphraseDevice(v.provider, { confirm: true, resolver });
  return { ...v, a: v.creator, b };
}

async function manifestOf(d: Device, provider: { get(n: string): Promise<{ data: Uint8Array } | null> }) {
  const k = d.engine.keys();
  const name = k.ring ? await manifestNameFor(k, k.ring.manifest) : await manifestName(k);
  const o = await provider.get(name);
  return { name, opened: o ? await openManifest(k, o.data, name) : null };
}

describe("blind: sync rounds (W10.D18)", () => {
  it("E1 two devices converge; the storage holds only the header and 43-character names, and no path or text in the clear", async () => {
    const { provider, a, b } = await pair();
    a.files.set("people/source-name.md", "met the witness at noon");
    b.files.set("b.md", "from b");
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();
    expect(a.files.text("b.md")).toBe("from b");
    expect(b.files.text("people/source-name.md")).toBe("met the witness at noon");
    for (const n of await opaqueNames(provider)) {
      expect(n).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const o = await getObj(provider, n);
      expect(contains(o.data, "source-name")).toBe(false);
      expect(contains(o.data, "witness")).toBe(false);
    }
    expect(contains((await getObj(provider, "lumen-e2ee-vault")).data, "source-name")).toBe(false);
  });

  it("E2 every manifest write raises the counter by one", async () => {
    const { provider, a } = await pair();
    const c0 = (await manifestOf(a, provider)).opened!.manifest.counter;
    a.files.set("x.md", "1");
    const r1 = await a.engine.sync();
    a.files.set("x.md", "2");
    const r2 = await a.engine.sync();
    expect(r1.counter).toBe(c0 + 1);
    expect(r2.counter).toBe(c0 + 2);
    const m = (await manifestOf(a, provider)).opened!.manifest;
    expect(m.counter).toBe(c0 + 2);
    expect(m.history[m.history.length - 1][0]).toBe(c0 + 1);
    expect(m.files["x.md"].ver).toBe(2);
  });

  it("E3 two devices pushing from the same version both end up in the manifest (compare-and-swap, retry)", async () => {
    const { a, b } = await pair();
    a.files.set("a.md", "A");
    b.files.set("b.md", "B");
    await Promise.all([a.engine.sync(), b.engine.sync()]);
    await a.engine.sync();
    await b.engine.sync();
    for (const d of [a, b]) {
      expect(d.files.text("a.md")).toBe("A");
      expect(d.files.text("b.md")).toBe("B");
    }
  });

  it("E4 the same change on both sides asks nothing", async () => {
    const rec = recording({ kind: "local" });
    const { a, b } = await pair(rec.resolver);
    a.files.set("n.md", "base");
    await a.engine.sync();
    await b.engine.sync();
    a.files.set("n.md", "same edit");
    b.files.set("n.md", "same edit");
    await a.engine.sync();
    const r = await b.engine.sync();
    expect(rec.calls).toHaveLength(0);
    expect(r.held).toEqual([]);
    expect(b.files.text("n.md")).toBe("same edit");
  });

  it("E5 different edits on both sides reach the resolver with base, local and remote; 'remote' takes theirs on both", async () => {
    const rec = recording({ kind: "remote" });
    const { a, b } = await pair(rec.resolver);
    a.files.set("n.md", "line one\n");
    await a.engine.sync();
    await b.engine.sync();
    a.files.set("n.md", "AAA\n");
    b.files.set("n.md", "BBB\n");
    await a.engine.sync();
    const r = await b.engine.sync();
    expect(rec.calls).toHaveLength(1);
    expect(dec.decode(rec.calls[0].base!)).toBe("line one\n");
    expect(dec.decode(rec.calls[0].local)).toBe("BBB\n");
    expect(dec.decode(rec.calls[0].remote)).toBe("AAA\n");
    expect(r.conflicts).toContain("n.md");
    expect(b.files.text("n.md")).toBe("AAA\n");
    await a.engine.sync();
    expect(a.files.text("n.md")).toBe("AAA\n");
  });

  it("E6 'hold' (decide later) leaves the note as it is on both sides and asks again next round", async () => {
    const rec = recording({ kind: "hold" });
    const { a, b } = await pair(rec.resolver);
    a.files.set("n.md", "base\n");
    await a.engine.sync();
    await b.engine.sync();
    a.files.set("n.md", "mine on A\n");
    b.files.set("n.md", "mine on B\n");
    await a.engine.sync();
    const r = await b.engine.sync();
    expect(r.held).toContain("n.md");
    expect(b.files.text("n.md")).toBe("mine on B\n");
    await a.engine.sync();
    expect(a.files.text("n.md")).toBe("mine on A\n");
    await b.engine.sync();
    expect(rec.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("E7 an edit always wins over a deletion it did not see (both orders)", async () => {
    for (const editorFirst of [true, false]) {
      const { a, b } = await pair();
      a.files.set("n.md", "v1");
      await a.engine.sync();
      await b.engine.sync();
      a.files.delete("n.md");
      b.files.set("n.md", "edited on B");
      if (editorFirst) {
        await b.engine.sync();
        await a.engine.sync();
      } else {
        await a.engine.sync();
        await b.engine.sync();
        await a.engine.sync();
      }
      await b.engine.sync();
      expect(a.files.text("n.md")).toBe("edited on B");
      expect(b.files.text("n.md")).toBe("edited on B");
    }
  });

  it("E8 a deletion seen by both sides is applied; an unchanged file elsewhere is deleted", async () => {
    const { a, b } = await pair();
    a.files.set("gone.md", "x");
    await a.engine.sync();
    await b.engine.sync();
    a.files.delete("gone.md");
    const r = await a.engine.sync();
    expect(r.uploaded + r.deleted).toBeGreaterThanOrEqual(1);
    const rb = await b.engine.sync();
    expect(b.files.text("gone.md")).toBeUndefined();
    expect(rb.deleted).toBe(1);
  });

  it("E9 binary files keep both versions: yours at the path, theirs as `name (conflict <tag>).ext`", async () => {
    const { a, b } = await pair(keepBothResolver);
    const bin = (n: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, n]);
    await a.files.write("img.png", bin(1), null);
    await a.engine.sync();
    await b.engine.sync();
    await a.files.write("img.png", bin(2), (await a.files.list()).find((f) => f.path === "img.png")!.hash);
    await b.files.write("img.png", bin(3), (await b.files.list()).find((f) => f.path === "img.png")!.hash);
    await a.engine.sync();
    await b.engine.sync();
    expect([...b.files.files.get("img.png")!]).toEqual([...bin(3)]);
    const copy = [...b.files.files.keys()].find((p) => /^img \(conflict .+\)\.png$/.test(p));
    expect(copy).toBeTruthy();
    expect([...b.files.files.get(copy!)!]).toEqual([...bin(2)]);
  });

  // The doc comment says `dir/name (conflict <tag>).ext`, "or with \" 2\", \" 3\"… until `taken`
  // says the name is free", without saying where the number goes; this checks only what it says.
  it("E10 conflictCopyPath: `dir/name (conflict <tag>).ext`, then a free name with \" 2\", \" 3\" while taken", () => {
    expect(conflictCopyPath("dir/name.md", "2026-11-15 laptop", () => false)).toBe("dir/name (conflict 2026-11-15 laptop).md");
    const taken = new Set(["dir/name (conflict t).md"]);
    const second = conflictCopyPath("dir/name.md", "t", (p) => taken.has(p));
    expect(taken.has(second)).toBe(false);
    expect(second).toMatch(/^dir\/name \(conflict t.* 2.*\.md$/);
    taken.add(second);
    const third = conflictCopyPath("dir/name.md", "t", (p) => taken.has(p));
    expect(taken.has(third)).toBe(false);
    expect(third).toMatch(/ 3/);
  });

  it("E11 everything is synced except the top-level .trash/ and .git/; empty, . and .. segments are refused", () => {
    expect(isSyncedPath("notes/a.md")).toBe(true);
    expect(isSyncedPath(".github/workflows/x.yml")).toBe(true);
    expect(isSyncedPath(".gitignore")).toBe(true);
    expect(isSyncedPath(".trash/old.md")).toBe(false);
    expect(isSyncedPath(".git/HEAD")).toBe(false);
    expect(isSyncedPath("sub/.trash/x.md")).toBe(true);
    for (const bad of ["", "a//b.md", "./a.md", "a/../b.md", ".."]) expect(isSyncedPath(bad)).toBe(false);
  });
});

describe("blind: replay, fork and tampering (W10.D18)", () => {
  it("E12 the storage replays an older manifest: RollbackError ('older'), nothing applied", async () => {
    const sp = switchable();
    const { creator: a } = await newVault(sp);
    a.files.set("n.md", "v1");
    await a.engine.sync();
    const old = snapshot(sp.view);
    a.files.set("n.md", "v2");
    await a.engine.sync();
    sp.view = await providerFrom(old);
    const e = await caught(() => a.engine.sync());
    expect(e).toBeInstanceOf(RollbackError);
    expect((e as RollbackError).kind).toBe("older");
    expect(a.files.text("n.md")).toBe("v2");
  });

  it("E13 the storage shows a different manifest at the same counter: a fork", async () => {
    const sp = switchable();
    const { creator: a } = await newVault(sp);
    const b = await passphraseDevice(sp, { confirm: true });
    a.files.set("n.md", "v1");
    await a.engine.sync();
    await b.engine.sync();
    const branch = await providerFrom(snapshot(sp.view));
    a.files.set("a.md", "A's branch");
    await a.engine.sync();
    // On the copy the storage kept, b writes a different successor of the same manifest.
    const bOnBranch = deviceOn(branch, b.engine.keys(), { store: b.store, files: b.files });
    b.files.set("b.md", "B's branch");
    await bOnBranch.engine.sync();
    sp.view = branch;
    const e = await caught(() => a.engine.sync());
    expect(e).toBeInstanceOf(RollbackError);
    expect((e as RollbackError).kind).toBe("fork");
  });

  it("E14 a newer manifest from another branch (higher counter, history without the anchor) is a fork", async () => {
    const sp = switchable();
    const { creator: a } = await newVault(sp);
    const b = await passphraseDevice(sp, { confirm: true });
    await b.engine.sync();
    const branch = await providerFrom(snapshot(sp.view));
    a.files.set("a.md", "1");
    await a.engine.sync();
    const bOnBranch = deviceOn(branch, b.engine.keys(), { store: b.store, files: b.files });
    for (let i = 0; i < 3; i++) {
      b.files.set("b.md", String(i));
      await bOnBranch.engine.sync();
    }
    sp.view = branch;
    const e = await caught(() => a.engine.sync());
    expect(e).toBeInstanceOf(RollbackError);
    expect((e as RollbackError).kind).toBe("fork");
  });

  it("E15 a missing manifest, once a device has seen one, is refused", async () => {
    const { provider, creator: a } = await newVault();
    a.files.set("n.md", "v1");
    await a.engine.sync();
    const { name } = await manifestOf(a, provider);
    await provider.delete(name);
    expect(await caught(() => a.engine.sync())).toBeInstanceOf(Error);
    expect(a.files.text("n.md")).toBe("v1");
  });

  it("E16 a changed byte in the manifest or a blob is refused, and nothing from it is applied", async () => {
    const { provider, a, b } = await pair();
    a.files.set("n.md", "the real text");
    await a.engine.sync();
    const { name } = await manifestOf(a, provider);
    const blobNames = (await opaqueNames(provider)).filter((n) => n !== name);
    for (const n of blobNames) {
      const o = await getObj(provider, n);
      const t = new Uint8Array(o.data);
      t[t.length - 1] ^= 1;
      await forcePut(provider, n, t);
    }
    expect(await caught(() => b.engine.sync())).toBeInstanceOf(Error);
    expect(b.files.text("n.md")).toBeUndefined();
    const m = await getObj(provider, name);
    const t = new Uint8Array(m.data);
    t[20] ^= 1;
    await forcePut(provider, name, t);
    expect(await caught(() => b.engine.sync())).toBeInstanceOf(Error);
    expect(b.files.text("n.md")).toBeUndefined();
  });

  it("E17 a round cut off after the manifest write (answer lost) loses nothing and duplicates nothing", async () => {
    let cut = false;
    const inner = memoryProvider({
      fault: (op, _name, phase) => {
        if (cut && op === "put" && phase === "after") {
          cut = false;
          throw new Error("connection dropped");
        }
      },
    });
    const v = await newVault(inner);
    const b = await passphraseDevice(inner, { confirm: true });
    cut = true;
    v.creator.files.set("n.md", "survives");
    // The fault hits the first write of the round (a blob or the manifest); retry until clean.
    await caught(() => v.creator.engine.sync());
    await v.creator.engine.sync();
    await v.creator.engine.sync();
    await b.engine.sync();
    expect(b.files.text("n.md")).toBe("survives");
    expect([...b.files.files.keys()].filter((p) => p.startsWith("n"))).toEqual(["n.md"]);
  });
});

describe("blind: a forked manifest whose history skips the anchor (W10.D18)", () => {
  // e2ee.md: "the trusted one must be among them with the same digest — otherwise it is
  // another branch (a fork)"; only a device more than 100 versions behind drops to
  // "freshness not verified". Here the device is 2 behind and the history covers its counter.
  // finding X-BL-1 (W10.D18, open): checkFreshness returns "unproven" instead of throwing a
  // fork when a newer manifest's history covers the anchor's counter but leaves it out; the
  // engine then accepts that branch as the new anchor and stays "verified" (E27). Spec:
  // e2ee.md "Rollback and replay protection", sync-protocol.md §4. it.fails until fixed.
  it.fails("E27 a newer manifest (sealed with the vault's keys) whose history covers the anchor's counter but leaves it out is refused as a fork", async () => {
    const { provider, creator: a } = await newVault();
    await a.engine.rekey();
    a.files.set("n.md", "v1");
    await a.engine.sync();
    a.files.set("n.md", "v2");
    await a.engine.sync();
    const { name, opened } = await manifestOf(a, provider);
    const m = opened!.manifest;
    const hex = (n: number) => n.toString(16).padStart(64, "0");
    const forged = { ...m, counter: m.counter + 2, history: [...m.history.slice(0, -1).filter(([c]) => c < m.counter), [m.counter + 1, hex(1)] as [number, string]] };
    const { sealManifest } = await import("../../sync/e2ee/manifest");
    await forcePut(provider, name, (await sealManifest(a.engine.keys(), forged, name)).bytes);
    const e = await caught(() => a.engine.sync());
    expect(e).toBeInstanceOf(RollbackError);
    expect((e as RollbackError).kind).toBe("fork");
  });
});

describe("blind: unverified devices and key-change holds (W10.D18)", () => {
  it("E18 an unverified device downloads but doesn't upload; its changes wait until it is confirmed", async () => {
    const { provider, creator: a } = await newVault();
    a.files.set("from-a.md", "hello");
    await a.engine.sync();
    const d = await passphraseDevice(provider);
    d.files.set("from-d.md", "waiting");
    const r = await d.engine.sync();
    expect(d.files.text("from-a.md")).toBe("hello");
    expect(r.waiting).toContain("from-d.md");
    expect((await d.engine.freshness()).source).toBe("unverified");
    await a.engine.sync();
    expect(a.files.text("from-d.md")).toBeUndefined();
    await d.engine.confirmFreshness();
    expect((await d.engine.freshness()).verified).toBe(true);
    await d.engine.sync();
    await a.engine.sync();
    expect(a.files.text("from-d.md")).toBe("waiting");
  });

  it("E19 an unverified device can't issue pairing codes", async () => {
    const { provider } = await newVault();
    const d = await passphraseDevice(provider);
    await d.engine.sync();
    expect(await caught(() => d.engine.pairingCode())).toBeInstanceOf(Error);
  });

  it("E20 a one-way pairing code blocks this device's key changes for 2 minutes (PairingPendingError), then not", async () => {
    const { creator: a } = await newVault();
    await a.engine.rekey();
    await a.engine.pairingCode();
    const e = await caught(() => a.engine.rekey());
    expect(e).toBeInstanceOf(PairingPendingError);
    const until = (e as PairingPendingError).until;
    expect(until - a.clock.t).toBeLessThanOrEqual(2 * 60_000 + 60_000);
    expect(until - a.clock.t).toBeGreaterThan(60_000);
    a.clock.t = until + 1;
    await expect(a.engine.rekey()).resolves.toMatchObject({ epoch: 2 });
  });

  it("E21 an answer to a pairing request blocks key changes for 5 minutes; cancelPairing releases it", async () => {
    const { provider, creator: a } = await newVault();
    await a.engine.rekey();
    const joiner = await passphraseDevice(provider);
    await joiner.engine.sync();
    const req = await joiner.engine.pairingRequest();
    await a.engine.answerPairing(req);
    const e = await caught(() => a.engine.rekey());
    expect(e).toBeInstanceOf(PairingPendingError);
    expect((e as PairingPendingError).until - a.clock.t).toBeGreaterThan(4 * 60_000);
    await a.engine.cancelPairing();
    await expect(a.engine.rekey()).resolves.toMatchObject({ epoch: 2 });
  });
});

describe("blind: the freeze and calling it off (W10.D18)", () => {
  /** A re-key from `a` cut off right before its keyring commit: manifest N is frozen, nothing names N+1. */
  async function cutOffRekey(epochFirst: boolean) {
    let blockKeyring = false;
    const inner = memoryProvider({
      fault: (op, name, phase) => {
        if (blockKeyring && op === "put" && name === KEYRING_NAME && phase === "before") throw new Error("tab closed");
      },
    });
    const v = await newVault(inner);
    if (epochFirst) await v.creator.engine.rekey();
    const b = await passphraseDevice(inner, { confirm: true });
    v.creator.files.set("n.md", "before the freeze");
    await v.creator.engine.sync();
    await b.engine.sync();
    blockKeyring = true;
    expect(await caught(() => v.creator.engine.rekey())).toBeInstanceOf(Error);
    blockKeyring = false;
    return { inner, a: v.creator, b };
  }

  it("E22 while a manifest is frozen, other devices pull but their changes wait (rekeyPending)", async () => {
    const { a, b } = await cutOffRekey(true);
    b.files.set("b.md", "waits");
    const r = await b.engine.sync();
    expect(r.rekeyPending).toBe(true);
    await a.engine.sync().catch(() => undefined);
    expect(a.files.text("b.md")).toBeUndefined();
  });

  it("E23 a device's own re-key waits out another device's fresh freeze (KeyChangeInProgressError), on its own clock", async () => {
    const { b } = await cutOffRekey(true);
    await b.engine.sync();
    const e = await caught(() => b.engine.rekey());
    expect(e).toBeInstanceOf(KeyChangeInProgressError);
    const until = (e as KeyChangeInProgressError).until;
    expect(until).toBeGreaterThan(b.clock.t);
    expect(until - b.clock.t).toBeLessThanOrEqual(FREEZE_TTL_MS);
    expect(FREEZE_TTL_MS).toBe(10 * 60_000);
  });

  it("E24 after 10 minutes on its own clock a device calls the re-key off: the keyring lists the frozen digest in `aborted` (rev + 1) and its changes go through", async () => {
    const { inner, a, b } = await cutOffRekey(true);
    const frozen = await manifestOf(a, inner);
    expect(frozen.opened!.manifest.frozen).toBeTruthy();
    b.files.set("b.md", "after the call-off");
    await b.engine.sync();
    const revBefore = b.engine.keys().ring!.rev;
    b.clock.t += FREEZE_TTL_MS + 1000;
    await b.engine.sync();
    await b.engine.sync();
    const kr = decodeKeyring((await getObj(inner, KEYRING_NAME)).data);
    const c = await keyringContents(kr, b.engine.keys());
    expect(c.rev).toBe(revBefore + 1);
    expect(c.aborted ?? []).toContain(frozen.opened!.digest);
    const fresh = await passphraseDevice(inner);
    await fresh.engine.sync();
    expect(fresh.files.text("b.md")).toBe("after the call-off");
    expect(fresh.files.text("n.md")).toBe("before the freeze");
  });

  it("E25 at epoch 0 there is no keyring to rewrite: the waiting device finishes the re-key itself", async () => {
    const { inner, b } = await cutOffRekey(false);
    expect(await inner.get(KEYRING_NAME)).toBeNull();
    await b.engine.sync(); // the wait runs from the first round that sees the freeze
    b.clock.t += FREEZE_TTL_MS + 1000;
    await b.engine.sync();
    await b.engine.sync();
    expect(await inner.get(KEYRING_NAME)).not.toBeNull();
    expect(b.engine.keys().epoch).toBe(1);
    const fresh = await passphraseDevice(inner);
    await fresh.engine.sync();
    expect(fresh.files.text("n.md")).toBe("before the freeze");
  });

  it("E26 a fresh freeze doesn't restart the wait (G1): the call-off still comes 10 minutes after the first one seen", async () => {
    const { inner, a, b } = await cutOffRekey(true);
    await b.engine.sync();
    const t0 = b.clock.t;
    // The re-keyer (or the device being revoked) freezes again 6 minutes later.
    b.clock.t = t0 + 6 * 60_000;
    a.clock.t = t0 + 6 * 60_000;
    let blockKeyring = true;
    const aBlocked = deviceOn(
      {
        id: "memory",
        get: inner.get,
        list: inner.list,
        delete: inner.delete,
        put: async (n, d, c) => {
          if (blockKeyring && n === KEYRING_NAME) throw new Error("tab closed");
          return inner.put(n, d, c);
        },
      },
      a.engine.keys(),
      { store: a.store, files: a.files, clock: a.clock },
    );
    await caught(() => aBlocked.engine.rekey());
    blockKeyring = false;
    await b.engine.sync();
    b.clock.t = t0 + FREEZE_TTL_MS + 1000;
    await b.engine.sync();
    await b.engine.sync();
    const c = await keyringContents(decodeKeyring((await getObj(inner, KEYRING_NAME)).data), b.engine.keys());
    expect((c.aborted ?? []).length).toBeGreaterThanOrEqual(1);
  });
});
