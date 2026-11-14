/**
 * W11.H11 — Hebrew NER: DictaBERT-NER's output to entities, the PII
 * redactor and unlinked mentions on top of it, and the NEMO/BMC entity-F1
 * adapter. The model is not here (its ONNX int8 export is W11.M3): every
 * token stream below is a SYNTHETIC stand-in in the shape transformers.js'
 * token-classification pipeline returns, written for this test.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { alignEntities, entitySuggestions } from "../ai/ner/entities";
import { alignNer, PiiVault, redactText, type NerToken } from "../ai/pii";
import { entities, nerAccepted, parseConll, scoreNer, type NerEngine } from "../eval/public/adapters/ner";
// @ts-expect-error — plain .mjs helper without types
import { validateEntry } from "../../scripts/lib/licenses.mjs";

const TEXT = "דנה כהן נפגשה עם אנשי גוגל בירושלים ביום שני.";
// Stand-in for DictaBERT-NER's token output on TEXT (B-/I- labels, WordPiece pieces, scores).
const TOKENS: NerToken[] = [
  { entity: "B-PER", word: "דנה", score: 0.99 },
  { entity: "I-PER", word: "כהן", score: 0.98 },
  { entity: "B-ORG", word: "גוגל", score: 0.95 },
  { entity: "B-GPE", word: "בירושלים", score: 0.97 },
  { entity: "B-TIMEX", word: "ביום", score: 0.9 },
  { entity: "I-TIMEX", word: "שני", score: 0.9 },
];

describe("DictaBERT-NER output as entities", () => {
  it("merges B-/I- pieces into entities with their text and every label", () => {
    const e = alignEntities(TEXT, TOKENS);
    expect(e.map((x) => [x.text, x.label])).toEqual([
      ["דנה כהן", "PER"],
      ["גוגל", "ORG"],
      ["בירושלים", "GPE"],
      ["ביום שני", "TIMEX"],
    ]);
    expect(TEXT.slice(e[0].start, e[0].end)).toBe("דנה כהן");
  });
  it("drops low-confidence and unknown labels, and joins ## continuation pieces", () => {
    const e = alignEntities("שרה לוינזון", [
      { entity: "B-PER", word: "שרה", score: 0.9 },
      { entity: "I-PER", word: "לוינ", score: 0.9 },
      { entity: "I-PER", word: "##זון", score: 0.9 },
    ]);
    expect(e.map((x) => x.text)).toEqual(["שרה לוינזון"]);
    expect(alignEntities("x", [{ entity: "B-XYZ", word: "x", score: 1 }])).toEqual([]);
    expect(alignEntities("דנה", [{ entity: "B-PER", word: "דנה", score: 0.2 }])).toEqual([]);
  });
});

describe("the PII redactor with a stand-in NER engine", () => {
  it("people and places are found and hidden", async () => {
    const ner = async (t: string) => alignNer(t, TOKENS, { keep: ["PERSON", "LOCATION"] });
    const vault = new PiiVault();
    const out = await redactText(TEXT, vault, { ner });
    expect(out).not.toContain("דנה כהן");
    expect(out).not.toContain("ירושלים");
    expect(out).toContain("גוגל"); // an organisation is not personal data
    expect(vault.restore(out)).toBe(TEXT);
  });
});

describe("unlinked mentions: the names a note mentions", () => {
  it("links a name to its note through a Hebrew prefix; others are 'no note yet'; linked names are left out", () => {
    const text = `${TEXT} שוב [[דנה כהן]].`;
    const ents = alignEntities(text, TOKENS);
    const s = entitySuggestions(text, ents, ["ירושלים", "דנה כהן", "פרויקט"]);
    expect(s.map((x) => [x.text, x.label, x.note])).toEqual([
      ["דנה כהן", "PER", "דנה כהן"],
      ["גוגל", "ORG", null],
      ["בירושלים", "GPE", "ירושלים"],
    ]);
    // TIMEX is not a linkable label.
    expect(s.find((x) => x.label === ("TIMEX" as never))).toBeUndefined();
  });
});

describe("NEMO / BMC adapter (CoNLL, BIOES), entity-level F1", () => {
  // SYNTHETIC sentences in the token-per-line format.
  const conll = ["דנה B-PER", "כהן E-PER", "גרה O", "בחיפה S-GPE", "", "# comment", "גוגל S-ORG", "פתחה O", "משרד O", "בתל B-GPE", "אביב E-GPE", ""].join("\n");
  it("parses sentences and decodes BIOES, BIO and BILOU spans", () => {
    const s = parseConll(conll);
    expect(s.map((x) => x.tokens.length)).toEqual([4, 5]);
    expect(entities(s[0].tags)).toEqual([
      { start: 0, end: 2, type: "PER" },
      { start: 3, end: 4, type: "GPE" },
    ]);
    expect(entities(["B-PER", "I-PER", "O", "I-ORG"])).toEqual([
      { start: 0, end: 2, type: "PER" },
      { start: 3, end: 4, type: "ORG" },
    ]);
    expect(entities(["U-LOC", "B-PER", "L-PER"])).toEqual([
      { start: 0, end: 1, type: "LOC" },
      { start: 1, end: 3, type: "PER" },
    ]);
    expect(() => parseConll("token X-PER")).toThrow(/BIO/);
  });
  it("scores a stand-in engine: exact span and type, micro P/R/F1 and per type", async () => {
    const sents = parseConll(conll);
    // Stand-in: right on sentence 1; on sentence 2 it misses "תל אביב"'s span (tags only "אביב").
    const engine: NerEngine = { id: "stand-in", tag: async (tokens) => (tokens[0] === "דנה" ? ["B-PER", "E-PER", "O", "S-GPE"] : ["S-ORG", "O", "O", "O", "S-GPE"]) };
    const r = await scoreNer(sents, engine);
    expect(r.n).toBe(2);
    expect(r.metrics).toEqual({ precision: 0.75, recall: 0.75, f1: 0.75 });
    expect(r.byType.GPE).toEqual({ gold: 2, precision: 0.5, recall: 0.5, f1: 0.5 });
    await expect(scoreNer(sents, { id: "bad", tag: async () => ["O"] })).rejects.toThrow(/1 tags for 4 tokens/);
  });
  it("the acceptance: F1 ≥ 85 and int8 within 2 points of fp32", () => {
    expect(nerAccepted(0.87, 0.88)).toBe(true);
    expect(nerAccepted(0.84, null)).toBe(false);
    expect(nerAccepted(0.86, 0.9)).toBe(false);
  });
});

describe("registry (gate 0.10)", () => {
  const reg = JSON.parse(readFileSync("models/registry.json", "utf8")).models as Record<string, unknown>[];
  it("DictaBERT-NER links its public benchmarks; HalleluBERT is a candidate; NeoDictaBERT is listed and not delivered", () => {
    const by = (id: string) => reg.find((e) => e.id === id)!;
    expect(by("dictabert-ner").benchmarks).toEqual(["ner-nemo", "ner-bmc"]);
    for (const id of ["HalleluBERT", "NeoDictaBERT"]) expect(validateEntry(by(id)), id).toEqual([]);
    expect([by("HalleluBERT").license, by("HalleluBERT").delivery]).toEqual(["MIT", "none"]);
    expect([by("NeoDictaBERT").class, by("NeoDictaBERT").delivery]).toEqual(["conditional", "none"]);
  });
});
