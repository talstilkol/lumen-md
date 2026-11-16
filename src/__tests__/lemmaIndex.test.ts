/**
 * Plan W11.H12: the lemmatizer seam reaches the vault's search index
 * (src/search/lemma/lemmaIndex.ts, Bm25Index extra terms, VaultIndex
 * useLemmatizer), and the W11.M3 rule decides whether a model is used at all.
 * The lemmatizer here is a stand-in dictionary, not Shoshan or DictaBERT-lex.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { VaultIndex } from "../storage/vaultIndexCore";
import { Bm25Index } from "../search/bm25";
import { LEMMA, LEMMA_WEIGHT, queryTerms } from "../text/searchTokens";
import type { Lemmatizer } from "../search/lemma/lemmatizer";
import { chosenLemmatizer, documentLemmaTerms, expandWithLemmas, LemmaLexicon, lemmatizerVerdicts, lemmatizerWinner, lemmatizerWins } from "../search/lemma/lemmaIndex";

// Irregular inflections the rule-based morphology cannot relate to their lemma.
const LEX: Record<string, string> = { נשים: "אישה", אנשים: "איש", ערים: "עיר", הלכנו: "הלך" };
function standIn(calls: string[] = []): Lemmatizer {
  return {
    id: "stand-in",
    async lemmatize(words, sentence) {
      calls.push(sentence);
      return words.map((w) => LEX[w] ?? w);
    },
  };
}
const note = (path: string, content: string) => ({ path, name: path.replace(/\.md$/, ""), content, modified: 1 });
const paths = (idx: VaultIndex, q: string) => idx.search(q).map((h) => h.path);

describe("W11.H12 lemma terms", () => {
  it("gives one ≃ term per word in the index's comparison form, and the lexicon learns the words", async () => {
    const lexicon = new LemmaLexicon();
    const terms = await documentLemmaTerms("נשים הלכנו. ערים", standIn(), lexicon);
    expect(terms).toEqual([LEMMA + "אישה", LEMMA + "הלכ", LEMMA + "עיר"]);
    expect([...(lexicon.lemmasOf("נשימ") ?? [])]).toEqual(["אישה"]);
  });
  it("refuses a model answer with the wrong number of lemmas", async () => {
    const bad: Lemmatizer = { id: "bad", lemmatize: async () => ["x"] };
    await expect(documentLemmaTerms("שתי מילים", bad)).rejects.toThrow(/1 lemmas for 2 words/);
  });
  it("adds a query word's lemmas from the lexicon and the word itself, below the exact word, in its group", () => {
    const lexicon = new LemmaLexicon();
    lexicon.add("נשימ", "אישה");
    const base = queryTerms("נשים");
    const more = expandWithLemmas(base, lexicon);
    expect(more.map((t) => t.term).sort()).toEqual([LEMMA + "אישה", LEMMA + "נשימ"].sort());
    for (const t of more) expect(t).toMatchObject({ weight: LEMMA_WEIGHT, group: 0 });
  });
});

describe("W11.H12 Bm25Index extra terms", () => {
  it("indexes extra terms with the text, and re-indexes when only they change", () => {
    const idx = new Bm25Index();
    idx.set("a", "נשים הלכו לעבודה");
    expect(idx.search([{ term: LEMMA + "אישה", weight: 1, group: 0 }])).toEqual([]);
    idx.set("a", "נשים הלכו לעבודה", "", [LEMMA + "אישה"]);
    expect(idx.search([{ term: LEMMA + "אישה", weight: 1, group: 0 }]).map((h) => h.id)).toEqual(["a"]);
    idx.set("a", "נשים הלכו לעבודה");
    expect(idx.search([{ term: LEMMA + "אישה", weight: 1, group: 0 }])).toEqual([]);
  });
});

describe("W11.H12 the vault index with a lemmatizer", () => {
  it("without one, a search for the lemma does not find the irregular form (today's search)", () => {
    const idx = new VaultIndex();
    idx.upsert(note("a.md", "הנשים הגיעו לישיבה"));
    idx.upsert(note("b.md", "פרוטוקול הישיבה"));
    expect(paths(idx, "אישה")).not.toContain("a.md");
  });

  it("with one, the note with נשים is found for אישה and for נשים, and the exact word still ranks first", async () => {
    const idx = new VaultIndex();
    idx.upsert(note("a.md", "נשים הגיעו לישיבה"));
    idx.upsert(note("b.md", "אישה אחת כתבה את הפרוטוקול"));
    idx.upsert(note("c.md", "רשימת קניות"));
    await idx.useLemmatizer(standIn());
    expect(paths(idx, "אישה")).toEqual(["b.md", "a.md"]);
    expect(paths(idx, "נשים")).toEqual(["a.md", "b.md"]);
    expect(paths(idx, "אישה")).not.toContain("c.md");
  });

  it("a note added or changed later gets its lemmas, and a stale answer for an old text is dropped", async () => {
    const calls: string[] = [];
    const idx = new VaultIndex();
    await idx.useLemmatizer(standIn(calls));
    idx.upsert(note("a.md", "ערים גדולות"));
    idx.upsert({ ...note("a.md", "אנשים טובים"), modified: 2 });
    await idx.lemmasSettled();
    expect(paths(idx, "איש")).toEqual(["a.md"]);
    expect(paths(idx, "עיר")).toEqual([]);
    expect(calls).toContain("אנשים טובים");
  });

  it("a lemmatizer that throws leaves the note on its words; turning it off removes the lemma terms", async () => {
    const idx = new VaultIndex();
    idx.upsert(note("a.md", "נשים הגיעו"));
    await idx.useLemmatizer({ id: "broken", lemmatize: async () => Promise.reject(new Error("onnx")) });
    expect(paths(idx, "נשים")).toEqual(["a.md"]);
    await idx.useLemmatizer(standIn());
    expect(paths(idx, "אישה")).toEqual(["a.md"]);
    await idx.useLemmatizer(null);
    expect(paths(idx, "אישה")).toEqual([]);
    expect(paths(idx, "נשים")).toEqual(["a.md"]);
  });
});

describe("W11.H12 which lemmatizer (the W11.M3 rule)", () => {
  it("wins only with ≥ 92 % out-of-domain accuracy and an nDCG@10 not below today's", () => {
    expect(lemmatizerWins({ accuracyOod: 0.924, ndcg10: 0.61, ndcg10None: 0.6 })).toBe(true);
    expect(lemmatizerWins({ accuracyOod: 0.924, ndcg10: 0.6, ndcg10None: 0.6 })).toBe(true);
    expect(lemmatizerWins({ accuracyOod: 0.919, ndcg10: 0.7, ndcg10None: 0.6 })).toBe(false);
    expect(lemmatizerWins({ accuracyOod: 0.95, ndcg10: 0.59, ndcg10None: 0.6 })).toBe(false);
    expect(lemmatizerWins({ accuracyOod: Number.NaN, ndcg10: 0.7, ndcg10None: 0.6 })).toBe(false);
    expect(lemmatizerWins(undefined)).toBe(false);
  });
  it("picks the better passing candidate, else none", () => {
    const v = { shoshan: { accuracyOod: 0.924, ndcg10: 0.62, ndcg10None: 0.6 }, "dictabert-lex": { accuracyOod: 0.93, ndcg10: 0.61, ndcg10None: 0.6 } };
    expect(lemmatizerWinner(v)).toBe("shoshan");
    expect(lemmatizerWinner({ ...v, shoshan: { ...v.shoshan, accuracyOod: 0.9 } })).toBe("dictabert-lex");
    expect(lemmatizerWinner({})).toBeNull();
  });
  it("builds verdicts from the latest results: accuracy from UD, nDCG@10 from the HeQ A/B; one without the other has none", () => {
    const v = lemmatizerVerdicts([
      { task: "lemma-ud-iahltwiki", engine: "shoshan", model: { id: "shoshan" }, metrics: { accuracy: 0.924 } },
      { task: "lemma-ud-iahltwiki", engine: "dictabert-lex", model: { id: "dictabert-lex" }, metrics: { accuracy: 0.9 } },
      { task: "retrieval-heq", engine: "shoshan", model: { id: "shoshan" }, metrics: { "ndcg10.none": 0.6, "ndcg10.shoshan": 0.62 } },
    ]);
    expect(v).toEqual({ shoshan: { accuracyOod: 0.924, ndcg10: 0.62, ndcg10None: 0.6 } });
  });
  it("is null today: the committed verdicts name no lemmatizer, and even a winner needs a runtime", async () => {
    const committed = JSON.parse(readFileSync("eval/public/_verdicts.json", "utf8"));
    expect(committed.lemmatizers).toEqual({});
    expect(await chosenLemmatizer(async () => committed.lemmatizers)).toBeNull();
    const win = { shoshan: { accuracyOod: 0.93, ndcg10: 0.62, ndcg10None: 0.6 } };
    expect(await chosenLemmatizer(async () => win)).toBeNull();
    const lz = standIn();
    const asked: string[] = [];
    expect(await chosenLemmatizer(async () => win, async (id) => (asked.push(id), lz))).toBe(lz);
    expect(asked).toEqual(["shoshan"]);
  });
  it("the vault index worker asks for it at start", () => {
    const src = readFileSync("src/storage/vaultIndex.worker.ts", "utf8");
    expect(src).toMatch(/chosenLemmatizer\(\)[\s\S]{0,80}useLemmatizer/);
  });
});
