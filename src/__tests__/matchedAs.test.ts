/**
 * Plan R12.16: "matched as …" under a search result, and transliteration keys
 * (Kohen ↔ כהן). The words are common Hebrew words and well-known names, and
 * the notes are synthetic one-liners.
 */
import { describe, expect, it } from "vitest";
import { isTransliteration, phoneticKeys } from "../text/translit";
import { explainMatch, looseMatches, matchTier } from "../text/matchedAs";
import { Bm25Index, MAX_TRANSLIT_TERMS } from "../search/bm25";
import { normalizeForMatch } from "../text/hebrew";

const n = normalizeForMatch;

describe("transliteration keys", () => {
  it.each([
    ["kohen", "כהן"],
    ["cohen", "כהן"],
    ["lapid", "לפיד"],
    ["netanyahu", "נתניהו"],
    ["jerusalem", "ירושלים"],
    ["haifa", "חיפה"],
    ["michael", "מיכאל"],
    ["chaim", "חיים"],
    ["herzl", "הרצל"],
    ["shalom", "שלום"],
  ])("%s ↔ %s", (latin, hebrew) => {
    expect(isTransliteration(latin, n(hebrew))).toBe(true);
    expect(isTransliteration(n(hebrew), latin)).toBe(true);
  });

  it("does not join words that only share a letter or two", () => {
    expect(isTransliteration("but", "בית")).toBe(false); // short words take no part
    expect(isTransliteration("lapid", "כהן")).toBe(false);
    expect(isTransliteration("garden", n("ירושלים"))).toBe(false);
    expect(isTransliteration("kohen", "cohen")).toBe(false); // same script: a spelling question, not this one
    expect(phoneticKeys("ab")).toEqual([]);
    expect(phoneticKeys("abc1")).toEqual([]);
  });

  it("ambiguous letters read both ways (ב b/v, פ p/f, ש sh/s)", () => {
    expect(isTransliteration("avraham", n("אברהם"))).toBe(true);
    expect(isTransliteration("abraham", n("אברהם"))).toBe(true);
    expect(isTransliteration("sharon", n("שרון"))).toBe(true);
    expect(isTransliteration("saron", n("שרון"))).toBe(true);
    expect(isTransliteration("yosef", "יוסף")).toBe(true);
    expect(isTransliteration("yosep", "יוסף")).toBe(true);
    expect(phoneticKeys(n("ירושלים")).length).toBeLessThanOrEqual(16);
  });
});

describe("match tiers", () => {
  it("names the tier: exact → niqqud → finals → prefix → ktiv → lemma → synonym → english → translit", () => {
    expect(matchTier("שלום", "שלום")?.tier).toBe("exact");
    expect(matchTier("Garden", "garden")?.tier).toBe("exact");
    expect(matchTier("שָׁלוֹם", "שלום")?.tier).toBe("niqqud");
    expect(matchTier("שלומ", "שלום")?.tier).toBe("finals");
    expect(matchTier("ולפיד", "לפיד")).toEqual({ tier: "prefix", prefix: "ו" });
    expect(matchTier("לפיד", "והלפיד")).toEqual({ tier: "prefix", prefix: "וה" });
    expect(matchTier("תכנית", "תוכנית")?.tier).toBe("ktiv");
    expect(matchTier("אבודות", "אבודה")?.tier).toBe("lemma");
    expect(matchTier("מכונית", "רכב")?.tier).toBe("synonym");
    // מתכון/recipe left HE_EN on the train (W10.B6: rows written from the dev probe are gone); ספר/book is general vocabulary.
    expect(matchTier("ספר", "book")?.tier).toBe("english");
    expect(matchTier("Kohen", "כהן")?.tier).toBe("translit");
    expect(matchTier("Kohen", "שלום")).toBeNull();
  });

  it("explains each query word by its best match in the text", () => {
    const [m] = explainMatch("ולפיד", "הודעה: לפיד אמר");
    expect(m).toEqual({ tier: "prefix", prefix: "ו", query: "ולפיד", word: "לפיד" });
    expect(looseMatches("Kohen", "הרב כהן אמר")).toEqual([{ tier: "translit", query: "Kohen", word: "כהן" }]);
    expect(looseMatches("כהן", "הרב כהן אמר")).toEqual([]); // exact: nothing to explain
    expect(explainMatch("Kohen zzz", "הרב כהן")[1]).toBeNull();
  });
});

describe("BM25 finds transliterations (R12.16)", () => {
  const index = () => {
    const ix = new Bm25Index();
    ix.set("he.md", "הרב כהן אמר דברים");
    ix.set("en.md", "Rabbi Kohen said a few words");
    ix.set("lapid.md", "לפיד הודיע הבוקר");
    ix.set("other.md", "nothing here at all");
    return ix;
  };

  it("Kohen finds כהן, and כהן finds Kohen, below the exact script", () => {
    const ix = index();
    const latin = ix.search("Kohen").map((h) => h.id);
    expect(latin).toEqual(["en.md", "he.md"]);
    const hebrew = ix.search("כהן").map((h) => h.id);
    expect(hebrew).toEqual(["he.md", "en.md"]);
    expect(ix.search("Kohen").find((h) => h.id === "he.md")?.matched).toEqual([n("כהן")]);
  });

  it("ולפיד finds לפיד (the prefix-less stem, as before)", () => {
    expect(index().search("ולפיד").map((h) => h.id)).toEqual(["lapid.md"]);
  });

  it("keeps the phonetic map current after set and remove", () => {
    const ix = index();
    expect(ix.search("Kohen").map((h) => h.id)).toContain("he.md"); // builds the map
    ix.remove("he.md");
    expect(ix.search("Kohen").map((h) => h.id)).toEqual(["en.md"]);
    ix.set("new.md", "משפחת כהן הגיעה");
    expect(ix.search("Kohen").map((h) => h.id)).toEqual(["en.md", "new.md"]);
    ix.set("new.md", "משפחה אחרת הגיעה"); // replaced: its old word goes
    expect(ix.search("Kohen").map((h) => h.id)).toEqual(["en.md"]);
  });

  it("bounds how many words one query word may pull in", () => {
    expect(MAX_TRANSLIT_TERMS).toBeLessThanOrEqual(8);
  });
});
