/**
 * Plan W7.9: the Yiddish list is downloaded only from its pinned commit, and only with the pinned
 * size and SHA-256 of its raw bytes. R8-M5: the download is off pending the owner's licence
 * decision, and the app carries no upstream address for it (the licence gate reads the code).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { YIDDISH_DICT, YIDDISH_DOWNLOAD_ENABLED, YIDDISH_LIST_LICENCES } from "../ai/yiddishSpell";
// @ts-expect-error — plain .mjs module without type declarations
import { OK_LICENCE_IDS } from "../../scripts/lib/licenses.mjs";
import { YiddishDownloadPendingError, checkPinnedFile, downloadYiddishDictionary, yiddishDictionaryInstalled } from "../ai/yiddishSpellService";

const ROOT = join(__dirname, "..", "..");
// The upstream, as models/registry.json records it (tests may name it; the app does not).
const UPSTREAM = (f: "aff" | "dic") => `https://raw.githubusercontent.com/alephreish/hunspell-yi/${YIDDISH_DICT.commit}/${YIDDISH_DICT.files[f].name}`;

describe("Yiddish word list download (W7.9, R8-M5)", () => {
  it("is off pending the owner: nothing is fetched, and no allow-list entry or upstream address is in the tree's app code", async () => {
    expect(YIDDISH_DOWNLOAD_ENABLED).toBe(false);
    let fetched = 0;
    const fake = (async () => (fetched++, new Response("x"))) as unknown as typeof fetch;
    await expect(downloadYiddishDictionary(fake)).rejects.toBeInstanceOf(YiddishDownloadPendingError);
    expect(fetched).toBe(0);
    expect(readFileSync(join(ROOT, "licenses.allow.json"), "utf8")).not.toContain("hunspell-yi-dictionary");
    for (const f of ["src/ai/yiddishSpell.ts", "src/ai/yiddishSpellService.ts", "src/text/jewishLanguageCommands.ts"]) expect(readFileSync(join(ROOT, f), "utf8"), f).not.toMatch(/alephreish|hunspell-yi-dictionary/);
  });

  it("D1 §6: only a permissively licensed list (the licence gate's own set) is ever downloaded; the GPL-3.0 pin is refused even with an address", async () => {
    for (const l of YIDDISH_LIST_LICENCES) expect(OK_LICENCE_IDS, l).toContain(l);
    expect(YIDDISH_LIST_LICENCES).not.toContain(YIDDISH_DICT.license);
    let fetched = 0;
    const fake = (async () => (fetched++, new Response("x"))) as unknown as typeof fetch;
    await expect(downloadYiddishDictionary(fake, UPSTREAM)).rejects.toBeInstanceOf(YiddishDownloadPendingError);
    await expect(downloadYiddishDictionary(fake, UPSTREAM, { license: "GPL-3.0-or-later" })).rejects.toBeInstanceOf(YiddishDownloadPendingError);
    expect(fetched).toBe(0);
  });

  it("once re-enabled with a permissive list: the pinned commit, and a file whose SHA-256 differs is refused", async () => {
    const asked: string[] = [];
    const fake = (async (url: string) => {
      asked.push(url);
      return new Response(new Uint8Array(YIDDISH_DICT.files.aff.bytes), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(downloadYiddishDictionary(fake, UPSTREAM, { license: "MPL-1.1" })).rejects.toThrow(/SHA-256 differs/);
    expect(asked).toEqual([UPSTREAM("aff")]);
    expect(await yiddishDictionaryInstalled()).toBe(false);
  });

  it("checks the raw bytes: the exact size first, then the hash of the bytes as they came, not of decoded text", async () => {
    await expect(checkPinnedFile("aff", new TextEncoder().encode("1\nאַ\n"))).rejects.toThrow(/bytes, expected 338/);
    // A BOM or a stray byte changes the bytes even where decoding would hide it.
    const withBom = new Uint8Array(YIDDISH_DICT.files.aff.bytes);
    withBom.set([0xef, 0xbb, 0xbf]);
    await expect(checkPinnedFile("aff", withBom)).rejects.toThrow(/SHA-256 differs/);
    const src = readFileSync(join(ROOT, "src/ai/yiddishSpellService.ts"), "utf8");
    expect(src).toMatch(/res\.arrayBuffer\(\)/);
    expect(src).not.toMatch(/res\.text\(\)/);
  });
});
