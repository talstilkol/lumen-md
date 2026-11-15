/**
 * NER labels → entity types (plan W12.E2).
 *
 * Hebrew: DictaBERT-NER (dicta-il/dictabert-ner, CC BY 4.0) through the
 * W11.H11 seam (#707, ai/ner/entities.ts). Its labels are NEMO's (PER, ORG,
 * GPE, LOC, FAC, EVE, WOA, DUC, ANG) plus TIMEX, TTL and MISC.
 *
 * English: gliner_multi-v2.1 as the candidate (Apache-2.0 on the ONNX
 * card; the original weights' licence is to be confirmed, W12.O1), with
 * dslim/bert-base-NER (MIT; CoNLL-03 labels PER, ORG, LOC, MISC) as the
 * fallback. Neither is in the converted-model registry yet: the int8 ONNX
 * export with its sha256 is W12.M1 (Mac). Until a model is on the device
 * the extractor runs on rules only, and says so.
 */
import type { EntityType } from "../model";

/** NEMO / DictaBERT-NER label → our type; null = not an entity of the graph. */
export const NEMO_TO_TYPE: Readonly<Record<string, EntityType | null>> = {
  PER: "person",
  ORG: "organization",
  GPE: "place",
  LOC: "place",
  FAC: "place",
  EVE: "event",
  WOA: "source",
  DUC: "concept",
  ANG: "concept",
  TIMEX: "event",
  TTL: null,
  MISC: null,
  INFORMAL: null,
};

/** GLiNER is zero-shot: these label prompts, each with its type. */
export const GLINER_LABELS: ReadonlyArray<readonly [string, EntityType]> = [
  ["person", "person"],
  ["organization", "organization"],
  ["location", "place"],
  ["event", "event"],
  ["date", "event"],
  ["law", "law"],
  ["book or scripture", "source"],
  ["concept", "concept"],
];

/** CoNLL-03 labels (bert-base-NER). */
export const CONLL_TO_TYPE: Readonly<Record<string, EntityType | null>> = { PER: "person", ORG: "organization", LOC: "place", MISC: null };

export interface ModelCandidate {
  id: string;
  repo: string;
  lang: "he" | "en";
  license: string;
  /** Where the licence was read; "to confirm" when only a derivative's card states it. */
  licenseSource: string;
  role: "primary" | "candidate" | "fallback";
  /** sha256 of the int8 ONNX, once exported (W12.M1); null until then — never downloaded without it. */
  sha256: string | null;
}

export const NER_MODELS: readonly ModelCandidate[] = [
  { id: "dictabert-ner", repo: "dicta-il/dictabert-ner", lang: "he", license: "CC-BY-4.0", licenseSource: "https://huggingface.co/dicta-il/dictabert-ner", role: "primary", sha256: null },
  { id: "gliner-multi-v2.1", repo: "urchade/gliner_multi-v2.1", lang: "en", license: "Apache-2.0 (ONNX card; original to confirm, W12.O1)", licenseSource: "https://huggingface.co/juampahc/gliner_multi-v2.1-onnx", role: "candidate", sha256: null },
  { id: "bert-base-ner", repo: "dslim/bert-base-NER", lang: "en", license: "MIT", licenseSource: "https://huggingface.co/dslim/bert-base-NER", role: "fallback", sha256: null },
];

export const typeOfLabel = (label: string, scheme: "nemo" | "conll" = "nemo"): EntityType | null => (scheme === "nemo" ? NEMO_TO_TYPE[label.toUpperCase()] : CONLL_TO_TYPE[label.toUpperCase()]) ?? null;
