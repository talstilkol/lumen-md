/**
 * ProtectAI deberta-v3-base-prompt-injection-v2 (Apache-2.0) as an engine
 * module (plan 2.7): sequence-classification logits from transformers.js
 * in Node, from a local folder (its Hugging Face repo ships onnx/model.onnx;
 * or Lumen's q8 conversion). Remote models are switched off.
 *
 *   LUMEN_INJECTION_MODEL   the model folder (config.json, tokenizer.json, onnx/)
 *   LUMEN_INJECTION_DTYPE   fp32 (default: the repo's onnx/model.onnx) | q8
 *
 * → { id, digest, labels, logits(texts) → row-major [texts, labels] }, the
 * `run` that src/agents/injectionClassifier.ts's protectAiClassifier takes.
 */
import { join } from "node:path";
import { fileDigest } from "./ner-core.mjs";

export async function makeProtectAi(env = process.env, deps = {}) {
  const dir = env.LUMEN_INJECTION_MODEL;
  if (!dir) throw new Error("set LUMEN_INJECTION_MODEL to a local copy of protectai/deberta-v3-base-prompt-injection-v2 (see plan/mac-pack/FC2.json)");
  const dtype = env.LUMEN_INJECTION_DTYPE || "fp32";
  const tf = deps.transformers ?? (await import("@huggingface/transformers"));
  tf.env.allowRemoteModels = false;
  tf.env.allowLocalModels = true;
  const [tokenizer, model] = await Promise.all([tf.AutoTokenizer.from_pretrained(dir), tf.AutoModelForSequenceClassification.from_pretrained(dir, { dtype })]);
  const id2label = model.config?.id2label ?? {};
  const labels = Object.keys(id2label).sort((a, b) => Number(a) - Number(b)).map((k) => id2label[k]);
  const digest = deps.digest ?? (await fileDigest(join(dir, "onnx", dtype === "fp32" ? "model.onnx" : "model_quantized.onnx")));
  return {
    id: `protectai-v2:${dtype}`,
    digest,
    labels,
    async logits(texts) {
      const out = [];
      for (let i = 0; i < texts.length; i += 8) {
        const inputs = tokenizer(texts.slice(i, i + 8), { padding: true, truncation: true, max_length: 512 });
        const { logits } = await model(inputs);
        for (const row of logits.tolist()) out.push(...row);
      }
      return out;
    },
  };
}

export default async () => makeProtectAi();
