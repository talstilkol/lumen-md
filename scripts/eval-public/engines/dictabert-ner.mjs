/**
 * DictaBERT-NER (dicta-il/dictabert-ner, CC BY 4.0) as an engine module
 * (W11.M3, W12.M1, plan 2.6): the ONNX export scripts/models/convert.mjs
 * writes, run in Node by transformers.js (`@huggingface/transformers`, the
 * app's own dependency) from a local folder. Nothing is downloaded: remote
 * models are switched off.
 *
 *   LUMEN_NER_MODEL   the converted model folder (it holds config.json, tokenizer.json, onnx/)
 *   LUMEN_NER_DTYPE   q8 (default, the app's) | fp32
 *
 * One module, three callers:
 *   eval:public  run ner-nemo / ner-bmc   → tag(tokens)  (one B-/I- tag per token)
 *   eval-entity-graph.mjs ner             → extract(text) (character spans, every type)
 *   scripts/golden/evals/ner-pii.mjs      → extract(text), PER kept, as the redactor's names finder
 */
import { join } from "node:path";
import { existsSync } from "node:fs";
import { alignPieces, fileDigest, joinTokens, spansToBio } from "./ner-core.mjs";

/** The engine around a token-classification pipeline: `pipe(text)` → pieces. */
export function nerEngine(id, digest, pipe) {
  const extract = async (text) => alignPieces(text, await pipe(text));
  return {
    id,
    digest,
    extract,
    async tag(tokens) {
      const { text, offsets } = joinTokens(tokens);
      return spansToBio(offsets, await extract(text));
    },
  };
}

/** The ONNX file the dtype loads (transformers.js naming). */
export const onnxFile = (dir, dtype) => join(dir, "onnx", dtype === "fp32" ? "model.onnx" : "model_quantized.onnx");

export async function makeDictaBertNer(env = process.env, deps = {}) {
  const dir = env.LUMEN_NER_MODEL;
  if (!dir) throw new Error("set LUMEN_NER_MODEL to the converted DictaBERT-NER folder (npm run models:convert -- --models dictabert-ner)");
  if (!existsSync(dir) && !deps.pipeline) throw new Error(`LUMEN_NER_MODEL: no folder at ${dir}`);
  const dtype = env.LUMEN_NER_DTYPE || "q8";
  const tf = deps.transformers ?? (await import("@huggingface/transformers"));
  tf.env.allowRemoteModels = false;
  tf.env.allowLocalModels = true;
  const pipe = await (deps.pipeline ?? tf.pipeline)("token-classification", dir, { dtype });
  const digest = deps.digest ?? (await fileDigest(onnxFile(dir, dtype)));
  return nerEngine(`dictabert-ner:${dtype}`, digest, (text) => pipe(text));
}

export default async () => makeDictaBertNer();
