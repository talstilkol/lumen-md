/**
 * The prompt-injection classifier seam (plan 2.7, W10.E66).
 *
 * untrusted.ts cleans outside text with rules: deterministic, Hebrew and
 * English. A classifier is an extra layer on top. It is a model that scores
 * each passage of the cleaned text, and a passage at or over its threshold
 * is flagged like a rule match: kept, with a visible marker. It never replaces
 * the rules, and it never decides a tool call. The runtime's approval gate
 * still does that.
 *
 * Nothing is registered by default. The app works the same with no classifier,
 * and a classifier that fails or times out is skipped (the rules have run).
 * The one planned classifier is ProtectAI's deberta-v3-base-prompt-injection-v2
 * (Apache-2.0, English only): `protectAiClassifier` turns its logits into
 * scores, and ./protectAi.ts registers it once the model is on this device
 * (converted and hosted: 6.0, 15.9).
 */

/** A model that scores passages: the probability each one is an injection attempt. */
export interface InjectionClassifier {
  /** Shown in the cleaning summary and the run's step detail, e.g. "protectai-v2". */
  id: string;
  /** Flag at or above this (0..1). */
  threshold: number;
  /** One score per passage, in order. */
  classify(passages: string[], signal?: AbortSignal): Promise<number[]>;
}

let current: InjectionClassifier | null = null;

/** Register the classifier (null removes it). Returns the previous one. */
export function setInjectionClassifier(c: InjectionClassifier | null): InjectionClassifier | null {
  const prev = current;
  current = c;
  return prev;
}

export const getInjectionClassifier = (): InjectionClassifier | null => current;

/** Longest passage a classifier is given, in characters (about 512 DeBERTa tokens of English). */
export const MAX_PASSAGE_CHARS = 1500;
/** A classifier that does not answer by then is skipped for this text. */
export const CLASSIFY_TIMEOUT_MS = 4000;

/**
 * The passages of a text: paragraphs (blank-line separated), each cut at a
 * line break into pieces of at most `max` characters, a single long line
 * by length. → [{ start, end }] offsets into `text`, covering every
 * non-blank character once.
 */
export function passages(text: string, max = MAX_PASSAGE_CHARS): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  const re = /[^\n]*(?:\n(?![ \t]*\n)[^\n]*)*/g;
  for (const m of text.matchAll(re)) {
    if (!m[0].trim()) continue;
    // A match can start on the blank lines before its paragraph: start at its first non-blank line.
    let s = m.index! + (m[0].length - m[0].replace(/^\s*\n/, "").length);
    const e = m.index! + m[0].length;
    while (e - s > max) {
      const nl = text.lastIndexOf("\n", s + max);
      const cut = nl > s ? nl : s + max;
      out.push({ start: s, end: cut });
      s = nl > s ? nl + 1 : cut;
    }
    if (text.slice(s, e).trim()) out.push({ start: s, end: e });
  }
  return out;
}

/**
 * ProtectAI deberta-v3-base-prompt-injection-v2 behind the seam. `run` is
 * the model: batch in, logits out, row-major [passages, labels]. `labels`
 * is the checkpoint's id2label in index order (["SAFE", "INJECTION"]).
 */
export function protectAiClassifier(run: (passages: string[], signal?: AbortSignal) => Promise<ArrayLike<number>>, labels: readonly string[] = ["SAFE", "INJECTION"], threshold = 0.5): InjectionClassifier {
  const at = labels.indexOf("INJECTION");
  if (at < 0) throw new Error(`protectai: no INJECTION label in ${JSON.stringify(labels)}`);
  return {
    id: "protectai-v2",
    threshold,
    async classify(texts, signal) {
      const logits = await run(texts, signal);
      if (logits.length !== texts.length * labels.length) throw new Error(`protectai: ${logits.length} logits for ${texts.length} passages × ${labels.length} labels`);
      return texts.map((_, i) => injectionProbability(logits, i, labels.length, at));
    },
  };
}

/** Softmax of row `row` of row-major logits, at `label`. */
export function injectionProbability(logits: ArrayLike<number>, row: number, classes: number, label: number): number {
  let max = -Infinity;
  for (let k = 0; k < classes; k++) max = Math.max(max, logits[row * classes + k]);
  let sum = 0;
  for (let k = 0; k < classes; k++) sum += Math.exp(logits[row * classes + k] - max);
  return Math.exp(logits[row * classes + label] - max) / sum;
}

/** A passage the classifier flagged. */
export interface ClassifierHit {
  start: number;
  end: number;
  p: number;
}

/**
 * Score the passages of `text` with the registered classifier → the ones at
 * or over its threshold. With no classifier, or when it throws or takes
 * longer than `timeoutMs`, → null (nothing was classified).
 * `skip` leaves out passages that need no model (already flagged by a rule).
 */
export async function classifyText(text: string, opts: { classifier?: InjectionClassifier | null; skip?: (passage: string) => boolean; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<{ id: string; hits: ClassifierHit[] } | null> {
  const c = opts.classifier === undefined ? current : opts.classifier;
  if (!c) return null;
  const parts = passages(text).filter((p) => !opts.skip?.(text.slice(p.start, p.end)));
  if (!parts.length) return { id: c.id, hits: [] };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const scores = await Promise.race([
      c.classify(
        parts.map((p) => text.slice(p.start, p.end)),
        opts.signal,
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), opts.timeoutMs ?? CLASSIFY_TIMEOUT_MS);
      }),
    ]);
    return { id: c.id, hits: parts.flatMap((p, i) => (scores[i] >= c.threshold ? [{ ...p, p: scores[i] }] : [])) };
  } catch {
    // why: the classifier is an extra layer; the rules already ran, and the approval gate still holds.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
