/**
 * DictaBERT-char-menaked, stage 2 of niqqud (plan 6.3 / W2.5): the input
 * and output side in src/text/menaked.ts, with sample model output.
 *
 * The spec and the logits here are SYNTHETIC: a small menaked.json with the
 * shape scripts/models/export-menaked.py writes (character vocab, special
 * ids, the two class lists, tensor names), and hand-made logit tensors laid
 * out as the ONNX head returns them ([rows, length, classes], row-major).
 * Only the ONNX session is replaced; encode → logits → decode → nikudRun is
 * the code the worker runs (src/ai/nikud.worker.ts menakedEngine).
 */
import { describe, expect, it } from "vitest";
import { classMarks, decodeMenaked, encodeMenaked, parseMenakedSpec, type MenakedLogits, type MenakedSpec } from "../text/menaked";
import { addNikudDetailed, type NikudEngine } from "../text/nikudRun";
import { chunks, removeNikud } from "../text/nikud";

const SHEVA = "ְ";
const PATAH = "ַ";
const QAMATS = "ָ";
const HOLAM = "ֹ";
const DAGESH = "ּ";
const SHIN_DOT = "ׁ";
const SIN_DOT = "ׂ";

const LETTERS = "אבגדהוזחטיכךלמםנןסעפףצץקרשת";
/** Synthetic menaked.json: ids 0-4 special, then one id per letter and the space. */
const RAW_SPEC = {
  vocab: Object.fromEntries([...LETTERS, " "].map((c, i) => [c, 5 + i])),
  cls: 2,
  sep: 3,
  pad: 0,
  unk: 1,
  // In the head's order. "<MAT_LECT>" is a special label (a mater lectionis: no mark).
  nikudClasses: ["", SHEVA, PATAH, QAMATS, HOLAM, DAGESH, DAGESH + QAMATS, "<MAT_LECT>"],
  shinClasses: ["", SHIN_DOT, SIN_DOT],
  maxTokens: 12,
  inputs: { ids: "input_ids", mask: "attention_mask" },
  outputs: { nikud: "nikud_logits", shin: "shin_logits" },
};
const spec: MenakedSpec = parseMenakedSpec(RAW_SPEC);
const N = spec.nikudClasses.indexOf.bind(spec.nikudClasses);
const S = spec.shinClasses.indexOf.bind(spec.shinClasses);

/**
 * Logits as the model returns them: for each row and token, a strong logit
 * on the class the table names for that character (by its index in the
 * chunk), small ones elsewhere. `second` puts a close runner-up on a class.
 */
function logitsFor(batch: string[], length: number, pick: (row: number, i: number, c: string) => { n: number; s?: number; second?: number; margin?: number }): MenakedLogits {
  const nN = spec.nikudClasses.length;
  const nS = spec.shinClasses.length;
  const nikud = new Float32Array(batch.length * length * nN).fill(-4);
  const shin = new Float32Array(batch.length * length * nS).fill(-4);
  batch.forEach((chunk, row) => {
    for (let i = 0; i < chunk.length; i++) {
      const at = row * length + i + 1; // token i + 1: after [CLS]
      const p = pick(row, i, chunk[i]);
      nikud[at * nN + p.n] = 6;
      if (p.second != null) nikud[at * nN + p.second] = 6 - (p.margin ?? 0.1);
      shin[at * nS + (p.s ?? 0)] = 6;
    }
  });
  return { nikud, shin };
}

describe("menaked.json", () => {
  it("parses a spec with the export script's fields and refuses anything else", () => {
    expect(spec.maxTokens).toBe(12);
    expect(() => parseMenakedSpec(null)).toThrow("not a DictaBERT-char-menaked spec");
    expect(() => parseMenakedSpec({ ...RAW_SPEC, cls: "2" })).toThrow();
    expect(() => parseMenakedSpec({ ...RAW_SPEC, outputs: { nikud: "n" } })).toThrow();
    expect(() => parseMenakedSpec({ ...RAW_SPEC, nikudClasses: "abc" })).toThrow();
  });
});

describe("encodeMenaked: the model's input", () => {
  it("[CLS] chars [SEP], padded to the longest chunk, int64, mask 1 on real tokens; an unknown character is [UNK]", () => {
    const { ids, mask, length } = encodeMenaked(["שלום", "בא!"], spec);
    expect(length).toBe(6);
    const v = spec.vocab;
    expect([...ids].map(Number)).toEqual([2, v["ש"], v["ל"], v["ו"], v["ם"], 3, 2, v["ב"], v["א"], 1, 3, 0]);
    expect([...mask].map(Number)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0]);
    expect(ids).toBeInstanceOf(BigInt64Array);
  });

  it("the worker's chunks always fit: chunks(text, maxTokens - 1) never needs more than maxTokens", () => {
    const text = "שלום עולם בא ".repeat(7) + "אבגדהוזחטיכלמנסעפצקרשת";
    const parts = chunks(text, spec.maxTokens - 1);
    expect(parts.join("")).toBe(text);
    for (const p of parts) expect(encodeMenaked([p], spec).length).toBeLessThanOrEqual(spec.maxTokens);
  });

  it("a chunk that does not fit, or an empty batch, is an error with the numbers, not a shape error in onnxruntime", () => {
    expect(() => encodeMenaked(["א".repeat(11)], spec)).toThrow("menaked: a chunk of 11 characters is 13 tokens; the model reads at most 12");
    expect(encodeMenaked(["א".repeat(10)], spec).length).toBe(12);
    expect(() => encodeMenaked([], spec)).toThrow("menaked: an empty batch");
  });
});

describe("classMarks: what a class writes on a letter", () => {
  it("only real marks; a special label writes nothing", () => {
    expect(classMarks(QAMATS, "ב")).toBe(QAMATS);
    expect(classMarks("<MAT_LECT>", "ו")).toBe("");
  });
  it("no dagesh where none can stand, no vowel on a letter that takes none, dagesh before the vowel, no shin dot", () => {
    expect(classMarks(DAGESH + QAMATS, "ר")).toBe(QAMATS); // ר takes no dagesh
    expect(classMarks(QAMATS + DAGESH, "ב")).toBe(DAGESH + QAMATS);
    expect(classMarks(QAMATS, "ם")).toBe(""); // final mem: no vowel
    expect(classMarks(SHIN_DOT + QAMATS, "ש")).toBe(QAMATS); // the shin head writes the dot
  });
});

describe("decodeMenaked: the model's output", () => {
  const word = "שלום";
  const table: Record<number, { n: number; s?: number }> = { 0: { n: N(QAMATS), s: S(SHIN_DOT) }, 1: { n: N("") }, 2: { n: N(HOLAM) }, 3: { n: N(QAMATS) } };

  it("שלום → שָׁלוֹם: shin dot and vowel on ש, holam on ו, nothing on the final mem; options per letter", () => {
    const { length } = encodeMenaked([word], spec);
    const r = decodeMenaked(word, logitsFor([word], length, (_r, i) => table[i]), 0, length, spec);
    expect(r.text).toBe(`ש${SHIN_DOT}${QAMATS}לו${HOLAM}ם`);
    expect(removeNikud(r.text)).toBe(word);
    expect(r.options).toHaveLength(4);
    expect(r.options[0]![0].marks).toBe(SHIN_DOT + QAMATS);
    expect(r.options[0]![0].p).toBeGreaterThan(0.9);
    expect(r.options[3]![0].marks).toBe("");
    expect(r.unsure).toEqual([false, false, false, false]);
  });

  it("reads its own row of a batch, skips non-letters, and flags a letter whose best vowel leads by less than half", () => {
    const batch = ["בא", "ב!"];
    const { length } = encodeMenaked(batch, spec);
    const logits = logitsFor(batch, length, (row, i) => (row === 1 && i === 0 ? { n: N(DAGESH + QAMATS), second: N(PATAH), margin: 0.05 } : { n: N(PATAH) }));
    const r0 = decodeMenaked(batch[0], logits, 0, length, spec);
    const r1 = decodeMenaked(batch[1], logits, 1, length, spec);
    expect(r0.text).toBe(`ב${PATAH}א${PATAH}`);
    expect(r1.text).toBe(`ב${DAGESH}${QAMATS}!`);
    expect(r1.options[1]).toBeUndefined();
    expect(r1.unsure).toEqual([true, false]);
    // The runner-up is the second option.
    expect(r1.options[0]!.map((o) => o.marks)).toEqual([DAGESH + QAMATS, PATAH]);
  });

  it("sin dot from the shin head, and a letter that is not ש gets no shin options", () => {
    const w = "שב";
    const { length } = encodeMenaked([w], spec);
    const r = decodeMenaked(w, logitsFor([w], length, (_r, i) => (i === 0 ? { n: N(QAMATS), s: S(SIN_DOT) } : { n: N(PATAH), s: S(SIN_DOT) })), 0, length, spec);
    expect(r.text).toBe(`ש${SIN_DOT}${QAMATS}ב${PATAH}`);
  });
});

describe("the whole stage-2 path: nikudRun with the worker's menaked engine", () => {
  /** src/ai/nikud.worker.ts menakedEngine, with the ONNX session replaced by the synthetic logits. */
  const engine = (pick: Parameters<typeof logitsFor>[2]): NikudEngine => ({
    maxlen: spec.maxTokens - 1,
    async run(batch) {
      const { length } = encodeMenaked(batch, spec);
      const logits = logitsFor(batch, length, pick);
      return batch.map((chunk, row) => decodeMenaked(chunk, logits, row, length, spec));
    },
  });

  it("points a text longer than one chunk, keeps every consonant and space, and strips niqqud it was given", async () => {
    const text = `ש${SHIN_DOT}לום שלום שלום`; // already partly pointed: stage 2 starts from the bare letters
    const vowel = (c: string) => (c === "ש" ? { n: N(QAMATS), s: S(SHIN_DOT) } : c === "ו" ? { n: N(HOLAM) } : { n: N("") });
    const r = await addNikudDetailed(text, engine((_r, _i, c) => vowel(c)));
    const one = `ש${SHIN_DOT}${QAMATS}לו${HOLAM}ם`;
    expect(r.text).toBe(`${one} ${one} ${one}`);
    // One entry per pointed word, at its place in the pointed text, best reading first.
    expect(r.words).toHaveLength(3);
    for (const w of r.words) expect(r.text.slice(w.from, w.to)).toBe(one);
  });

  it("partial mode keeps only the words the model is unsure of", async () => {
    const r = await addNikudDetailed("בא שם", engine((_r, _i, c) => (c === "ש" ? { n: N(QAMATS), second: N(PATAH), margin: 0.05, s: S(SHIN_DOT) } : { n: N(PATAH) })), { partial: true });
    expect(r.text).toBe(`בא ש${SHIN_DOT}${QAMATS}ם`);
  });
});
