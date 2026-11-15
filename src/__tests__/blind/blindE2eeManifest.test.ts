/**
 * Blind tests (plan W6.15, W10.D18): the encrypted vault's manifest and its
 * rollback guard.
 *
 * Written from the spec only: docs/sync-protocol.md §1, §3, §4, the
 * "Rollback and replay protection" section of docs/src/content/docs/sync/e2ee.md
 * and the declarations tsc emits for src/sync/e2ee/manifest.ts, keys.ts and
 * engineTypes.ts (signatures and doc comments, no function bodies). Object
 * names and the sealed layout are recomputed here from the spec with WebCrypto.
 * Lane X-BL, against verify/train-5 (c3f055218e).
 *
 * Properties: a lower counter is a rollback, an equal counter with another
 * digest is a fork, a higher counter must list the anchor in its history (else
 * a fork), and an anchor older than the history reaches is "unproven", never
 * "ok". The manifest is bound to its vault and its object name; any changed
 * byte is refused; names are 43 characters and never reveal a path.
 */
import { describe, expect, it } from "vitest";
import {
  blobName,
  checkFreshness,
  emptyManifest,
  FROZEN_PROTOCOL,
  HISTORY_LENGTH,
  isManifestLabel,
  manifestName,
  manifestNameFor,
  openManifest,
  pathRecord,
  RollbackError,
  sealManifest,
  type Manifest,
} from "../../sync/e2ee/manifest";
import { DecryptError, seal } from "../../sync/e2ee/keys";
import { successor } from "../../sync/e2ee/engineTypes";
import { deriveMasterKey } from "../../sync/e2ee/kdf";
import { createHeader } from "../../sync/e2ee/header";
import { b64u, contains, enc, hkdf, hmacRaw, ITER, PASS } from "./_e2eeHarness";

async function vault(pass = PASS) {
  const { header, keys } = await createHeader(pass, { pbkdf2Iterations: ITER });
  const master = await deriveMasterKey(pass.normalize("NFC"), header.kdf);
  // §3: names key = HKDF(S0, vaultId, "lumen-e2ee/1/names"), S0 = master.
  const names = await hkdf(master, header.vaultId, "lumen-e2ee/1/names");
  return { header, keys, names };
}

function manifestWith(vaultId: string, counter: number, files: Manifest["files"] = {}): Manifest {
  return { ...emptyManifest(vaultId), counter, files };
}

const D = (n: number) => n.toString(16).padStart(64, "0");

describe("blind: checkFreshness — the rollback guard (W10.D18)", () => {
  it("M1 a lower counter is a rollback ('older')", () => {
    let e: unknown = null;
    try {
      checkFreshness({ counter: 10, digest: D(10) }, { counter: 9, digest: D(9) }, []);
    } catch (x) {
      e = x;
    }
    expect(e).toBeInstanceOf(RollbackError);
    expect((e as RollbackError).kind).toBe("older");
    expect((e as RollbackError).seen).toBe(10);
    expect((e as RollbackError).got).toBe(9);
  });

  it("M2 the same counter with another digest is a fork", () => {
    let e: unknown = null;
    try {
      checkFreshness({ counter: 10, digest: D(10) }, { counter: 10, digest: D(11) }, [[9, D(9)]]);
    } catch (x) {
      e = x;
    }
    expect(e).toBeInstanceOf(RollbackError);
    expect((e as RollbackError).kind).toBe("fork");
  });

  it("M3 the anchored manifest itself is ok", () => {
    expect(checkFreshness({ counter: 10, digest: D(10) }, { counter: 10, digest: D(10) }, [[9, D(9)]])).toBe("ok");
  });

  it("M4 a newer manifest that lists the anchor in its history is ok", () => {
    const history: Array<[number, string]> = [
      [8, D(8)],
      [9, D(9)],
      [10, D(10)],
      [11, D(11)],
    ];
    expect(checkFreshness({ counter: 10, digest: D(10) }, { counter: 12, digest: D(12) }, history)).toBe("ok");
  });

  it("M5 a newer manifest whose history has the anchor's counter with another digest is a fork", () => {
    const history: Array<[number, string]> = [
      [9, D(9)],
      [10, D(99)],
      [11, D(11)],
    ];
    expect(() => checkFreshness({ counter: 10, digest: D(10) }, { counter: 12, digest: D(12) }, history)).toThrow(RollbackError);
    try {
      checkFreshness({ counter: 10, digest: D(10) }, { counter: 12, digest: D(12) }, history);
    } catch (e) {
      expect((e as RollbackError).kind).toBe("fork");
    }
  });

  // finding X-BL-1 (W10.D18, fixed on w10/blind-defect-fixes): checkFreshness returned
  // "unproven" instead of throwing a fork when a newer manifest's history covers the anchor's
  // counter but leaves it out (E27 is the engine side). Spec: e2ee.md "Rollback and replay
  // protection", sync-protocol.md §4.
  it("M6 a newer manifest whose history covers the anchor's counter but leaves it out is a fork", () => {
    const history: Array<[number, string]> = [
      [9, D(9)],
      [11, D(11)],
    ];
    expect(() => checkFreshness({ counter: 10, digest: D(10) }, { counter: 12, digest: D(12) }, history)).toThrow(RollbackError);
  });

  it("M7 an anchor older than the history reaches is 'unproven' (never 'ok'); so is no history", () => {
    const history: Array<[number, string]> = [];
    for (let c = 200; c < 300; c++) history.push([c, D(c)]);
    expect(checkFreshness({ counter: 10, digest: D(10) }, { counter: 300, digest: D(300) }, history)).toBe("unproven");
    expect(checkFreshness({ counter: 10, digest: D(10) }, { counter: 12, digest: D(12) })).toBe("unproven");
  });

  it("M8 the immediate successor (history ends with the anchor) is ok", () => {
    expect(checkFreshness({ counter: 1, digest: D(1) }, { counter: 2, digest: D(2) }, [[1, D(1)]])).toBe("ok");
  });
});

describe("blind: manifest sealing, names and validation (W10.D18)", () => {
  it("M9 seal → open round-trips and reports the same digest", async () => {
    const { header, keys } = await vault();
    const m = manifestWith(header.vaultId, 3, pathRecord({ "a.md": { ver: 1, rev: "r1", hash: D(1), size: 5, by: "dev" } }));
    const s = await sealManifest(keys, m);
    const o = await openManifest(keys, s.bytes);
    expect(o.manifest.counter).toBe(3);
    expect(o.manifest.files["a.md"].rev).toBe("r1");
    expect(o.digest).toBe(s.digest);
    expect(s.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("M10 sealed layout: 0x01 ‖ 12-byte nonce ‖ AES-GCM(padded) with a 16-byte tag; padded is a multiple of 256, and above 4 KiB of 1/16 of the next power of two", async () => {
    const { header, keys } = await vault();
    for (const n of [0, 3, 40, 200]) {
      const files = pathRecord<Manifest["files"][string]>();
      for (let i = 0; i < n; i++) files[`notes/n${i}.md`] = { ver: 1, rev: `r${i}xxxxxxxxxxxxxxxxxxx`, hash: D(i), size: i, by: "dev" };
      const s = await sealManifest(keys, manifestWith(header.vaultId, 1, files));
      expect(s.bytes[0]).toBe(0x01);
      const padded = s.bytes.length - 1 - 12 - 16;
      expect(padded % 256).toBe(0);
      if (padded > 4096) {
        let pow = 1;
        while (pow < padded) pow *= 2;
        expect(padded % (pow / 16)).toBe(0);
      }
    }
  });

  it("M11 two seals of the same manifest differ (fresh nonce) and both open", async () => {
    const { header, keys } = await vault();
    const m = manifestWith(header.vaultId, 1);
    const a = await sealManifest(keys, m);
    const b = await sealManifest(keys, m);
    expect(b64u(a.bytes.slice(1, 13))).not.toBe(b64u(b.bytes.slice(1, 13)));
    await expect(openManifest(keys, a.bytes)).resolves.toBeTruthy();
    await expect(openManifest(keys, b.bytes)).resolves.toBeTruthy();
  });

  it("M12 any changed byte is refused with DecryptError (version, nonce, ciphertext, tag)", async () => {
    const { header, keys } = await vault();
    const s = await sealManifest(keys, manifestWith(header.vaultId, 7));
    for (const i of [0, 1, 12, 13, Math.floor(s.bytes.length / 2), s.bytes.length - 1]) {
      const t = new Uint8Array(s.bytes);
      t[i] ^= 0x01;
      await expect(openManifest(keys, t)).rejects.toBeInstanceOf(DecryptError);
    }
    await expect(openManifest(keys, s.bytes.slice(0, s.bytes.length - 1))).rejects.toBeInstanceOf(DecryptError);
  });

  it("M13 the object name is bound in: a manifest opened under another name is refused", async () => {
    const { header, keys } = await vault();
    const label = "manifest/1/" + b64u(new Uint8Array(16).fill(5));
    const other = await manifestNameFor(keys, label);
    const s = await sealManifest(keys, manifestWith(header.vaultId, 2));
    await expect(openManifest(keys, s.bytes, other)).rejects.toBeInstanceOf(DecryptError);
    const s2 = await sealManifest(keys, manifestWith(header.vaultId, 2), other);
    await expect(openManifest(keys, s2.bytes, other)).resolves.toBeTruthy();
    await expect(openManifest(keys, s2.bytes)).rejects.toBeInstanceOf(DecryptError);
  });

  it("M14 another vault's keys cannot open it; a manifest naming another vault id is refused", async () => {
    const a = await vault();
    const b = await vault();
    const s = await sealManifest(a.keys, manifestWith(a.header.vaultId, 2));
    await expect(openManifest(b.keys, s.bytes)).rejects.toThrow();
    const foreign = await sealManifest(a.keys, manifestWith(b.header.vaultId, 2));
    await expect(openManifest(a.keys, foreign.bytes)).rejects.toThrow();
  });

  it("M15 a blob sealed under the manifest key is not a manifest (the kind is in the additional data)", async () => {
    const { header, keys } = await vault();
    const name = await manifestName(keys);
    const json = enc.encode(JSON.stringify(manifestWith(header.vaultId, 2)));
    const padded = new Uint8Array(256);
    new DataView(padded.buffer).setUint32(0, json.length);
    padded.set(json, 4);
    const asBlob = await seal(keys.manifest, header.vaultId, "blob", name, padded);
    await expect(openManifest(keys, asBlob)).rejects.toBeInstanceOf(DecryptError);
  });

  it("M16 protocol: 1 and 2 only; protocol 2 has `frozen` and only protocol 2 has it", async () => {
    const { header, keys } = await vault();
    expect(FROZEN_PROTOCOL).toBe(2);
    const frozen: Manifest = { ...manifestWith(header.vaultId, 4), protocol: 2, frozen: { epoch: 1, at: 1, by: "dev" } };
    await expect(openManifest(keys, (await sealManifest(keys, frozen)).bytes)).resolves.toBeTruthy();
    const p3: Manifest = { ...manifestWith(header.vaultId, 4), protocol: 3 };
    await expect(openManifest(keys, (await sealManifest(keys, p3)).bytes)).rejects.toThrow();
    const p2NoFreeze: Manifest = { ...manifestWith(header.vaultId, 4), protocol: 2 };
    await expect(openManifest(keys, (await sealManifest(keys, p2NoFreeze)).bytes)).rejects.toThrow();
    const p1Frozen: Manifest = { ...manifestWith(header.vaultId, 4), protocol: 1, frozen: { epoch: 1, at: 1, by: "dev" } };
    await expect(openManifest(keys, (await sealManifest(keys, p1Frozen)).bytes)).rejects.toThrow();
  });

  it("M17 epoch-0 manifest name is b64u(HMAC(names, \"manifest\")), 43 characters (recomputed)", async () => {
    const { keys, names } = await vault();
    const expected = b64u(await hmacRaw(names, enc.encode("manifest")));
    expect(expected).toHaveLength(43);
    expect(await manifestName(keys)).toBe(expected);
    expect(await manifestNameFor(keys, "manifest")).toBe(expected);
  });

  it("M18 blob name is b64u(HMAC(names, \"blob\\0\" + path + \"\\0\" + rev)) (recomputed); never the path", async () => {
    const { keys, names } = await vault();
    const path = "notes/סוד/meeting with source.md";
    const n1 = await blobName(keys, path, "rev1");
    expect(n1).toBe(b64u(await hmacRaw(names, enc.encode("blob\0" + path + "\0" + "rev1"))));
    expect(n1).toHaveLength(43);
    expect(n1).not.toContain("notes");
    expect(await blobName(keys, path, "rev2")).not.toBe(n1);
    expect(await blobName(keys, path + "x", "rev1")).not.toBe(n1);
    expect(await blobName(keys, path, "rev1")).toBe(n1);
  });

  it("M19 manifest labels: \"manifest\" or \"manifest/<epoch>/<b64u 16 bytes>\"", () => {
    const r = b64u(new Uint8Array(16).fill(3));
    expect(isManifestLabel("manifest")).toBe(true);
    expect(isManifestLabel(`manifest/1/${r}`)).toBe(true);
    expect(isManifestLabel(`manifest/12/${r}`)).toBe(true);
    for (const bad of ["", "manifest/", "manifest/1/short", `manifest/x/${r}`, `../manifest/1/${r}`, `manifest/1/${r}/x`, 7, null]) {
      expect(isManifestLabel(bad)).toBe(false);
    }
  });

  it("M20 pathRecord: a note called __proto__ or constructor is an own key", () => {
    const r = pathRecord<number>();
    r["__proto__"] = 1;
    r["constructor"] = 2;
    expect(Object.keys(r).sort()).toEqual(["__proto__", "constructor"]);
    expect(Object.getPrototypeOf(r)).toBeNull();
    const from = pathRecord<number>(JSON.parse('{"__proto__": 5, "a": 1}'));
    expect(Object.prototype.hasOwnProperty.call(from, "__proto__")).toBe(true);
  });

  it("M21 the successor has counter + 1, lists its predecessor last, keeps at most HISTORY_LENGTH entries and is not frozen", () => {
    expect(HISTORY_LENGTH).toBe(100);
    let m: Manifest = { ...manifestWith("v", 1), protocol: 2, frozen: { epoch: 1, at: 0, by: "x" } };
    for (let i = 0; i < 130; i++) m = successor(m, D(m.counter));
    expect(m.counter).toBe(131);
    expect(m.history).toHaveLength(100);
    expect(m.history[m.history.length - 1]).toEqual([130, D(130)]);
    expect(m.history[0]).toEqual([31, D(31)]);
    expect(m.frozen).toBeUndefined();
  });

  it("M22 the provider sees no path and no counter in a sealed manifest", async () => {
    const { header, keys } = await vault();
    const files = pathRecord({ "secret/witness-name.md": { ver: 1, rev: "rr", hash: D(1), size: 1, by: "dev-xyz" } });
    const s = await sealManifest(keys, manifestWith(header.vaultId, 4242, files));
    expect(contains(s.bytes, "witness-name")).toBe(false);
    expect(contains(s.bytes, "4242")).toBe(false);
    expect(contains(s.bytes, "dev-xyz")).toBe(false);
  });
});
