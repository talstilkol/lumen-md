/**
 * W11.H12 — Shoshan vs DictaBERT-lex for Hebrew search. The encoders are
 * not here (ONNX export W11.M3): every model below is a SYNTHETIC stand-in,
 * and every sentence is written for this test, so the numbers check the
 * harness, not the models.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeLemma, lemmaText, words, type Lemmatizer } from "../search/lemma/lemmatizer";
import { applyEditScript, parseInventory, plausible, scriptFor, shoshanLemma, shoshanLemmatizer, type ShoshanBank, type ShoshanEncoder } from "../search/lemma/shoshan";
import { dictaLexLemmatizer } from "../search/lemma/dictaLex";
import { abTest, heqRetrieval, ndcgAt, pickLemmatizer, IDENTITY } from "../search/lemma/abTest";
import { lemmaAccuracy, parseConllu } from "../eval/public/adapters/lemma";
// @ts-expect-error — plain .mjs helper without types
import { validateEntry } from "../../scripts/lib/licenses.mjs";

/** A tiny lemma bank with one-hot vectors, and a stand-in encoder that points each word at a bank row. */
const LEMMAS = ["מחברת", "מורה", "תלמיד", "כיתה", "חילק", "ספר"];
const bank: ShoshanBank = { lemmas: LEMMAS, dim: LEMMAS.length, vectors: Float32Array.from(LEMMAS.flatMap((_, r) => LEMMAS.map((__, k) => (r === k ? 1 : 0)))) };
const onehot = (r: number) => Float32Array.from(LEMMAS.map((_, k) => (k === r ? 1 : 0)));
const GUESS: Record<string, number> = { המחברות: 0, המורה: 1, לתלמידים: 2, בכיתה: 3, חילקה: 4, הספרים: 5, ספרים: 5, ומחברת: 0, מורים: 1 };
const inventory = parseInventory([
  { dp: 0, ds: 0, ap: "", as: "" },
  { dp: 1, ds: 0, ap: "", as: "" },
  { dp: 0, ds: 2, ap: "", as: "" },
]);
const encoder: ShoshanEncoder = {
  async encode(ws) {
    // Unknown words point at the bank's "ספר" (implausible for them) and pick script 2 (drop a plural ending).
    return ws.map((w) => ({ vector: onehot(GUESS[w] ?? 5), script: GUESS[w] === undefined ? 2 : 0 }));
  },
};

describe("Shoshan's lemma step, ported", () => {
  it("takes the bank lemma when it is a plausible edit of the word", () => {
    expect(shoshanLemma("המחברות", { vector: onehot(0), script: 0 }, bank, inventory)).toEqual({ lemma: "מחברת", source: "bank" });
    expect(shoshanLemma("לתלמידים", { vector: onehot(2), script: 0 }, bank, inventory)).toEqual({ lemma: "תלמיד", source: "bank" });
  });
  it("falls back to the edit script when the retrieved lemma is not plausible, never to a free string", () => {
    expect(plausible("שולחנות", "ספר")).toBe(false);
    expect(shoshanLemma("שולחנות", { vector: onehot(5), script: 2 }, bank, inventory)).toEqual({ lemma: "שולחנ", source: "edit" });
    expect(shoshanLemma("אב", { vector: onehot(5), script: 2 }, bank, inventory)).toEqual({ lemma: "אב", source: "word" });
  });
  it("edit scripts: applied, derived, and an inventory of another shape is refused", () => {
    expect(applyEditScript("הספרים", { dp: 1, ds: 2, ap: "", as: "" })).toBe("ספר");
    expect(scriptFor("הספרים", "ספר")).toEqual({ dp: 1, ds: 2, ap: "", as: "" });
    expect(applyEditScript("אב", { dp: 1, ds: 1, ap: "", as: "" })).toBeNull();
    expect(() => parseInventory([{ rule: "L1" }])).toThrow(/dp, ds, ap, as/);
  });
  it("normal form: undotted and quote-folded", () => {
    expect(normalizeLemma("מַחְבֶּרֶת")).toBe("מחברת");
    expect(normalizeLemma("צה״ל")).toBe('צה"ל');
    expect(words('המורה חילקה את המחברות, לצה"ל.')).toEqual(["המורה", "חילקה", "את", "המחברות", 'לצה"ל']);
  });
});

describe("UD Hebrew (CoNLL-U) lemma accuracy", () => {
  // SYNTHETIC CoNLL-U in UD Hebrew's layout: a multiword token splits the prefix off.
  const conllu = [
    "# sent_id = syn-1",
    "# text = המורה חילקה את המחברות.",
    "1-2\tהמורה\t_\t_\t_\t_\t_\t_\t_\t_",
    "1\tה\tה\tDET\t_\t_\t2\tdet\t_\t_",
    "2\tמורה\tמורה\tNOUN\t_\t_\t3\tnsubj\t_\t_",
    "3\tחילקה\tחילק\tVERB\t_\t_\t0\troot\t_\t_",
    "4\tאת\tאת\tADP\t_\t_\t6\tcase\t_\t_",
    "5-6\tהמחברות\t_\t_\t_\t_\t_\t_\t_\t_",
    "5\tה\tה\tDET\t_\t_\t6\tdet\t_\t_",
    "6\tמחברות\tמחברת\tNOUN\t_\t_\t3\tobj\t_\t_",
    "7\t.\t.\tPUNCT\t_\t_\t3\tpunct\t_\t_",
    "",
  ].join("\n");
  it("scores each surface word against its host word's lemma, punctuation skipped", async () => {
    const s = parseConllu(conllu);
    expect(s[0]).toMatchObject({ id: "syn-1", words: ["המורה", "חילקה", "את", "המחברות"], lemmas: ["מורה", "חילק", "את", "מחברת"] });
    const shoshan = shoshanLemmatizer(encoder, bank, inventory);
    const r = await lemmaAccuracy(s, shoshan);
    // "את" is not in the stand-in bank: "ספר" is implausible and script 2 would empty it, so the word itself stays — right.
    expect(r).toMatchObject({ words: 4, metrics: { accuracy: 1 } });
    // A wrong host lemma counts as wrong.
    const bad = parseConllu(conllu.replace("\tמחברת\tNOUN", "\tמחברה\tNOUN"));
    expect((await lemmaAccuracy(bad, shoshan)).metrics.accuracy).toBe(0.75);
  });
});

describe("the A/B on retrieval (nDCG@10), and the winner rule", () => {
  // SYNTHETIC HeQ-style data: questions that need the lemma to find their paragraph.
  const heq = {
    data: [
      { title: "a", paragraphs: [{ context: "המורה חילקה את המחברות לתלמידים בכיתה.", qas: [{ id: "q1", question: "מי חילק מחברת?" }] }] },
      { title: "b", paragraphs: [{ context: "בספרייה יש הרבה ספרים ישנים.", qas: [{ id: "q2", question: "איפה יש ספר?" }] }] },
      { title: "c", paragraphs: [{ context: "מזג האוויר היה נאה.", qas: [{ id: "q3", question: "איך היה מזג האוויר?" }] }] },
    ],
  };
  const task = heqRetrieval(heq);
  it("turns HeQ into docs and queries, each question relevant to its own paragraph", () => {
    expect(task.docs.map((d) => d.id)).toEqual(["p0_0", "p1_0", "p2_0"]);
    expect(task.queries[0]).toEqual({ id: "q1", query: "מי חילק מחברת?", relevant: ["p0_0"] });
    expect(() => heqRetrieval({})).toThrow(/SQuAD/);
  });
  it("nDCG@10, binary relevance", () => {
    expect(ndcgAt(["a", "b"], ["a"])).toBe(1);
    expect(ndcgAt(["b", "a"], ["a"])).toBeCloseTo(1 / Math.log2(3));
    expect(ndcgAt(["b"], ["a"])).toBe(0);
  });
  it("runs both lemmatizers (stand-in models) and today's setup, and reports nDCG@10 for each", async () => {
    // Stand-in DictaBERT-lex: right on the first sentence, but it keeps plurals ("ספרים") as they are.
    const LEX: Record<string, string> = { המורה: "מורה", חילקה: "חילק", המחברות: "מחברת", לתלמידים: "תלמיד", בכיתה: "כיתה", חילק: "חילק", מחברת: "מחברת", ספר: "ספר" };
    const lex = dictaLexLemmatizer({ predict: async (ws) => ws.map((w) => LEX[w] ?? w) });
    // Stand-in Shoshan with a bank lookup by word (the bank and scripts above).
    const shoshan: Lemmatizer = shoshanLemmatizer(
      { encode: async (ws) => ws.map((w) => ({ vector: onehot(GUESS[w] ?? LEMMAS.indexOf(w)), script: 0 })) },
      bank,
      inventory,
    );
    const r = await abTest("synthetic-heq", task, [shoshan, lex]);
    expect(Object.keys(r.ndcg10)).toEqual(["none", "shoshan", "dictabert-lex"]);
    for (const v of Object.values(r.ndcg10)) expect(v).toBeGreaterThanOrEqual(0);
    expect(r.ndcg10.shoshan).toBeGreaterThan(r.ndcg10.none);
    expect(r.ndcg10.shoshan).toBeGreaterThanOrEqual(r.ndcg10["dictabert-lex"]);
    expect(await lemmaText("המורה חילקה", IDENTITY)).toBe("המורה חילקה");
  });
  it("Shoshan wins only with ≥ 92 % out of domain AND an nDCG@10 not lower than today's", () => {
    expect(pickLemmatizer({ shoshanOod: 0.924, ndcg: { none: 0.6, shoshan: 0.64 } })).toBe("shoshan");
    expect(pickLemmatizer({ shoshanOod: 0.91, ndcg: { none: 0.6, shoshan: 0.7 } })).toBe("none");
    expect(pickLemmatizer({ shoshanOod: 0.95, ndcg: { none: 0.6, shoshan: 0.59 } })).toBe("none");
    expect(pickLemmatizer({ shoshanOod: null, ndcg: { none: 0.6, shoshan: 0.9 } })).toBe("none");
  });
});

describe("registry", () => {
  const reg = JSON.parse(readFileSync("models/registry.json", "utf8")).models as Record<string, unknown>[];
  it("both candidates are registered, not delivered, and linked to their public benchmarks", () => {
    for (const id of ["HebArabNlpProject/shoshan", "dicta-il/dictabert-lex"]) {
      const e = reg.find((x) => x.id === id)!;
      expect(validateEntry(e), id).toEqual([]);
      expect(e.delivery).toBe("none");
      expect(e.benchmarks).toEqual(["lemma-ud-iahltwiki", "retrieval-heq", "retrieval-mmteb-he"]);
    }
  });
});
