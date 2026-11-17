/**
 * GLiNER (urchade/GLiNER, Apache-2.0) exported to ONNX, as an engine module
 * (W11.M3, W12.M1): zero-shot entity spans for labels given as words. The
 * model's own Python package exports it (convert_to_onnx.py, see
 * plan/mac-pack/FC2.json FC2.gliner-export); here onnxruntime-node runs it
 * and the tokenizer comes from transformers.js, both from a local folder.
 *
 *   LUMEN_GLINER_DIR        the folder: model.onnx (or onnx/model.onnx), tokenizer.json, gliner_config.json
 *   LUMEN_GLINER_LABELS     JSON { "<label words>": "<type>" }; default: NEMO's types in English words
 *   LUMEN_GLINER_THRESHOLD  default 0.5
 *
 * The same interface as dictabert-ner.mjs: tag(tokens) for eval:public,
 * extract(text) for eval-entity-graph and the redactor's golden harness.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeGliner, fileDigest, glinerInputs, joinTokens, spansToBio, words } from "./ner-core.mjs";

/** NEMO's types (PER ORG GPE LOC FAC EVE WOA DUC ANG) as GLiNER labels. */
export const NEMO_LABELS = { person: "PER", organization: "ORG", "country or city": "GPE", location: "LOC", facility: "FAC", event: "EVE", "work of art": "WOA", product: "DUC", language: "ANG" };

/**
 * The engine around a GLiNER runner: `run(feeds) → logits [L*K*C]` for one
 * text, `tok` the tokenizer ({ encode, cls, sep }).
 */
export function glinerEngine({ id, digest, tok, run, labels = NEMO_LABELS, threshold = 0.5, maxWidth = 12 }) {
  const names = Object.keys(labels);
  const types = Object.values(labels);
  const spansOfWords = async (ws) => {
    if (!ws.length) return [];
    const feeds = glinerInputs(tok, ws, names, maxWidth);
    const logits = await run(feeds);
    if (logits.length !== feeds.L * feeds.K * names.length) throw new Error(`gliner: ${logits.length} logits for ${feeds.L} words × ${feeds.K} widths × ${names.length} labels`);
    return decodeGliner(logits, feeds.L, feeds.K, names.length, threshold).map((s) => ({ ...s, type: types[s.label] }));
  };
  return {
    id,
    digest,
    async extract(text) {
      const ws = words(text);
      return (await spansOfWords(ws.map((w) => w.w))).map((s) => ({ start: ws[s.start].start, end: ws[s.end].end, type: s.type }));
    },
    async tag(tokens) {
      const { offsets } = joinTokens(tokens);
      const spans = await spansOfWords(tokens);
      return spansToBio(offsets, spans.map((s) => ({ start: offsets[s.start].start, end: offsets[s.end].end, type: s.type })));
    },
  };
}

/** onnxruntime-node feeds from glinerInputs (int64 ids, bool masks). */
export function ortFeeds(ort, f) {
  const T = f.input_ids.length;
  const i64 = (xs) => BigInt64Array.from(xs.map((x) => BigInt(x)));
  return {
    input_ids: new ort.Tensor("int64", i64(f.input_ids), [1, T]),
    attention_mask: new ort.Tensor("int64", i64(f.attention_mask), [1, T]),
    words_mask: new ort.Tensor("int64", i64(f.words_mask), [1, T]),
    text_lengths: new ort.Tensor("int64", i64(f.text_lengths), [1, 1]),
    span_idx: new ort.Tensor("int64", i64(f.span_idx), [1, f.L * f.K, 2]),
    span_mask: new ort.Tensor("bool", Uint8Array.from(f.span_mask.map((b) => (b ? 1 : 0))), [1, f.L * f.K]),
  };
}

export async function makeGliner(env = process.env, deps = {}) {
  const dir = env.LUMEN_GLINER_DIR;
  if (!dir) throw new Error("set LUMEN_GLINER_DIR to the GLiNER ONNX export (see plan/mac-pack/FC2.json, FC2.gliner-export)");
  const model = [join(dir, "model.onnx"), join(dir, "onnx", "model.onnx")].find((p) => existsSync(p));
  if (!model && !deps.run) throw new Error(`LUMEN_GLINER_DIR: no model.onnx in ${dir}`);
  const cfgPath = join(dir, "gliner_config.json");
  const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : {};
  const labels = env.LUMEN_GLINER_LABELS ? JSON.parse(env.LUMEN_GLINER_LABELS) : NEMO_LABELS;
  let tok = deps.tok;
  if (!tok) {
    const tf = await import("@huggingface/transformers");
    tf.env.allowRemoteModels = false;
    const t = await tf.AutoTokenizer.from_pretrained(dir);
    tok = { encode: (s) => t.encode(s, { add_special_tokens: false }), cls: t.cls_token_id ?? t.model.tokens_to_ids.get("[CLS]"), sep: t.sep_token_id ?? t.model.tokens_to_ids.get("[SEP]") };
  }
  let run = deps.run;
  if (!run) {
    const ort = await import("onnxruntime-node");
    const session = await ort.InferenceSession.create(model);
    run = async (f) => (await session.run(ortFeeds(ort, f))).logits.data;
  }
  return glinerEngine({ id: `gliner:${cfg.model_name ?? "onnx"}`, digest: deps.digest ?? (await fileDigest(model)), tok, run, labels, threshold: Number(env.LUMEN_GLINER_THRESHOLD || 0.5), maxWidth: Number(cfg.max_width || 12) });
}

export default async () => makeGliner();
