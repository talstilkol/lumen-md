/**
 * Plan W11.S9 (research R3.9): the recovery key as 24 BIP-39 words, a
 * printable PDF kit that never reaches the vault or the network, three
 * words typed back before the key is committed, and a restore from the
 * words alone in a clean profile.
 *
 * The BIP-39 vectors below are the public ones from trezor/python-mnemonic
 * (vectors.json, commit b57a5ad7, MIT): the 256-bit English entries.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { BIP39_WORDS, bip39Word, parseRecoveryWords, RECOVERY_WORDS, toRecoveryWords, verifyPositions } from "../sync/e2ee/bip39";
import { recoveryKitPdf } from "../sync/e2ee/recoveryKit";
import { memoryProvider } from "../sync/e2ee/provider";
import { E2eeSync, setUpRecovery, unlockWithRecoveryKey } from "../sync/e2ee/engine";
import { memoryFiles } from "../sync/e2ee/localFiles";
import { memoryStateStore } from "../sync/e2ee/state";
import { newVault, snapshot } from "./helpers/e2ee";

const TREZOR_256: Array<[string, string]> = [
  ["0000000000000000000000000000000000000000000000000000000000000000", "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art"],
  ["7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f", "legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title"],
  ["8080808080808080808080808080808080808080808080808080808080808080", "letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic bless"],
  ["ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo vote"],
  ["68a79eaca2324873eacc50cb9c6eca8cc68ea5d936f98787c60c7ebc74e6ce7c", "hamster diagram private dutch cause delay private meat slide toddler razor book happy fancy gospel tennis maple dilemma loan word shrug inflict delay length"],
  ["9f6a2878b2520799a44ef18bc7df394e7061a224d2c33cd015b157d746869863", "panda eyebrow bullet gorilla call smoke muffin taste mesh discover soft ostrich alcohol speed nation flash devote level hobby quick inner drive ghost inside"],
  ["066dca1a2bb7e8a1db2832148ce9933eea0f3ac9548d793112d9a95c9407efad", "all hour make first leader extend hole alien behind guard gospel lava path output census museum junior mass reopen famous sing advance salt reform"],
  ["f585c11aec520db57dd353c69554b21a89b20fb0650966fa0a9d6f74fd989d8f", "void come effort suffer camp survey warrior heavy shoot primary clutch crush open amazing screen patrol group space point ten exist slush involve unfold"],
];
const hex = (h: string) => new Uint8Array(Buffer.from(h, "hex"));

describe("BIP-39 (the English list, 24 words for 256 bits)", () => {
  it("the list is BIP-39's: 2048 words, sorted, unique in their first four letters", async () => {
    expect(BIP39_WORDS).toHaveLength(2048);
    expect([...BIP39_WORDS].sort()).toEqual(BIP39_WORDS);
    expect(new Set(BIP39_WORDS.map((w) => w.slice(0, 4))).size).toBe(2048);
    const digest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(BIP39_WORDS.join("\n") + "\n"))).toString("hex");
    // sha256 of bitcoin/bips bip-0039/english.txt
    expect(digest).toBe("2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda");
  });

  it("matches the public Trezor vectors both ways", async () => {
    for (const [entropy, mnemonic] of TREZOR_256) {
      expect((await toRecoveryWords(hex(entropy))).join(" ")).toBe(mnemonic);
      const back = await parseRecoveryWords(mnemonic);
      expect(back.ok && Buffer.from(back.key).toString("hex")).toBe(entropy);
    }
  });

  it("typing is forgiving: case, numbering, commas, line breaks, four-letter prefixes", async () => {
    const [entropy, mnemonic] = TREZOR_256[4];
    const words = mnemonic.split(" ");
    const sloppy = words.map((w, i) => `${i + 1}) ${i % 2 ? w.slice(0, 4).toUpperCase() : w}`).join(", ");
    for (const input of [sloppy, words.join("\n")]) {
      const r = await parseRecoveryWords(input);
      expect(r.ok && Buffer.from(r.key).toString("hex")).toBe(entropy);
    }
    expect(bip39Word("Zoo")).toBe("zoo");
    expect(bip39Word("abando")).toBe("abandon");
    expect(bip39Word("abandons")).toBeNull();
    expect(bip39Word("ab")).toBeNull();
  });

  it("says what is wrong: the count, which word is unknown, or a checksum that doesn't add up", async () => {
    const words = TREZOR_256[5][1].split(" ");
    expect(await parseRecoveryWords(words.slice(0, 23).join(" "))).toEqual({ ok: false, reason: "count" });
    expect(await parseRecoveryWords([...words.slice(0, 7), "שלום", ...words.slice(8)].join(" "))).toEqual({ ok: false, reason: "unknown", at: 7 });
    const swapped = [...words];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    expect(await parseRecoveryWords(swapped.join(" "))).toEqual({ ok: false, reason: "check" });
  });

  it("asks for three different positions out of 24", () => {
    for (let i = 0; i < 200; i++) {
      const p = verifyPositions();
      expect(new Set(p).size).toBe(3);
      expect(p.every((n) => n >= 1 && n <= RECOVERY_WORDS)).toBe(true);
    }
    let x = 0;
    expect(verifyPositions(() => [0.99, 0.99, 0, 0.5][x++ % 4])).toEqual([1, 13, 24]);
  });
});

describe("the printable kit", () => {
  it("is a valid one-page PDF that a real reader (pdf.js) opens, with all 24 words in order", async () => {
    const words = TREZOR_256[6][1].split(" ");
    const pdf = recoveryKitPdf({ words, vaultId: "v-123", created: "2026-11-15" });
    expect(new TextDecoder().decode(pdf.subarray(0, 8))).toBe("%PDF-1.4");
    const doc = await getDocument({ data: pdf.slice(), useSystemFonts: false }).promise;
    expect(doc.numPages).toBe(1);
    const text = (await (await doc.getPage(1)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ");
    expect(text).toContain("Lumen recovery kit");
    expect(text).toContain("v-123");
    const found = words.map((w) => text.indexOf(` ${w}`));
    expect(found.every((i) => i >= 0)).toBe(true);
    expect(() => recoveryKitPdf({ words: words.slice(1), vaultId: "v", created: "x" })).toThrow(/24 words/);
  });
});

describe("restoring from the words alone (clean profile)", () => {
  it("10 of 10: a vault set up with a recovery key opens from its 24 words, every note back", async () => {
    let ok = 0;
    for (let run = 0; run < 10; run++) {
      const p = memoryProvider();
      const a = await newVault(p);
      a.files.set(`run-${run}.md`, `# ${run}\nשלום ${run}`);
      a.files.set("notes/x.md", "ASCII");
      await a.sync.sync();
      const { key } = await setUpRecovery(a.sync);
      await a.sync.sync();
      const words = await toRecoveryWords(key);
      // The clean profile has nothing but the provider and what the user typed.
      const typed = await parseRecoveryWords(words.join(" "));
      if (!typed.ok) throw new Error("the words didn't parse");
      const { keys } = await unlockWithRecoveryKey(p, typed.key);
      const files = memoryFiles();
      await new E2eeSync({ provider: p, keys, local: files, store: memoryStateStore() }).sync();
      if (JSON.stringify(snapshot({ files } as never)) === JSON.stringify(snapshot(a))) ok++;
    }
    expect(ok).toBe(10);
  });
});
