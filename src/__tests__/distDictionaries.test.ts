/**
 * Plan W7.9 acceptance 3: no GPL or AGPL spelling dictionary inside a build
 * (scripts/dist-dictionaries.mjs). The Yiddish list and Hspell are user
 * downloads only; the scanner must find one however it is bundled, and must
 * refuse a folder with nothing in it rather than pass it.
 * @vitest-environment node
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error: a plain .mjs script without types
import { forbiddenPins, hunspellInText, scanDist } from "../../scripts/dist-dictionaries.mjs";

const dirs: string[] = [];
function build(files: Record<string, string | Buffer>): string {
  const d = mkdtempSync(join(tmpdir(), "dist-dict-"));
  dirs.push(d);
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(d, name, ".."), { recursive: true });
    writeFileSync(join(d, name), body);
  }
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const yiddish = ["שרייַבן/V", "לייענען/V", "הויז/N", "שטאָט/N", "ייִדיש", "ביכער", "קינד/NP", "וואַסער"];
const DIC = [String(600), ...Array.from({ length: 600 }, (_, i) => `${"אבגדהוזחטיכלמנסעפצקרשת"[i % 22]}${yiddish[i % yiddish.length]}`)].join("\n");
const AFF = "SET UTF-8\nTRY יעאוו\nSFX N Y 2\nSFX N 0 ען .\nSFX N 0 ן ע\n";
const CLEAN = {
  "index.html": "<!doctype html><title>Lumen</title><script type=module src=assets/index.js></script>",
  "assets/index.js": 'const words = ["אַ", "ביסל"]; export const n = 600;\nconsole.log(words.join("\\n"));',
  "lexicon/he-wiki.json": JSON.stringify({ words: ["שלום", "עולם"], licence: "CC BY-SA 4.0" }),
  "freq/he_50k.txt": "של 12345\nאת 11000\nעל 9000\nזה 8000\nלא 7000\nאני 6000\n",
};

describe("no spelling dictionary inside a build (W7.9)", () => {
  it("passes a clean build, frequency lists and app strings included", () => {
    const r = scanDist(build(CLEAN));
    expect(r.error).toBeUndefined();
    expect(r.files).toBe(4);
    expect(r.findings).toEqual([]);
  });

  it("finds a dictionary by its name", () => {
    const r = scanDist(build({ ...CLEAN, "dict/yi.dic": "2\nא\nב\n", "dict/yi.aff": "SET UTF-8\n" }));
    expect(r.findings.map((f: { file: string }) => f.file).sort()).toEqual(["dict/yi.aff", "dict/yi.dic"]);
  });

  it("finds a word list or an affix table under another name, as a file or as a string in a chunk", () => {
    const r = scanDist(
      build({
        ...CLEAN,
        "assets/words-3f9a.txt": DIC,
        "assets/rules.json": JSON.stringify({ aff: AFF }),
        "assets/chunk-7c1.js": `export default ${JSON.stringify(DIC)};`,
      }),
    );
    expect(r.findings.map((f: { file: string }) => f.file).sort()).toEqual(["assets/chunk-7c1.js", "assets/rules.json", "assets/words-3f9a.txt"]);
  });

  it("finds the pinned Yiddish list byte for byte, whatever it is called", () => {
    expect(forbiddenPins().has("7c122babdcb20c47a87459ab3192c4c2f35900420b84bca35960a1a48de82ee0")).toBe(true);
    expect(hunspellInText(DIC)?.kind).toBe("dic");
    expect(hunspellInText(AFF)?.kind).toBe("aff");
    expect(hunspellInText("SFX in a sentence about suffixes\n".repeat(8))).toBeNull();
  });

  it("refuses to pass when there is nothing to check", () => {
    expect(scanDist(join(tmpdir(), "no-such-build-folder-w79")).error).toMatch(/no build folder/);
    expect(scanDist(build({})).error).toMatch(/empty/);
    expect(scanDist(build({ "assets/a.js": "1" })).error).toMatch(/no index\.html/);
  });
});
