/**
 * W12.E9 — the entity-graph eval adapters. Real runs (NEMO, BMC, HeRE) are
 * owed to the Mac (W12.M1); here the adapters run on SYNTHETIC samples
 * written in the published formats (CoNLL-U with multiword tokens, NEMO
 * morpheme BIOSE, CoNLL token tags, HeRE's gold fields), and every report
 * this produces is tagged `dev` — never `public`.
 */
import { describe, expect, it } from "vitest";
import { parseConll } from "../eval/public/adapters/ner";
import { bootstrapCi, evalCard, goldPrefix, HERE_REFERENCE, mapNemoTags, mentionNames, parseHere, parseSegmented, pipelineEngine, scoreBinary, scoreHere, scorePipelineNer, scorePrefixes, verifyTriple } from "../eval/public/adapters/entityGraph";
import { ruleHits } from "../entities/extract/rules";
import type { Executor } from "../agents/types";
import { DATAMARK, unmarkData } from "../agents/untrusted";

// SYNTHETIC: two sentences in UD CoNLL-U shape (ID FORM … ), with multiword tokens.
const CONLLU = [
  "# sent_id = syn-1",
  "1-2\tבירושלים\t_\t_\t_\t_\t_\t_\t_\t_",
  "1\tב\t_\tADP\t_\t_\t_\t_\t_\t_",
  "2\tירושלים\t_\tPROPN\t_\t_\t_\t_\t_\t_",
  "3\tגר\t_\tVERB\t_\t_\t_\t_\t_\t_",
  "4\tמשה\t_\tPROPN\t_\t_\t_\t_\t_\t_",
  "",
  "# sent_id = syn-2",
  "1-3\tובכנסת\t_\t_\t_\t_\t_\t_\t_\t_",
  "1\tו\t_\tCCONJ\t_\t_\t_\t_\t_\t_",
  "2\tב\t_\tADP\t_\t_\t_\t_\t_\t_",
  "3\tהכנסת\t_\tPROPN\t_\t_\t_\t_\t_\t_",
  "4-5\tלברק\t_\t_\t_\t_\t_\t_\t_\t_",
  "4\tל\t_\tADP\t_\t_\t_\t_\t_\t_",
  "5\tברק\t_\tPROPN\t_\t_\t_\t_\t_\t_",
  "",
].join("\n");
// SYNTHETIC morpheme tags, one per word line.
const MORPH = ["ב O", "ירושלים S-GPE", "גר O", "משה S-PER", "", "ו O", "ב O", "הכנסת S-ORG", "ל O", "ברק S-PER", ""].join("\n");

describe("W12.E9 prefix segmentation against gold morphemes (synthetic sample)", () => {
  const sents = parseSegmented(CONLLU, MORPH);
  it("reads multiword tokens with their gold morphemes", () => {
    expect(sents.map((s) => s.map((t) => t.surface))).toEqual([["בירושלים", "גר", "משה"], ["ובכנסת", "לברק"]]);
    expect(sents[1][0].morphs.map((m) => m.form)).toEqual(["ו", "ב", "הכנסת"]);
  });
  it("gold prefix: letters before the mention; a swallowed article takes none", () => {
    expect(sents.flat().map(goldPrefix)).toEqual(["ב", null, "", "וב", "ל"]);
  });
  it("scores the resolver with a gazetteer from another split", () => {
    const gaz = mentionNames(sents);
    expect(gaz.sort()).toEqual(["ברק", "הכנסת", "ירושלים", "משה"].sort());
    const s = scorePrefixes(sents, gaz);
    expect([s.n, s.accuracy, s.under, s.over]).toEqual([4, 1, 0, 0]);
    const blind = scorePrefixes(sents, []);
    expect(blind.under).toBe(3); // nothing known: nothing is cut (conservative)
  });
  it("rejects misaligned tag files", () => {
    expect(() => parseSegmented(CONLLU, "ב O\n\nx O")).toThrow(/tags/);
  });
});

describe("W12.E9 NER through the pipeline (synthetic sample)", () => {
  it("maps NEMO tags onto our types and scores rules-only extraction", async () => {
    expect(mapNemoTags(["B-PER", "I-PER", "S-TTL", "E-GPE", "O"])).toEqual(["B-person", "I-person", "O", "E-place", "O"]);
    const conll = ["חוק\tB-ORG", "חופש\tI-ORG", "המידע\tI-ORG", "נחקק\tO", "ב-15\tB-TIMEX", "בנובמבר\tI-TIMEX", "2026\tE-TIMEX", ""].join("\n");
    const engine = pipelineEngine("rules", async (t) => ruleHits(t).map((h) => ({ start: h.start, end: h.end, type: h.type })));
    const score = await scorePipelineNer(parseConll(conll), engine);
    expect(score.byType.event).toMatchObject({ gold: 1, precision: 1, recall: 1 });
    expect(score.byType.organization.recall).toBe(0);
  });
});

describe("W12.E9 HeRE (synthetic rows in the gold fields)", () => {
  const rows = parseHere(
    [
      { item_id: "S1", docid: 1, title: "t", text: "דנה היא זמרת ישראלית.", subject: "דנה", predicate: "עיסוק", object: "זמרת", label: 1 },
      { item_id: "S2", docid: 2, title: "t", text: "דנה גרה בעיר.", subject: "דנה", predicate: "עיסוק", object: "זמרת", label: 0 },
      { item_id: "S3", docid: 3, title: "t", text: "הנהר גובל בעמק.", subject: "הנהר", predicate: "גובל עם", object: "העמק", label: 1 },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n"),
  );
  const local = (answers: Record<string, string>): Executor =>
    ({
      id: "ollama",
      label: "s",
      available: async () => ({ available: true }),
      supportsTools: () => false,
      supportsSchema: () => true,
      modelFor: () => "m",
      // A model reads through the datamarks the passage carries (W11.I3), so the fake matches the unmarked text.
      chat: async (req: { messages: Array<{ content: string }> }) => ({ content: answers[Object.keys(answers).find((k) => unmarkData(req.messages[1].content).includes(k))!] ?? "{}", toolCalls: [], model: "m" }),
    }) as unknown as Executor;
  it("supported only with a verified quote; F1 of the positive class", async () => {
    const ex = local({
      // The quote comes back with the passage's datamarks, as a model copies it: still verified.
      "זמרת ישראלית": `{"supported": true, "quote": "${["דנה", "היא", "זמרת"].join(DATAMARK)}"}`,
      "גרה בעיר": '{"supported": true, "quote": "דנה היא זמרת"}', // quote not in this passage → no
      "גובל בעמק": '{"supported": true}', // no quote → no
    });
    const s = await scoreHere(rows, (r) => verifyTriple(ex, r));
    expect([s.precision, s.recall, s.f1, s.accuracy]).toEqual([1, 0.5, 0.6667, 0.6667]);
    expect(HERE_REFERENCE.f1).toBe(0.844);
  });
  it("refuses a cloud executor", async () => {
    await expect(verifyTriple({ ...local({}), id: "chat" } as Executor, rows[0])).rejects.toThrow(/local/);
  });
  it("rejects a row without a label", () => {
    expect(() => parseHere('{"text":"a","subject":"b","predicate":"c","object":"d"}')).toThrow(/label/);
  });
});

describe("W12.E9 cards: a shim or synthetic run is dev", () => {
  it("dev unless public is asked AND a source is named", () => {
    const base = { model: { name: "lumen-rules@1", digest: "rules" }, dataset: { name: "synthetic", version: "0", license: "synthetic" }, n: 3, metrics: { f1: { value: 0.5, ci95: [0.4, 0.6] as [number, number] } } };
    expect(evalCard({ ...base, public: false }).tag).toBe("dev");
    expect(evalCard({ ...base, public: true }).tag).toBe("dev");
    expect(evalCard({ ...base, public: true, dataset: { ...base.dataset, source: "https://huggingface.co/datasets/ronke21/HeRE" } }).tag).toBe("public");
    const card = evalCard({ ...base, public: false });
    for (const k of ["schema", "tag", "model", "seed", "temperature", "dataset", "n", "metrics"]) expect(card).toHaveProperty(k);
    expect(card.metrics.f1.method).toBe("bootstrap");
  });
  it("bootstrap CI is seeded and brackets the value", () => {
    const pairs = scoreBinary([[1, 1], [1, 0], [0, 0], [0, 1], [1, 1], [1, 1]]).pairs;
    const ci = bootstrapCi(pairs, (xs) => scoreBinary(xs).f1);
    expect(ci).toEqual(bootstrapCi(pairs, (xs) => scoreBinary(xs).f1));
    expect(ci[0]).toBeLessThanOrEqual(scoreBinary(pairs).f1);
    expect(ci[1]).toBeGreaterThanOrEqual(scoreBinary(pairs).f1);
  });
});
