/**
 * The shared parts of the NER engine modules (W11.M3, W12.M1, plan 2.6):
 * words with offsets, B-/I- tags to spans and back, the alignment of
 * WordPiece output (transformers.js `token-classification`) with the text,
 * and GLiNER's ONNX input layout and span decoder.
 *
 * No model here: the modules (dictabert-ner.mjs, gliner.mjs) load theirs
 * on the Mac and hand the outputs to these pure functions, which the
 * cloud tests check.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";

/** Words with character offsets: letters/digits (Hebrew geresh and gershayim inside a word), or one other non-space character. */
export function words(text) {
  const out = [];
  for (const m of text.matchAll(/[\p{L}\p{M}\p{N}_]+(?:[-_'’׳״"][\p{L}\p{M}\p{N}_]+)*׳?|\S/gu)) out.push({ w: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

/** Given tokens (as a corpus splits them), the text they stand for (joined by spaces) and each token's offsets. */
export function joinTokens(tokens) {
  const offsets = [];
  let pos = 0;
  for (const t of tokens) {
    offsets.push({ start: pos, end: pos + t.length });
    pos += t.length + 1;
  }
  return { text: tokens.join(" "), offsets };
}

/** The entity type of a tag: "B-PER" → "PER", "I-ORG" → "ORG", "O" → null. NEMO's E-/S- (BIOES) are read too. */
export const typeOf = (tag) => (!tag || tag === "O" ? null : tag.replace(/^[BIESL]-/, ""));

/** Spans (character offsets) → one B-/I-/O tag per token: a token is tagged when a span covers part of it. */
export function spansToBio(offsets, spans) {
  const tags = offsets.map(() => "O");
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    let first = true;
    offsets.forEach((o, i) => {
      if (o.end > s.start && o.start < s.end && tags[i] === "O") {
        tags[i] = `${first ? "B" : "I"}-${s.type}`;
        first = false;
      }
    });
  }
  return tags;
}

/** B-/I- (or BIOES) tags per token → spans over the tokens' offsets. */
export function bioToSpans(offsets, tags) {
  const out = [];
  let cur = null;
  tags.forEach((tag, i) => {
    const type = typeOf(tag);
    const begins = /^[BS]-/.test(tag ?? "") || (type && (!cur || cur.type !== type));
    if (!type) cur = null;
    else if (begins) {
      cur = { start: offsets[i].start, end: offsets[i].end, type };
      out.push(cur);
    } else cur.end = offsets[i].end;
    if (/^[ES]-/.test(tag ?? "")) cur = null;
  });
  return out;
}

/**
 * transformers.js token-classification output (no offsets: `word` is the
 * WordPiece, `##` for a continuation) → character spans of every type.
 * A piece found nowhere ahead of the cursor is skipped, not guessed.
 */
export function alignPieces(text, pieces, minScore = 0.5) {
  const out = [];
  let cursor = 0;
  let cur = null;
  for (const p of pieces) {
    const piece = String(p.word ?? "").replace(/^##/, "").replace(/^▁/, "");
    if (!piece) continue;
    const at = text.indexOf(piece, cursor);
    if (at < 0) continue;
    const cont = String(p.word).startsWith("##");
    cursor = at + piece.length;
    const type = typeOf(p.entity);
    if (!type || (p.score ?? 1) < minScore) {
      if (!cont) cur = null;
      continue;
    }
    const gapIsSpace = cur && /^\s*$/.test(text.slice(cur.end, at)) && text.slice(cur.end, at).length <= 1;
    if (cur && cur.type === type && (cont || (/^I-/.test(p.entity) && gapIsSpace))) cur.end = at + piece.length;
    else {
      cur = { start: at, end: at + piece.length, type };
      out.push(cur);
    }
  }
  // A span that ends inside a word reaches the word's end (a prefix tagged, the rest a continuation).
  for (const s of out) while (s.end < text.length && /[\p{L}\p{M}\p{N}]/u.test(text[s.end])) s.end++;
  return out;
}

/* ─── GLiNER (urchade/GLiNER, Apache-2.0) as exported to ONNX ────────── */

/**
 * The model's inputs for one text, as GLiNER's processor builds them: the
 * prompt `<<ENT>> label … <<SEP>>` then the text words, each element
 * tokenized on its own; `words_mask` gives the first sub-token of text word
 * i the value i + 1. `encode(s)` returns sub-token ids without specials.
 */
export function glinerInputs(tok, textWords, labels, maxWidth = 12) {
  const prompt = labels.flatMap((l) => ["<<ENT>>", l]).concat("<<SEP>>");
  const ids = [tok.cls];
  const mask = [0];
  for (const p of prompt) for (const id of tok.encode(p)) (ids.push(id), mask.push(0));
  textWords.forEach((w, i) => {
    tok.encode(w).forEach((id, j) => (ids.push(id), mask.push(j === 0 ? i + 1 : 0)));
  });
  ids.push(tok.sep);
  mask.push(0);
  const L = textWords.length;
  const spanIdx = [];
  const spanMask = [];
  for (let i = 0; i < L; i++) for (let k = 0; k < maxWidth; k++) (spanIdx.push(i, i + k), spanMask.push(i + k < L));
  return { input_ids: ids, attention_mask: ids.map(() => 1), words_mask: mask, text_lengths: [L], span_idx: spanIdx, span_mask: spanMask, L, K: maxWidth };
}

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/**
 * Logits [L, K, C] (row-major, one text) → non-overlapping word spans
 * { start, end (inclusive word index), label index, score }, greedy by
 * score, as GLiNER's `flat_ner` decoder.
 */
export function decodeGliner(logits, L, K, C, threshold = 0.5) {
  const cands = [];
  for (let i = 0; i < L; i++)
    for (let k = 0; k < K; k++) {
      if (i + k >= L) continue;
      for (let c = 0; c < C; c++) {
        const p = sigmoid(logits[(i * K + k) * C + c]);
        if (p > threshold) cands.push({ start: i, end: i + k, label: c, score: p });
      }
    }
  cands.sort((a, b) => b.score - a.score || a.start - b.start);
  const taken = [];
  for (const s of cands) if (!taken.some((t) => s.start <= t.end && t.start <= s.end)) taken.push(s);
  return taken.sort((a, b) => a.start - b.start);
}

/** sha256 of a file (the engine's digest: which weights ran). */
export function fileDigest(path) {
  return new Promise((resolve, reject) => {
    if (!existsSync(path)) return reject(new Error(`no model file at ${path}`));
    const h = createHash("sha256");
    createReadStream(path).on("data", (d) => h.update(d)).on("end", () => resolve(`sha256:${h.digest("hex")}`)).on("error", reject);
  });
}
