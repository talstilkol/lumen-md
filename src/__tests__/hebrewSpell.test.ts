/**
 * T28 — Hebrew spelling and rules on this device. The dictionary used here
 * is a tiny hand-made one in Hspell's format (the real 5.7 MB AGPL list is
 * downloaded by the user, never bundled or fetched in tests).
 */
import { describe, it, expect, vi } from "vitest";
import { buildDictionary, hebrewRules, hebrewSpelling, isKnown, suggest, HEBREW_DICT_URL } from "../ai/hebrewSpell";

const DIC = ["9", "שלום/a", "בית/b", "ספריה/a", "מחשב/a", "מחשבים/a", "הלכתי/a", "ירושלים/a", "עולם/a", "טוב"].join("\n");
const dict = buildDictionary(DIC);

describe("dictionary", () => {
  it("parses the hunspell format", () => {
    expect(dict.size).toBe(9);
    expect(dict.has("שלום")).toBe(true);
  });
  it("knows words with prefix letters and niqqud", () => {
    expect(isKnown(dict, "ובבית")).toBe(true);
    expect(isKnown(dict, "וכשהלכתי")).toBe(true);
    expect(isKnown(dict, "שָׁלוֹם")).toBe(true);
    expect(isKnown(dict, "בירושלים")).toBe(true);
    expect(isKnown(dict, "סיפריה")).toBe(false);
  });
  it("suggests the likeliest fixes first", () => {
    expect(suggest(dict, "שלומ")[0]).toBe("שלום");
    expect(suggest(dict, "סיפריה")).toContain("ספריה");
    expect(suggest(dict, "מחשבב")[0]).toBe("מחשב");
  });
  it("flags unknown words with suggestions, skips acronyms", () => {
    const m = hebrewSpelling(dict, "שלום סיפריה צה״ל");
    expect(m.map((x) => x.rule.id)).toEqual(["HE_SPELLING"]);
    expect(m[0].offset).toBe(5);
    expect(m[0].replacements).toContain("ספריה");
  });
});

describe("rules without a dictionary", () => {
  it("final letter mid-word, missing final letter, double word, space before punctuation", () => {
    const ids = hebrewRules("שלוםם. שלומ עולם עולם , טוב").map((m) => m.rule.id);
    expect(ids).toContain("HE_FINAL_LETTER_MIDWORD");
    expect(ids).toContain("HE_MISSING_FINAL_LETTER");
    expect(ids).toContain("HE_DOUBLE_WORD");
    expect(ids).toContain("HE_SPACE_BEFORE_PUNCT");
  });
  it("is quiet on clean text", () => {
    expect(hebrewRules("שלום עולם, טוב מאוד. צה״ל ו-וכו'")).toEqual([]);
  });
});

describe("checking by paragraph language", () => {
  it("sends only the non-Hebrew paragraphs to LanguageTool, with offsets preserved", async () => {
    vi.resetModules();
    vi.doMock("idb-keyval", () => ({ get: vi.fn(async () => undefined), set: vi.fn(), del: vi.fn() }));
    const { checkByLanguage } = await import("../ai/hebrewSpellService");
    const text = "This is an English paragraph with a typo teh.\n\nשלום עולם עולם בבית.\n\nAnother English line.";
    const other = vi.fn(async (latin: string) => {
      expect(latin.length).toBe(text.length);
      expect(latin).not.toMatch(/[א-ת]/);
      const at = latin.indexOf("teh");
      return [{ offset: at, length: 3, message: "typo", replacements: ["the"], rule: { id: "EN" } }];
    });
    const matches = await checkByLanguage(text, other);
    expect(other).toHaveBeenCalledTimes(1);
    const he = matches.find((m) => m.rule.id === "HE_DOUBLE_WORD")!;
    expect(text.slice(he.offset, he.offset + he.length)).toBe("עולם עולם");
    const en = matches.find((m) => m.rule.id === "EN")!;
    expect(text.slice(en.offset, en.offset + en.length)).toBe("teh");
  });

  it("downloads the dictionary only on request and validates it", async () => {
    vi.resetModules();
    const store = new Map<string, unknown>();
    vi.doMock("idb-keyval", () => ({ get: vi.fn(async (k: string) => store.get(k)), set: vi.fn(async (k: string, v: unknown) => void store.set(k, v)), del: vi.fn(async (k: string) => void store.delete(k)) }));
    const svc = await import("../ai/hebrewSpellService");
    expect(await svc.hebrewDictionaryInstalled()).toBe(false);
    const fetchImpl = vi.fn(async () => new Response(DIC)) as unknown as typeof fetch;
    expect(await svc.downloadHebrewDictionary(fetchImpl)).toBe(9);
    expect(fetchImpl).toHaveBeenCalledWith(HEBREW_DICT_URL);
    expect(await svc.hebrewDictionaryInstalled()).toBe(true);
    await expect(svc.downloadHebrewDictionary((async () => new Response("<html>")) as unknown as typeof fetch)).rejects.toThrow(/hunspell/);
    await svc.removeHebrewDictionary();
    expect(await svc.hebrewDictionaryInstalled()).toBe(false);
  });
});
