/**
 * W10.D12 acceptance: Wycheproof's chacha20_poly1305_test.json passes on the
 * primitives the app uses (through the one door, src/sync/e2ee/primitives).
 *
 * The vectors are C2SP/wycheproof testvectors_v1/chacha20_poly1305_test.json
 * at commit 65ca494727a52944c204441c860b039e6786b99b, copied unchanged
 * (Apache-2.0; fixtures/wycheproof/README.md). The file's sha256 is checked
 * first, so a changed copy fails here instead of passing quietly.
 *
 * - 96-bit nonce groups (316 cases): every "valid" case seals to exactly
 *   ct ‖ tag and opens back to msg; every "invalid" one is refused by open.
 * - Other nonce sizes (9 cases, all "invalid"): RFC 8439 takes a 96-bit
 *   nonce only, so seal and open must refuse them (throw or null), never
 *   return a plaintext.
 *
 * XChaCha20-Poly1305 is not here: nothing under src/sync uses XChaCha (grep);
 * the audited library's XChaCha is the Mac's differential (W10.D13).
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { chachaOpen, chachaSeal, primitives } from "../sync/e2ee/primitives";

const FILE = "src/__tests__/fixtures/wycheproof/chacha20_poly1305_test.json";
const SHA256 = "fe61d25f90e1bde4461d00eafe61049e5f29bd999f36b766df9cda90906ad53d";
const raw = readFileSync(FILE);

interface Case { tcId: number; key: string; iv: string; aad: string; msg: string; ct: string; tag: string; result: "valid" | "invalid" | "acceptable"; comment: string }
interface Group { ivSize: number; keySize: number; tagSize: number; tests: Case[] }
const doc = JSON.parse(raw.toString("utf8")) as { algorithm: string; numberOfTests: number; testGroups: Group[] };

const hex = (s: string) => Uint8Array.from(Buffer.from(s, "hex"));
const toHex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const all = doc.testGroups.flatMap((g) => g.tests.map((t) => ({ g, t })));
const std = all.filter(({ g }) => g.ivSize === 96 && g.keySize === 256 && g.tagSize === 128);
const odd = all.filter(({ g }) => g.ivSize !== 96);

function refused(f: () => Uint8Array | null): boolean {
  try {
    return f() === null;
  } catch {
    return true;
  }
}

describe("Wycheproof ChaCha20-Poly1305 (W10.D12)", () => {
  it("is the pinned, unchanged vector file", () => {
    expect(createHash("sha256").update(raw).digest("hex")).toBe(SHA256);
    expect(doc.algorithm).toBe("CHACHA20-POLY1305");
    expect(all).toHaveLength(doc.numberOfTests);
    expect(std.length + odd.length).toBe(doc.numberOfTests);
    expect(primitives().name).toBe("in-house");
  });

  it("every valid 96-bit-nonce case seals to ct ‖ tag and opens back", () => {
    const bad: number[] = [];
    let n = 0;
    for (const { t } of std.filter(({ t }) => t.result === "valid")) {
      n++;
      const sealed = chachaSeal(hex(t.key), hex(t.iv), hex(t.msg), hex(t.aad));
      const opened = chachaOpen(hex(t.key), hex(t.iv), hex(t.ct + t.tag), hex(t.aad));
      if (toHex(sealed) !== t.ct + t.tag || opened === null || toHex(opened) !== t.msg) bad.push(t.tcId);
    }
    expect(n).toBe(256);
    expect(bad).toEqual([]);
  });

  it("every invalid 96-bit-nonce case is refused by open", () => {
    const opened: number[] = [];
    let n = 0;
    for (const { t } of std.filter(({ t }) => t.result !== "valid")) {
      n++;
      if (!refused(() => chachaOpen(hex(t.key), hex(t.iv), hex(t.ct + t.tag), hex(t.aad)))) opened.push(t.tcId);
    }
    expect(n).toBe(60);
    expect(opened).toEqual([]);
  });

  it("a nonce that is not 96 bits is refused by open (and by seal)", () => {
    const accepted: string[] = [];
    for (const { g, t } of odd) {
      expect(t.result).toBe("invalid");
      if (!refused(() => chachaOpen(hex(t.key), hex(t.iv), hex(t.ct + t.tag), hex(t.aad)))) accepted.push(`open #${t.tcId} (${g.ivSize}-bit)`);
      if (!refused(() => chachaSeal(hex(t.key), hex(t.iv), hex(t.msg), hex(t.aad)))) accepted.push(`seal #${t.tcId} (${g.ivSize}-bit)`);
    }
    expect(odd).toHaveLength(9);
    expect(accepted).toEqual([]);
  });
});
