/**
 * claim-extractor (R12.11): a paragraph → checkable claims, each anchored to
 * an exact quote, as *candidates* for review.
 *
 * Three stages, in the order Claimify (Metropolitansky and Larson, 2025)
 * describes them. Only the middle work is the model's; every rule around it
 * is deterministic:
 *
 *  1. Selection (rules, `selectCheckable`): only sentences a reader could
 *     check go on. Questions, hedges and opinions ("I think", "maybe",
 *     "לדעתי", "אולי", "should", "כדאי") and sentences with fewer than three
 *     content words and numbers are left out, each with its reason.
 *  2. Disambiguation (model, checked by `fromParagraph`): a pronoun becomes the
 *     entity it stands for ("She moved…" → "Dana Levi moved…"). The model may
 *     only use words the paragraph has: a claim with a content word that is
 *     not in the paragraph is dropped as invented.
 *  3. Decomposition (model): one sentence → atomic claims, each with subject,
 *     predicate and object.
 *
 * Then the R12.9 gate (`agents/cite/gate`) picks the quote for every claim
 * from the paragraph itself, at exact offsets. A claim without one is
 * dropped and counted. What is left is returned with `status: "candidate"`
 * and full provenance (note, paragraph anchor, quote, offsets, paragraph
 * hash, extractor, model, date), the shape of W12.E1's edge provenance, for
 * the review queue: nothing is written to the vault as fact.
 *
 * Clean reimplementation; design reference only: israelconnect's
 * tools/research/claim_extract.py (AGPL), no code copied.
 */
import type { AgentDefinition, AgentInput } from "../types";
import { registerAgent } from "../registry";
import { clip, fail, ok } from "./shared";
import { citeOrDelete, contentWords, hasWord, numbersOf, splitSentences, wordIndex } from "../cite/gate";
import { fnv1a, noteParagraphs } from "../../ai/paragraphAnchors";

/* ─── Stage 1: selection ─────────────────────────────────────────────── */

export type SkipReason = "question" | "opinion" | "too-short";

const HEDGE =
  /\b(?:i think|i believe|i feel|in my (?:view|opinion)|maybe|perhaps|probably|possibly|might|should|we should|let's|it seems|apparently|hopefully|i guess)\b|(?:^|[\s"(])(?:אני חושב|אני חושבת|אני מאמין|אני מאמינה|לדעתי|נראה לי|אולי|כנראה|ייתכן|צריך|צריכה|צריכים|כדאי|בואו|הלוואי|מקווה|מקווים)(?=$|[\s,.!?"])/i;

export interface Selected {
  /** 1-based number of the sentence in the paragraph. */
  n: number;
  text: string;
  checkable: boolean;
  reason: SkipReason | null;
}

/** Sentences of a paragraph and whether each is checkable. */
export function selectCheckable(paragraph: string): Selected[] {
  const out: Selected[] = [];
  const lines = paragraph.split("\n").map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)]|>)\s+/, ""));
  for (const s of lines.flatMap((l) => splitSentences(l))) {
    const n = out.length + 1;
    let reason: SkipReason | null = null;
    if (/[?？؟]\s*$/.test(s)) reason = "question";
    else if (HEDGE.test(s)) reason = "opinion";
    // Three things to check: content words, and numbers count ("She moved to Haifa in 2019").
    else if (contentWords(s).length + numbersOf(s).length < 3) reason = "too-short";
    out.push({ n, text: s, checkable: !reason, reason });
  }
  return out;
}

/* ─── Stage 2 check: only the paragraph's words ──────────────────────── */

/** Content words of a claim that the paragraph does not have (prefix letters tolerated). */
export function inventedWords(claim: string, paragraph: string): string[] {
  const idx = wordIndex(paragraph);
  return contentWords(claim).filter((w) => !hasWord(idx, w));
}

/* ─── The model's part ───────────────────────────────────────────────── */

export interface ClaimDraft {
  /** The selected sentence it comes from (its number in the prompt). */
  sentence: number;
  /** The claim as a standalone sentence, pronouns resolved. */
  text: string;
  subject: string;
  predicate: string;
  object: string;
}

export interface ClaimExtractorInput extends AgentInput {
  /** The whole paragraph (context for resolving pronouns). */
  text: string;
  extra: { selected: Array<{ n: number; text: string }> };
}

export interface ClaimExtractorOutput {
  claims: ClaimDraft[];
}

export const CLAIM_SCHEMA = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      maxItems: 40,
      items: {
        type: "object",
        properties: {
          sentence: { type: "integer", minimum: 1 },
          text: { type: "string", minLength: 3 },
          subject: { type: "string" },
          predicate: { type: "string" },
          object: { type: "string" },
        },
        required: ["sentence", "text", "subject", "predicate", "object"],
        additionalProperties: false,
      },
    },
  },
  required: ["claims"],
  additionalProperties: false,
};

export const claimExtractorAgent: AgentDefinition<ClaimExtractorInput, ClaimExtractorOutput> = registerAgent<ClaimExtractorInput, ClaimExtractorOutput>({
  id: "claim-extractor",
  commandId: "ai.claims",
  description: "Turn a paragraph into checkable claims, each tied to an exact quote",
  system:
    "You split sentences into atomic, checkable claims. For each numbered sentence: replace every pronoun and vague reference with the entity it stands for, " +
    "using ONLY words that appear in the paragraph; then split it into claims that each state one fact, with its subject, predicate and object. " +
    "Never add facts, dates, numbers or names the paragraph does not state, and never judge whether a claim is true. Write each claim in the language of its sentence. " +
    'Output ONLY JSON: {"claims": [{"sentence": 1, "text": "<one standalone sentence>", "subject": "...", "predicate": "...", "object": "..."}]}. ' +
    'A sentence with no checkable fact gets no claim. No claims at all: {"claims": []}.',
  user: (input) => `Paragraph:\n${clip(input.text, 4000)}\n\nSentences to split:\n${input.extra.selected.map((s) => `${s.n}. ${s.text}`).join("\n")}`,
  outputSchema: CLAIM_SCHEMA,
  validators: [
    {
      name: "claims-from-selected",
      check: (out, input) => {
        const allowed = new Set((input as ClaimExtractorInput).extra.selected.map((s) => s.n));
        const bad = out.claims.filter((c) => !allowed.has(c.sentence));
        return bad.length ? fail(`claims for sentences that were not given: ${[...new Set(bad.map((c) => c.sentence))].join(", ")}`, "Only split the numbered sentences you were given.") : ok;
      },
    },
  ],
  language: "any",
  tier: "small",
  temperature: 0,
  maxTokens: 1500,
});

/* ─── Stage 3 check and anchoring ────────────────────────────────────── */

export const CLAIM_EXTRACTOR_VERSION = "claim-extractor@1";

export type DropReason = "not-selected" | "invented-words" | "unresolved-pronoun" | "reordered" | "no-quote";

/* ─── Stage 2 and 3 checks a small model fails (found by the planted probes) ── */

const PRONOUN_EN = /\b(?:he|she|it|they|him|her|them|his|hers|its|their|theirs)\b/i;
const PRONOUN_HE_FIRST = /^(?:הוא|היא|הם|הן|זה|זו|זאת)(?=\s)/;

/**
 * A claim still leaning on a pronoun ("Under her, leaks fell…", "הוא זכה…")
 * was not disambiguated: alone it can't be checked. In Hebrew only a
 * pronoun opening the claim counts — הוא / היא are also the copula
 * ("אורי שגיא הוא ראש העירייה").
 */
export function unresolvedPronoun(claim: string): boolean {
  return PRONOUN_EN.test(claim) || PRONOUN_HE_FIRST.test(claim.trim());
}

/** Is `seq` a subsequence of `of` (order kept, gaps allowed)? */
const inOrder = (seq: readonly string[], of: readonly string[]) => {
  let i = 0;
  for (const x of of) if (x === seq[i]) i++;
  return i === seq.length;
};
/** Latin names inside a sentence (capitalised, not its first word). */
const latinNames = (s: string) => s.split(/\s+/).slice(1).map((w) => w.replace(/[^\p{L}'-]/gu, "")).filter((w) => /^\p{Lu}\p{Ll}/u.test(w));

/**
 * The paragraph's own words, put in another order ("9 galleries, up from
 * 14" for "14, up from 9"; "from Nazareth to Eilat" for "from Eilat to
 * Nazareth"): two or more numbers, or two or more Latin names, of the claim
 * must appear in its quote in the claim's order. Each such word the quote
 * does not have is left to the other checks.
 */
export function reordered(claim: string, quote: string): boolean {
  for (const pick of [numbersOf, latinNames]) {
    const inQuote = pick(quote);
    const seq = pick(claim).filter((x) => inQuote.includes(x));
    if (seq.length >= 2 && !inOrder(seq, inQuote)) return true;
  }
  return false;
}

export interface CandidateClaim {
  id: string;
  text: string;
  subject: string;
  predicate: string;
  object: string;
  status: "candidate";
  provenance: {
    note: string;
    /** The paragraph's anchor: its `^id`, or `p-<hash>` while it has none (W12.A1). */
    anchor: string;
    /** The verifier's quote: the paragraph's own text at [start, end). */
    quote: string;
    start: number;
    end: number;
    /** `fnv1a:<hex>` of the paragraph: a changed paragraph makes the claim stale. */
    paragraphHash: string;
    extractor: string;
    model: string | null;
    date: string;
  };
}

export interface ExtractResult {
  selected: Selected[];
  claims: CandidateClaim[];
  dropped: Array<{ text: string; reason: DropReason }>;
}

/**
 * The deterministic rules around the model's drafts: drafts for unselected
 * sentences or with invented words go, then every claim needs the gate's
 * quote from the paragraph.
 */
export function anchorClaims(paragraph: string, selected: readonly Selected[], drafts: readonly ClaimDraft[], meta: { note: string; anchor: string; model: string | null; date: string }): ExtractResult {
  const ok = new Set(selected.filter((s) => s.checkable).map((s) => s.n));
  const claims: CandidateClaim[] = [];
  const dropped: ExtractResult["dropped"] = [];
  const seen = new Set<string>();
  for (const d of drafts) {
    const text = d.text.trim();
    if (!ok.has(d.sentence)) {
      dropped.push({ text, reason: "not-selected" });
      continue;
    }
    if (inventedWords(text, paragraph).length) {
      dropped.push({ text, reason: "invented-words" });
      continue;
    }
    if (unresolvedPronoun(text)) {
      dropped.push({ text, reason: "unresolved-pronoun" });
      continue;
    }
    const g = citeOrDelete(`${text.replace(/[.!?׃]?$/, ".")}[^1]`, [{ n: 1, id: meta.note, text: paragraph }]);
    const e = g.evidence[0];
    if (!e) {
      dropped.push({ text, reason: "no-quote" });
      continue;
    }
    if (reordered(text, e.text)) {
      dropped.push({ text, reason: "reordered" });
      continue;
    }
    const id = `claim-${fnv1a(`${meta.note}\u0000${meta.anchor}\u0000${text}`)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    claims.push({
      id,
      text,
      subject: d.subject.trim(),
      predicate: d.predicate.trim(),
      object: d.object.trim(),
      status: "candidate",
      provenance: { note: meta.note, anchor: meta.anchor, quote: e.text, start: e.start, end: e.end, paragraphHash: `fnv1a:${fnv1a(paragraph)}`, extractor: CLAIM_EXTRACTOR_VERSION, model: meta.model, date: meta.date },
    });
  }
  return { selected: [...selected], claims, dropped };
}

/** The paragraph of a note that holds `offset`, with its anchor. */
export function paragraphAt(content: string, offset: number): { text: string; anchor: string; start: number; end: number } | null {
  const p = noteParagraphs(content).find((q) => q.start <= offset && offset <= q.end);
  return p ? { text: p.text, anchor: p.anchor, start: p.start, end: p.end } : null;
}

/**
 * Extract claims from one paragraph: select (rules), run the model, then
 * anchor (rules). `run` calls the agent; it is injected in tests.
 */
export async function extractClaims(
  paragraph: string,
  meta: { note: string; anchor: string; date?: string },
  run: (input: ClaimExtractorInput) => Promise<{ output: ClaimExtractorOutput; model: string | null }>,
): Promise<ExtractResult> {
  const selected = selectCheckable(paragraph);
  const toModel = selected.filter((s) => s.checkable).map(({ n, text }) => ({ n, text }));
  if (!toModel.length) return { selected, claims: [], dropped: [] };
  const { output, model } = await run({ text: paragraph, extra: { selected: toModel } });
  return anchorClaims(paragraph, selected, output.claims, { ...meta, model, date: meta.date ?? new Date().toISOString() });
}

/** The candidates as a Markdown callout under the paragraph: each claim with its quote, and what was dropped. */
export function claimsCallout(r: ExtractResult, lang: "en" | "he"): string {
  const he = lang === "he";
  const skipped = r.selected.filter((s) => !s.checkable).length;
  const head = he
    ? `> [!claims] טענות מועמדות (${r.claims.length}) · ${r.dropped.length} נזרקו בלי ציטוט או עם מילים שאינן בפסקה · ${skipped} משפטים לא ניתנים לבדיקה`
    : `> [!claims] Candidate claims (${r.claims.length}) · ${r.dropped.length} dropped (no quote, or words not in the paragraph) · ${skipped} sentences not checkable`;
  const lines = r.claims.map((c) => `> - ${c.text} — “${c.provenance.quote.replace(/\s+/g, " ")}”`);
  return [head, ...lines].join("\n");
}
