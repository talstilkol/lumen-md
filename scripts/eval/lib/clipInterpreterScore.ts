/**
 * Scoring for the clip-interpreter eval (plan W2.14). Deterministic, so a
 * run against a real local model gives a number that compares between
 * models and releases.
 *
 * Acceptance (W2.14):
 *  1. ≥ 85 % of the fields right on the 20 golden pages;
 *  2. 0 requests off the device;
 *  3. every clip with interpretation under 10 s with a 3B model.
 *
 * A page field (title, author, dates) is right when the note's value starts
 * with the expected one. A prompt field (summary, topics...) is right when
 * the model's answer is in the page's language, has the asked shape (one
 * sentence of at most 300 characters, or a list of 3–5 comma-separated
 * items), and names at least one of the page's key terms (niqqud, final
 * letters and Hebrew one-letter prefixes do not matter). Both kinds count
 * toward criterion 1, and the prompt fields alone must reach it too, so
 * the page's own metadata cannot carry a model that answers nothing.
 */
import { hebrewRatio, normalizeForMatch, prefixVariants } from "../../../src/text/hebrew";

export interface FieldExpectation {
  /** "sentence": one sentence; "list": comma-separated items. */
  kind: "sentence" | "list";
  /** The page's language: the answer must be in it. */
  lang: "he" | "en";
  /** At least one of these must appear in the answer. */
  anyOf: string[];
  /** For a list: the item count bounds. */
  min?: number;
  max?: number;
}

export const FIELD_SHARE_MIN = 0.85;
export const CLIP_MS_MAX = 10_000;
export const MAX_SENTENCE_CHARS = 300;

/** Words of an answer, normalised, each with its prefix-less forms. */
function forms(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of normalizeForMatch(text).match(/[\p{L}\p{N}'"-]+/gu) ?? []) for (const v of prefixVariants(w)) out.add(v);
  return out;
}

/** Does `answer` name `term` (a word or phrase; a Hebrew word may carry prefixes; an English word may be inflected)? */
export function namesTerm(answer: string, term: string): boolean {
  const a = normalizeForMatch(answer);
  const t = normalizeForMatch(term).trim();
  if (!t) return false;
  if (a.includes(t)) return true;
  const words = t.split(/\s+/);
  const have = forms(answer);
  // Every word of the term, as a word of the answer or a prefixed / inflected form of one.
  return words.every((w) => have.has(w) || [...have].some((h) => h.startsWith(w) && h.length - w.length <= 3));
}

export interface FieldVerdict {
  ok: boolean;
  why: string;
}

/** Judge one prompt answer. */
export function judgeField(answer: string, e: FieldExpectation): FieldVerdict {
  const v = answer.trim();
  if (!v) return { ok: false, why: "empty" };
  const he = hebrewRatio(v);
  if (e.lang === "he" && he < 0.5) return { ok: false, why: `not Hebrew (${Math.round(he * 100)} % Hebrew letters)` };
  if (e.lang === "en" && he > 0.2) return { ok: false, why: `not English (${Math.round(he * 100)} % Hebrew letters)` };
  if (e.kind === "sentence") {
    if (v.length > MAX_SENTENCE_CHARS) return { ok: false, why: `${v.length} characters, more than ${MAX_SENTENCE_CHARS}` };
    // More than one sentence: a sentence end followed by more text.
    if (/[.!?](?:\s+\S)/.test(v.replace(/\b(?:[A-Z]|e\.g|i\.e|etc|vs|Dr|Mr|Mrs|Ms)\./g, "_"))) return { ok: false, why: "more than one sentence" };
  } else {
    const items = v.split(/[,،;]|\s+ו?-\s+/).map((x) => x.trim()).filter(Boolean);
    if (items.length < (e.min ?? 1) || items.length > (e.max ?? Infinity)) return { ok: false, why: `${items.length} items, want ${e.min ?? 1}–${e.max ?? "∞"}` };
  }
  const hit = e.anyOf.find((t) => namesTerm(v, t));
  return hit ? { ok: true, why: `names "${hit}"` } : { ok: false, why: `names none of ${e.anyOf.join(", ")}` };
}

export interface PageResult {
  url: string;
  ms: number;
  /** Page fields: name → [value, expected]. */
  page: Record<string, [string, string]>;
  /** Prompt fields: name → [answer, expectation]. */
  model: Record<string, [string, FieldExpectation]>;
}

export interface ClipEvalSummary {
  pages: number;
  fieldsRight: number;
  fields: number;
  share: number;
  modelRight: number;
  modelFields: number;
  modelShare: number;
  msP50: number;
  msP95: number;
  msMax: number;
  slow: string[];
  offDevice: string[];
  wrong: string[];
  pass: boolean;
  reasons: string[];
}

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
};

/** Is a request URL on this device or the local network (what "0 requests off the device" allows)? */
export function isLocalUrl(u: string): boolean {
  try {
    const h = new URL(u).hostname.replace(/^\[|\]$/g, "");
    return h === "localhost" || h === "::1" || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.endsWith(".local");
  } catch {
    return false;
  }
}

export function summarizeClipEval(results: PageResult[], requests: string[]): ClipEvalSummary {
  let fieldsRight = 0;
  let fields = 0;
  let modelRight = 0;
  let modelFields = 0;
  const wrong: string[] = [];
  for (const r of results) {
    for (const [k, [got, want]] of Object.entries(r.page)) {
      fields++;
      if (got.startsWith(want)) fieldsRight++;
      else wrong.push(`${r.url} ${k}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
    }
    for (const [k, [got, e]] of Object.entries(r.model)) {
      fields++;
      modelFields++;
      const v = judgeField(got, e);
      if (v.ok) {
        fieldsRight++;
        modelRight++;
      } else wrong.push(`${r.url} ${k}: ${JSON.stringify(got)} — ${v.why}`);
    }
  }
  const ms = results.map((r) => r.ms);
  const slow = results.filter((r) => r.ms >= CLIP_MS_MAX).map((r) => `${r.url} ${(r.ms / 1000).toFixed(1)} s`);
  const offDevice = requests.filter((u) => !isLocalUrl(u));
  const share = fields ? fieldsRight / fields : 0;
  const modelShare = modelFields ? modelRight / modelFields : 0;
  const reasons: string[] = [];
  if (results.length < 20) reasons.push(`${results.length} pages, want 20`);
  if (share < FIELD_SHARE_MIN) reasons.push(`fields right ${(share * 100).toFixed(1)} % < 85 %`);
  if (modelShare < FIELD_SHARE_MIN) reasons.push(`prompt fields right ${(modelShare * 100).toFixed(1)} % < 85 %`);
  if (slow.length) reasons.push(`${slow.length} clips took 10 s or more`);
  if (offDevice.length) reasons.push(`${offDevice.length} requests off the device`);
  return { pages: results.length, fieldsRight, fields, share, modelRight, modelFields, modelShare, msP50: quantile(ms, 0.5), msP95: quantile(ms, 0.95), msMax: Math.max(0, ...ms), slow, offDevice, wrong, pass: !reasons.length, reasons };
}

export function clipEvalMarkdown(model: string, date: string, s: ClipEvalSummary): string {
  return [
    `# Clip interpreter eval — ${model}, ${date}`,
    "",
    `Verdict: **${s.pass ? "PASS" : "FAIL"}**${s.reasons.length ? ` (${s.reasons.join("; ")})` : ""}.`,
    "",
    `- Fields right: **${s.fieldsRight} / ${s.fields} (${(s.share * 100).toFixed(1)} %)**; prompt fields alone ${s.modelRight} / ${s.modelFields} (${(s.modelShare * 100).toFixed(1)} %). Target ≥ 85 % (W2.14).`,
    `- Time per clip with interpretation: p50 ${(s.msP50 / 1000).toFixed(1)} s, p95 ${(s.msP95 / 1000).toFixed(1)} s, max ${(s.msMax / 1000).toFixed(1)} s. Target < 10 s each.`,
    `- Requests off the device: ${s.offDevice.length}${s.offDevice.length ? ` (${s.offDevice.join(", ")})` : ""}. Target 0.`,
    "",
    ...(s.wrong.length ? ["## Wrong fields", "", ...s.wrong.map((w) => `- ${w}`)] : []),
  ].join("\n");
}
