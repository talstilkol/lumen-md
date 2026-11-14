/**
 * Blind tests (plan W6.15, W10.D18): the encrypted vault's header.
 *
 * Written from the spec only: docs/sync-protocol.md §2 (header and passphrase),
 * docs/src/content/docs/sync/e2ee.md ("Header", "Keys") and the declarations
 * tsc emits for src/sync/e2ee/header.ts and kdf.ts (signatures and their doc
 * comments, no function bodies). The MAC is recomputed here from the spec's
 * formula with WebCrypto, so these tests check the implementation against the
 * spec, not against itself. Lane X-BL, against verify/train-5 (c3f055218e).
 *
 * Properties: the header MAC binds format, protocol, vaultId and the KDF
 * parameters; a wrong passphrase or an edited header is refused before
 * anything is decrypted; the KDF floors (PBKDF2 ≥ 600,000; Argon2id ≥ 7 MiB
 * and memory × passes ≥ 37 MiB) hold on open; unknown algorithms and newer
 * protocols are refused; the passphrase is NFC-normalised.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createHeader,
  decodeHeader,
  encodeHeader,
  headerMacValid,
  HEADER_NAME,
  PROTOCOL_VERSION,
  rekeyHeader,
  unlockHeader,
  UnsupportedProtocolError,
  WrongPassphraseError,
  type VaultHeader,
} from "../../sync/e2ee/header";
import { deriveMasterKey, PBKDF2_MIN_ITERATIONS, WeakKdfError } from "../../sync/e2ee/kdf";
import { createVault, unlockVault, memoryProvider } from "../../sync/e2ee";
import { b64u, dec, enc, hkdf, hmacRaw, ITER, PASS, POLICY } from "./_e2eeHarness";

const vectors = JSON.parse(readFileSync("docs/sync-protocol-vectors.json", "utf8")) as {
  vaults: Array<{ name: string; passphrase: string; objects: Record<string, string> }>;
};
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** §2: mac = b64u(HMAC(HKDF(master, vaultId, "lumen-e2ee/1/header"), JSON.stringify([format, protocol, vaultId, kdf]))). */
async function specMac(h: VaultHeader, passphrase: string): Promise<string> {
  const master = await deriveMasterKey(passphrase.normalize("NFC"), h.kdf);
  const key = await hkdf(master, h.vaultId, "lumen-e2ee/1/header");
  return b64u(await hmacRaw(key, enc.encode(JSON.stringify([h.format, h.protocol, h.vaultId, h.kdf]))));
}

/** The header as JSON, edited by `f`, re-encoded: what a provider that edits the header serves. */
function edited(h: VaultHeader, f: (j: Record<string, unknown>) => void): Uint8Array {
  const j = JSON.parse(dec.decode(encodeHeader(h))) as Record<string, unknown>;
  f(j);
  return enc.encode(JSON.stringify(j));
}

describe("blind: e2ee header (W10.D18)", () => {
  it("H1 the header is stored under the fixed name, in the clear, with the documented fields", async () => {
    const p = memoryProvider();
    const { header } = await createVault(p, PASS, { pbkdf2Iterations: ITER });
    expect(HEADER_NAME).toBe("lumen-e2ee-vault");
    const obj = await p.get(HEADER_NAME);
    expect(obj).not.toBeNull();
    const j = JSON.parse(dec.decode(obj!.data)) as Record<string, unknown>;
    expect(j.format).toBe("lumen-e2ee");
    expect(j.protocol).toBe(PROTOCOL_VERSION);
    expect(PROTOCOL_VERSION).toBe(1);
    // vaultId: b64u of 16 random bytes = 22 characters.
    expect(j.vaultId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(j.vaultId).toBe(header.vaultId);
    expect(typeof j.mac).toBe("string");
    expect((j.kdf as { alg: string }).alg).toBe("pbkdf2-sha256");
    // Nothing about the notes: only the five documented fields.
    expect(Object.keys(j).sort()).toEqual(["format", "kdf", "mac", "protocol", "vaultId"]);
  });

  it("H2 the MAC is exactly the spec's formula (recomputed independently)", async () => {
    const { header } = await createHeader(PASS, { pbkdf2Iterations: ITER });
    expect(header.mac).toBe(await specMac(header, PASS));
  });

  // §8 says vault 1 is "epoch 0 with PBKDF2" (its header has 1,000 iterations, so it opens
  // only under a lowered policy) and vault 2 is "Argon2id with production parameters".
  it("H3 the spec's test vector headers (vault 1 PBKDF2, vault 2 production Argon2id) verify with the spec's formula and unlock", async () => {
    const v1 = vectors.vaults[0];
    const h1 = decodeHeader(b64(v1.objects[HEADER_NAME]), { minPbkdf2Iterations: 1000 });
    expect(h1.kdf.alg).toBe("pbkdf2-sha256");
    expect(h1.mac).toBe(await specMac(h1, v1.passphrase));
    expect((await unlockHeader(h1, v1.passphrase)).vaultId).toBe(h1.vaultId);
    // A 1,000-iteration header is below the production floor.
    expect(() => decodeHeader(b64(v1.objects[HEADER_NAME]))).toThrow(WeakKdfError);
    const v2 = vectors.vaults[1];
    const h2 = decodeHeader(b64(v2.objects[HEADER_NAME])); // default policy
    expect(h2.kdf).toMatchObject({ alg: "argon2id", memoryKiB: 47104, iterations: 1, parallelism: 1 });
    expect(h2.mac).toBe(await specMac(h2, v2.passphrase));
  }, 300_000);

  it("H4 a wrong passphrase is refused with WrongPassphraseError", async () => {
    const p = memoryProvider();
    await createVault(p, PASS, { pbkdf2Iterations: ITER });
    await expect(unlockVault(p, PASS + "x", POLICY)).rejects.toBeInstanceOf(WrongPassphraseError);
    const { header } = await createHeader(PASS, { pbkdf2Iterations: ITER });
    await expect(unlockHeader(header, "another passphrase")).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it("H5 a provider that edits the KDF parameters, the vault id or the salt makes the MAC fail", async () => {
    const { header } = await createHeader(PASS, { pbkdf2Iterations: ITER });
    const edits: Array<(j: Record<string, unknown>) => void> = [
      (j) => ((j.kdf as Record<string, unknown>).iterations = ITER + 1),
      (j) => ((j.kdf as Record<string, unknown>).salt = b64u(new Uint8Array(16).fill(7))),
      (j) => (j.vaultId = b64u(new Uint8Array(16).fill(9))),
      (j) => (j.mac = b64u(new Uint8Array(32))),
    ];
    for (const f of edits) {
      const h = decodeHeader(edited(header, f), { minPbkdf2Iterations: 1 });
      await expect(unlockHeader(h, PASS)).rejects.toBeInstanceOf(WrongPassphraseError);
    }
  });

  it("H6 the stored header is refused through unlockVault once the provider lowers the iterations", async () => {
    const p = memoryProvider();
    const { header } = await createVault(p, PASS, { pbkdf2Iterations: ITER });
    await p.put(HEADER_NAME, edited(header, (j) => ((j.kdf as Record<string, unknown>).iterations = ITER - 1)));
    const e = await unlockVault(p, PASS, { minPbkdf2Iterations: 1 }).then(
      () => null,
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(Error);
  });

  it("H7 fewer than 600,000 PBKDF2 iterations are refused on open (default policy), 600,000 is accepted", async () => {
    expect(PBKDF2_MIN_ITERATIONS).toBe(600_000);
    const { header } = await createHeader(PASS, { pbkdf2Iterations: ITER });
    const at = (n: number) => edited(header, (j) => ((j.kdf as Record<string, unknown>).iterations = n));
    expect(() => decodeHeader(at(599_999))).toThrow(WeakKdfError);
    expect(() => decodeHeader(at(1000))).toThrow(WeakKdfError);
    expect(decodeHeader(at(600_000)).kdf).toMatchObject({ alg: "pbkdf2-sha256", iterations: 600_000 });
  });

  it("H8 Argon2id floors: memory below 7 MiB, or memory × passes below 37 MiB, is refused", async () => {
    const { header } = await createHeader(PASS, { pbkdf2Iterations: ITER });
    const argon = (memoryKiB: number, iterations: number) =>
      edited(header, (j) => (j.kdf = { alg: "argon2id", memoryKiB, iterations, parallelism: 1, salt: b64u(new Uint8Array(16).fill(1)) }));
    expect(() => decodeHeader(argon(7167, 10))).toThrow(); // < 7 MiB
    expect(() => decodeHeader(argon(9216, 4))).toThrow(); // 36 MiB total < 37 MiB
    expect(() => decodeHeader(argon(8192, 4))).toThrow(); // 32 MiB total
    // At or above both floors is accepted. (kdf.ts's doc comment lists OWASP's 12 MiB × 3,
    // 9 MiB × 4 and 7 MiB × 5 as options, but those are 36, 36 and 35 MiB, below the
    // spec's normative 37 MiB floor (§2); this test follows §2. Reported as a docs finding.)
    for (const [m, t] of [
      [47104, 1],
      [19456, 2],
      [12800, 3],
      [9216, 5],
      [7168, 6],
    ] as const) {
      expect(decodeHeader(argon(m, t)).kdf).toMatchObject({ alg: "argon2id", memoryKiB: m, iterations: t });
    }
  });

  it("H9 an algorithm the client does not know is refused instead of guessed", async () => {
    const { header } = await createHeader(PASS, { pbkdf2Iterations: ITER });
    const bytes = edited(header, (j) => (j.kdf = { alg: "scrypt", N: 1 << 15, r: 8, p: 1, salt: "AAAAAAAAAAAAAAAAAAAAAA" }));
    expect(() => decodeHeader(bytes)).toThrow();
  });

  it("H10 a newer protocol is refused with UnsupportedProtocolError; a foreign format is refused", async () => {
    const { header } = await createHeader(PASS, { pbkdf2Iterations: ITER });
    expect(() => decodeHeader(edited(header, (j) => (j.protocol = 2)), POLICY)).toThrow(UnsupportedProtocolError);
    expect(() => decodeHeader(edited(header, (j) => (j.format = "other")), POLICY)).toThrow();
    expect(() => decodeHeader(enc.encode("not json"), POLICY)).toThrow();
    expect(() => decodeHeader(edited(header, (j) => delete j.mac), POLICY)).toThrow();
  });

  it("H11 the passphrase is NFC-normalised: the decomposed spelling opens a vault made with the composed one", async () => {
    const composed = "café שָׁלוֹם 2026 passphrase";
    const decomposed = composed.normalize("NFD");
    expect(decomposed).not.toBe(composed);
    const p = memoryProvider();
    await createVault(p, composed, { pbkdf2Iterations: ITER });
    const { keys } = await unlockVault(p, decomposed, POLICY);
    expect(keys.vaultId).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("H12 encode → decode round-trips, and the decoded header still verifies", async () => {
    const { header } = await createHeader(PASS, { pbkdf2Iterations: ITER });
    const back = decodeHeader(encodeHeader(header), POLICY);
    expect(back).toEqual(header);
    const keys = await unlockHeader(back, PASS);
    expect(await headerMacValid(back, keys.header)).toBe(true);
  });

  it("H13 headerMacValid is false for a header whose KDF a provider edited (F5)", async () => {
    const { header, keys } = await createHeader(PASS, { pbkdf2Iterations: ITER });
    const changed = decodeHeader(edited(header, (j) => ((j.kdf as Record<string, unknown>).iterations = ITER * 2)), POLICY);
    expect(await headerMacValid(changed, keys.header)).toBe(false);
  });

  it("H14 a passphrase change keeps the vault id and gets a fresh salt; the old passphrase does not open the new header", async () => {
    const { header } = await createHeader(PASS, { pbkdf2Iterations: ITER });
    const { header: next } = await rekeyHeader(header.vaultId, "a brand new passphrase", { pbkdf2Iterations: ITER });
    expect(next.vaultId).toBe(header.vaultId);
    expect(next.kdf.salt).not.toBe(header.kdf.salt);
    expect(next.mac).toBe(await specMac(next, "a brand new passphrase"));
    await expect(unlockHeader(next, PASS)).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it("H15 two new vaults never share a vault id or a salt", async () => {
    const a = await createHeader(PASS, { pbkdf2Iterations: ITER });
    const b = await createHeader(PASS, { pbkdf2Iterations: ITER });
    expect(a.header.vaultId).not.toBe(b.header.vaultId);
    expect(a.header.kdf.salt).not.toBe(b.header.kdf.salt);
    // salt: b64u of at least 16 bytes.
    expect(a.header.kdf.salt.length).toBeGreaterThanOrEqual(22);
  });
});
