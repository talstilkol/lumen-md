/**
 * W12.E3 — Hebrew entity resolution: prefixes are cut only toward a known
 * entity, names that look like prefix + word are never cut (50+ cases),
 * the swallowed article and doubled vav, plurals through the lemmatizer
 * seam, ktiv male/haser, aliases and the auto-link threshold. The names
 * and places are common words, not corpus data; accuracy on NEMO's gold
 * morphemes is W12.E9.
 */
import { describe, expect, it } from "vitest";
import { entityId, type Entity } from "../entities/model";
import { AUTO_LINK, EntityIndex, PREFIX_LOOKING_NAMES, autoLinks, haserKey, jaroWinkler, mentionStem, normName, prefixSplits, resolveMention } from "../entities/resolve";

const E = (type: Entity["type"], name: string, aliases: string[] = []): Entity => ({ id: entityId(type, name), type, name, aliases });
const jerusalem = E("place", "ירושלים", ["Jerusalem"]);
const rambam = E("person", "משה בן מימון", ["רמב״ם", "Maimonides"]);
const beitShemesh = E("place", "בית שמש");
const vienna = E("place", "וינה", ["Vienna"]);
const knesset = E("organization", "הכנסת", ["Knesset"]);
const court = E("organization", "בית המשפט העליון");
const sheep = E("concept", "שה");
const rak = E("concept", "רק");
const index = new EntityIndex([jerusalem, rambam, beitShemesh, vienna, knesset, court, sheep, rak]);

describe("W12.E3 normal form", () => {
  it("drops niqqud, folds finals, removes gershayim, maqaf to space", () => {
    expect(normName("יְרוּשָׁלַיִם")).toBe("ירושלימ");
    expect(normName("רמב״ם")).toBe("רמבמ");
    expect(normName("תל־אביב")).toBe("תל אביב");
    expect(haserKey("אייל")).toBe(haserKey("איל"));
  });
  it("prefixSplits: runs of up to three letters, ה only last, ו only first, stem ≥ 2", () => {
    expect(prefixSplits("ושבירושלים").map(([p]) => p)).toEqual(["ו", "וש", "ושב"]);
    expect(prefixSplits("הבית").map(([p]) => p)).toEqual(["ה"]);
    expect(prefixSplits("בהב").map(([p]) => p)).toEqual(["ב"]);
    expect(prefixSplits("דוד")).toEqual([]);
  });
});

describe("W12.E3 one entity for every prefixed form", () => {
  it.each(["ירושלים", "לירושלים", "בירושלים", "שבירושלים", "ובירושלים", "מירושלים", "כשבירושלים", "וירושלים", "יְרוּשָׁלַיִם"])("%s → ירושלים", (w) => {
    const m = resolveMention(w, index);
    expect(m.entity).toBe(jerusalem.id);
    expect(autoLinks(m)).toBe(true);
  });
  it("aliases in both languages, and abbreviations with gershayim", () => {
    for (const w of ["רמב״ם", "רמב\"ם", "לרמב״ם", "Maimonides", "משה בן מימון"]) expect(resolveMention(w, index).entity, w).toBe(rambam.id);
    expect(resolveMention("Jerusalem", index).entity).toBe(jerusalem.id);
  });
  it("only the first word of a multi-word name carries the prefix", () => {
    expect(resolveMention("ובבית שמש", index).entity).toBe(beitShemesh.id);
    expect(resolveMention("לבית המשפט העליון", index).entity).toBe(court.id);
  });
  it("after ב/כ/ל the article is swallowed: בכנסת = ב + הכנסת", () => {
    const m = resolveMention("בכנסת", index);
    expect([m.entity, m.prefix, m.key]).toEqual([knesset.id, "ב", "הכנסת"]);
    expect(resolveMention("והכנסת", index).entity).toBe(knesset.id);
    expect(resolveMention("לכנסת", index).entity).toBe(knesset.id);
  });
  it("a doubled vav after a prefix: בווינה = ב + וינה", () => {
    expect(resolveMention("בווינה", index).entity).toBe(vienna.id);
  });
  it("mentionStem cuts as written and restores a swallowed article", () => {
    expect(mentionStem("לִירוּשָׁלַיִם", index)).toBe("ירוּשָׁלַיִם");
    expect(mentionStem("בכנסת", index)).toBe("הכנסת");
    expect(mentionStem("משה", index)).toBe("משה");
  });
});

describe("W12.E3 names that look like a prefix are never cut", () => {
  const names = [...PREFIX_LOOKING_NAMES];
  it("the list has at least 50 names", () => expect(names.length).toBeGreaterThanOrEqual(50));
  it.each(names)("%s stays whole (even with שה and רק known)", (n) => {
    const m = resolveMention(n, index);
    expect(m.prefix).toBe("");
    expect(m.entity === sheep.id || m.entity === rak.id).toBe(false);
  });
  it("משה stays משה, ברק stays ברק; with a prefix they still resolve", () => {
    const moshe = E("person", "משה");
    const barak = E("person", "ברק");
    const lod = E("place", "לוד");
    const idx = new EntityIndex([moshe, barak, lod, sheep, rak]);
    expect(resolveMention("משה", idx).entity).toBe(moshe.id);
    expect(resolveMention("למשה", idx).entity).toBe(moshe.id);
    expect(resolveMention("ומשה", idx).entity).toBe(moshe.id);
    expect(resolveMention("ברק", idx).entity).toBe(barak.id);
    expect(resolveMention("שברק", idx).entity).toBe(barak.id);
    expect(resolveMention("בלוד", idx).entity).toBe(lod.id);
    expect(resolveMention("לוד", idx).entity).toBe(lod.id);
  });
  it("an unknown word is not cut toward nothing; a lexicon word is used only for non-names", () => {
    expect(resolveMention("בשולחן", new EntityIndex()).prefix).toBe("");
    const lex = new Set(["שולחן"]);
    expect(resolveMention("בשולחן", new EntityIndex(), { lexicon: lex })).toMatchObject({ prefix: "ב", key: "שולחנ", how: "lexicon", entity: null });
    expect(resolveMention("משה", new EntityIndex(), { lexicon: new Set(["שה"]) }).prefix).toBe("");
  });
});

describe("W12.E3 plurals, construct forms, spelling", () => {
  it("regular plurals reach a known singular", () => {
    const kibbutz = E("concept", "קיבוץ");
    const idx = new EntityIndex([kibbutz, E("concept", "ישיבה")]);
    expect(resolveMention("קיבוצים", idx).entity).toBe(kibbutz.id);
    expect(resolveMention("בקיבוצים", idx).entity).toBe(kibbutz.id);
    expect(resolveMention("ישיבות", idx).entity).toBe(entityId("concept", "ישיבה"));
  });
  it("construct forms go through the lemmatizer seam", () => {
    const house = E("concept", "בית ספר");
    const idx = new EntityIndex([house]);
    expect(autoLinks(resolveMention("בתי ספר", idx))).toBe(false);
    const lemmatize = (w: string) => (w === "בתי" ? ["בית"] : w === "ספר" ? ["ספר"] : []);
    // the lemmatizer handles the head word of the construct
    const idx2 = new EntityIndex([E("concept", "בית")]);
    expect(resolveMention("בתי", idx2, { lemmatize }).entity).toBe(entityId("concept", "בית"));
  });
  it("ktiv male and haser meet", () => {
    const eyal = E("person", "אייל גולן");
    expect(resolveMention("איל גולן", new EntityIndex([eyal])).entity).toBe(eyal.id);
  });
});

describe("W12.E3 scores and the threshold", () => {
  it("Jaro–Winkler: textbook values", () => {
    expect(jaroWinkler("MARTHA", "MARHTA")).toBeCloseTo(0.961, 3);
    expect(jaroWinkler("DWAYNE", "DUANE")).toBeCloseTo(0.84, 2);
    expect(jaroWinkler("DIXON", "DICKSONX")).toBeCloseTo(0.813, 3);
    expect(jaroWinkler("", "a")).toBe(0);
  });
  it("a near spelling is a proposal, never an automatic link", () => {
    const m = resolveMention("ירושלאים", index);
    expect(m.entity).toBe(jerusalem.id);
    expect(m.how).toBe("fuzzy");
    expect(m.score).toBeLessThan(AUTO_LINK);
    expect(autoLinks(m)).toBe(false);
  });
  it("two entities that share a name: no automatic link", () => {
    const idx = new EntityIndex([E("person", "דוד לוי"), { ...E("place", "דוד לוי") }]);
    expect(autoLinks(resolveMention("דוד לוי", idx))).toBe(false);
  });
});
