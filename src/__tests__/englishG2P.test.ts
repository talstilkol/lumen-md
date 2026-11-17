/**
 * Plan 6.2: the English G2P, a port of misaki's lexicon (Apache-2.0), on a
 * 53-entry subset of its us_gold.json (fixtures/misaki, NOTICE). The -s /
 * -ed / -ing forms are not in the subset: the port's rules must produce
 * the readings misaki's own us_silver.json lists for them ("derived").
 * (A parity run against misaki's Python was not possible here; see the PR.)
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyStress, EnglishLexicon, growDictionary, numberWords, phonemizeEnglish, type LexMap } from "../ai/tts/englishG2P";
// @ts-expect-error — a plain .mjs build script
import { buildPack, MISAKI_COMMIT } from "../../scripts/tts/build-misaki-dict.mjs";

const fx = JSON.parse(readFileSync(join(__dirname, "fixtures/misaki/us-subset.json"), "utf8")) as { gold: LexMap; silver: LexMap; derived: Record<string, string> };
const lex = new EnglishLexicon(fx.gold, fx.silver);
const none = { futureVowel: null, futureTo: false };
const word = (w: string, futureVowel: boolean | null = null) => lex.getWord(w, null, { futureVowel, futureTo: false })[0];

describe("dictionary and stress", () => {
  it("grows the dictionary to Capitalised and lower-case keys, as misaki does", () => {
    const g = growDictionary({ markdown: "x", Hebrew: "y", A: "z" });
    expect(g).toMatchObject({ markdown: "x", Markdown: "x", Hebrew: "y", hebrew: "y", A: "z" });
    expect(word("Markdown")).toBe("mˈɑɹkdˌWn");
  });

  it("apply_stress: demote, strip, add and promote", () => {
    expect(applyStress("ɹˈʌn", -1)).toBe("ɹˌʌn");
    expect(applyStress("ɹˈʌn", -2)).toBe("ɹʌn");
    expect(applyStress("ɹʌn", 0)).toBe("ɹˌʌn");
    expect(applyStress("mˌAk", 1)).toBe("mˈAk");
    expect(applyStress("ɹʌn", 2)).toBe("ɹˈʌn");
    expect(applyStress("ɹˈʌn", null)).toBe("ɹˈʌn");
  });
});

describe("words", () => {
  it("gold words, and heteronyms take DEFAULT (no tagger), or None before nothing", () => {
    expect(word("hello")).toBe("həlˈO");
    expect(word("read")).toBe("ɹˈid");
    expect(word("get")).toBe("ɡˈɛt");
    expect(word("get", false)).toBe("ɡɛt");
  });

  it("misaki's special cases for function words follow the next word", () => {
    expect(word("the", true)).toBe("ði");
    expect(word("the", false)).toBe("ðə");
    expect(word("to", null)).toBe("tu");
    expect(word("to", true)).toBe("tʊ");
    expect(word("to", false)).toBe("tə");
    expect(word("am", false)).toBe("ɐm");
    expect(word("am", null)).toBe("æm");
    expect([word("a"), word("an"), word("in"), word("used"), word("%")]).toEqual(["ˈA", "ɐn", "ˈɪn", "jˈuzd", "pəɹsˈɛnt"]);
  });

  it("-s, -ed and -ing come out as misaki's silver dictionary lists them", () => {
    for (const [w, want] of Object.entries(fx.derived)) expect(word(w), w).toBe(want);
    expect(word("children's")).toBe("ʧˈɪldɹᵊnz");
    expect(word("running")).toBe("ɹˈʌnɪŋ");
    expect(word("wanted")).toBe("wˈɑntᵻd");
  });

  it("acronyms letter by letter, known capitals as words, unknown words as null", () => {
    expect(word("NASA")).toBe("nˈæsə");
    expect(word("FBI")).toBe("ˌɛfbˌiˈI");
    expect(word("U.S.")).toBe("jˌuˈɛs");
    expect(word("zyxwv")).toBeNull();
    expect(lex.lookup("hello", 2, none)[1]).toBe(4);
  });
});

describe("text", () => {
  it("phonemizes a sentence word by word, numbers spelled out, unknowns marked", () => {
    expect(numberWords(21)).toBe("twenty-one");
    expect(numberWords(1100)).toBe("one thousand one hundred");
    expect(() => numberWords(-1)).toThrow(RangeError);
    const r = phonemizeEnglish("Hello, the world: 21 notes zyxwv.", lex);
    expect(r.phonemes).toBe("həlˈO, ðə wˈɜɹld: twˈɛnti wˈʌn nˈOts ❓.");
    expect(r.tokens.find((t) => t.text === "zyxwv")).toMatchObject({ phonemes: null });
    // The article before a vowel sound.
    expect(phonemizeEnglish("the editor", new EnglishLexicon({ ...fx.gold, editor: "ˈɛdəɾəɹ" }, {})).phonemes).toBe("ði ˈɛdəɾəɹ");
  });
});

describe("the dictionary pack", () => {
  it("is pinned to one misaki commit and rejects a malformed entry", () => {
    expect(MISAKI_COMMIT).toMatch(/^[0-9a-f]{40}$/);
    const p = buildPack(fx.gold, fx.silver);
    expect(p).toMatchObject({ license: "Apache-2.0", commit: MISAKI_COMMIT });
    expect(new EnglishLexicon(p.gold, p.silver).getWord("hello", null, none)[0]).toBe("həlˈO");
    expect(() => buildPack({ bad: { VERB: "x" } }, {})).toThrow(/DEFAULT/);
  });
});

describe("Kokoro's input", () => {
  it("misakiPhonemizer maps the phonemes to the voice's token ids, dropping what the vocab lacks", async () => {
    const { misakiPhonemizer } = await import("../ai/tts/kokoro");
    const vocab = Object.fromEntries([..."həlˈO wɜɹd"].map((c, i) => [c, i + 1]));
    const ph = await misakiPhonemizer(fx, vocab);
    expect(await ph("Hello world")).toEqual([..."həlˈO wˈɜɹld"].map((c) => vocab[c]).filter((x) => x !== undefined));
    expect(await ph("zyxwv")).toEqual([]);
  });
});
