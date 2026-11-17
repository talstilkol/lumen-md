/**
 * Cite-or-delete gate for research answers (R12.9).
 *
 * Every sentence of an answer must be tied to evidence: an exact quote at
 * known offsets in a source the run read. A sentence that cannot be tied is
 * deleted, and the number deleted is part of the result, so the answer can
 * say so.
 *
 * The evidence is chosen here, by the verifier, never by the model:
 *  - the model only says *which* sources a sentence rests on (its `[^n]`
 *    markers; a quote it offers is one candidate among the rest);
 *  - the candidates are the sentences of those sources, each at exact
 *    offsets (./align), and the model's own quote when it aligns exactly;
 *  - a candidate supports the sentence when it holds most of the sentence's
 *    content words (Hebrew prefix letters tolerated), every number the
 *    sentence states, and the same polarity (a "not" on one side only is a
 *    contradiction, not support);
 *  - the best candidate is the evidence. Its text is the source's own slice
 *    (`alignmentHolds` is checked once more before it is returned), with the
 *    source's hash and, for a note, the paragraph anchor (W12.A1).
 *
 * Headings, rules and blank lines are layout, not claims: they stay when
 * something under them stays. Everything else, list items, table rows and
 * code included, is a unit that needs evidence.
 *
 * Clean reimplementation; design reference only: israelconnect's
 * vericite_gate / citation_pass (AGPL), no code copied.
 */
import { prefixVariants, words } from "../../text/hebrew";
import { fnv1a, noteParagraphs } from "../../ai/paragraphAnchors";
import { alignForm, alignQuote, alignmentHolds, longEnough, type Alignment } from "./align";

export interface GateSource {
  /** The number the answer cites. */
  n: number;
  /** A path or URL: where the evidence came from. */
  id: string;
  text: string;
  /** A Markdown note: resolve the paragraph anchor of the evidence (W12.A1). */
  note?: boolean;
}

export interface GateEvidence extends Alignment {
  n: number;
  sourceId: string;
  /** FNV-1a of the whole source text when it was checked: a later edit makes the evidence stale. */
  sourceHash: string;
  /** The paragraph the quote sits in (`^id` or `p-<hash>`), for a note. */
  anchor: string | null;
  /** Share of the sentence's content words the quote holds (0–1). */
  support: number;
  /** "model": the model's own quote aligned and won; "source": the verifier picked a passage. */
  pickedFrom: "model" | "source";
}

export type DeleteReason = "no-citation" | "source-not-read" | "no-support" | "number-mismatch" | "polarity-mismatch";

export interface GateUnit {
  /** The sentence as written, markers included. */
  text: string;
  /** The sentence without its markers. */
  claim: string;
  markers: number[];
  evidence: GateEvidence | null;
  reason: DeleteReason | null;
}

export interface GateResult {
  /** The answer with every unsupported sentence deleted and each kept one ending in `{{cite:k}}` (k indexes `evidence`). */
  body: string;
  evidence: GateEvidence[];
  kept: GateUnit[];
  deleted: GateUnit[];
  deletedCount: number;
}

export interface GateOptions {
  /** Minimum share of content words the quote must hold (default 0.6). */
  minSupport?: number;
  /** The model's quotes per source, in marker order (`quotes.get(n)[k]` backs the k-th marker of source n). */
  modelQuotes?: Map<number, string[]>;
}

/**
 * Three of four content words: a sentence that adds one word in four to its
 * quote is a paraphrase; one that adds one in three ("the warranty covers a
 * cracked lid" on "the warranty covers the heating element") is a new claim.
 */
export const DEFAULT_MIN_SUPPORT = 0.75;

/* ─── Words, numbers, polarity ─────────────────────────────────────────── */

const STOP = new Set(
  (
    "a an the and or but of to in on at by for with from as is are was were be been being it its this that these those there here " +
    "has have had do does did will would can could should may might must also than then so such into about over after before during " +
    "i you he she we they me him her us them my your his our their one " +
    "according says said report reports reported states stated notes noted source sources " +
    "של את על עם אל כי גם או אך אבל הוא היא הם הן זה זו זאת אלה יש היה היתה היו להיות כל כמו לפי אשר מן עד בין לאחר אחרי לפני כך אז " +
    "נאמר אמר אמרה כתוב נכתב מקור אני אתה אנחנו אתם אתן מותר ניתן אפשר צריך"
  ).split(" "),
);
/** Negation and prohibition words, in comparison form (final letters folded: אין → אינ). */
const NEGATION_WORDS = "not no never none nor neither without cannot לא אין אינו אינה אינם אינן איני אינך מעולם בלי ללא אף שום אסור";

const norm = (w: string) => alignForm(w).text.replace(/["'.]/g, "");
const NEGATION = new Set(NEGATION_WORDS.split(" ").map(norm));
const isNegation = (w: string) => NEGATION.has(w) || /n't$/.test(w);

/** Content words of a text, in comparison form. */
export function contentWords(text: string): string[] {
  return words(text)
    .map(norm)
    .filter((w) => w && !/^\d/.test(w) && !isNegation(w) && !STOP.has(w) && !(w.length < 2));
}

/** A word and its bare forms (Hebrew prefix letters, an English plural/possessive). */
function forms(w: string): string[] {
  const out = new Set(prefixVariants(w));
  if (/^[a-z]{4,}s$/.test(w)) out.add(w.slice(0, -1));
  for (const f of [...out]) if (/^\p{Script=Hebrew}{4,}(?:ים|ות)$/u.test(f)) out.add(f.slice(0, -2));
  return [...out];
}

/**
 * Words of a text as a lookup for `hasWord`. Two words are the same word when
 * one is the other with prefix letters (בחיפה / חיפה), or both bare forms
 * share a stem of at least four letters (בחיפה / לחיפה). A three-letter
 * remainder alone is not enough: stripping ב and כ from בכירה leaves ירה,
 * which is also שירה without its ש.
 */
export function wordIndex(text: string): { full: Set<string>; bare: Set<string>; stems: Set<string> } {
  const full = new Set(contentWords(text));
  const bare = new Set<string>();
  const stems = new Set<string>();
  for (const w of full)
    for (const f of forms(w)) {
      bare.add(f);
      if ([...f].length >= 4) stems.add(f);
    }
  return { full, bare, stems };
}

export function hasWord(idx: ReturnType<typeof wordIndex>, w: string): boolean {
  if (idx.full.has(w) || idx.bare.has(w)) return true;
  return forms(w).some((f) => idx.full.has(f) || ([...f].length >= 4 && idx.stems.has(f)));
}

/** Every number a text states, canonical: "1,200" → "1200", "2.50" → "2.5", "40%" → "40". */
export function numbersOf(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => {
    const plain = n.replace(/,(?=\d{3}\b)/g, "").replace(/,/g, "");
    return plain.includes(".") ? plain.replace(/\.?0+$/, "") : plain;
  });
}

const negated = (text: string) => words(text).some((w) => isNegation(norm(w)));

export interface Support {
  score: number;
  /** Why it is not support, when it is not. */
  reject: "number-mismatch" | "polarity-mismatch" | null;
}

/**
 * How well a passage supports a claim. Polarity is read on `context`, the
 * clause the passage sits in: a quote cut after "Do not" still says "do not".
 */
export function supportOf(claim: string, passage: string, context: string = passage): Support {
  const cw = [...new Set(contentWords(claim))];
  const idx = wordIndex(passage);
  const hit = cw.filter((w) => hasWord(idx, w)).length;
  const score = cw.length ? hit / cw.length : 0;
  const pn = new Set(numbersOf(passage));
  if (numbersOf(claim).some((n) => !pn.has(n))) return { score, reject: "number-mismatch" };
  if (negated(claim) !== negated(context)) return { score, reject: "polarity-mismatch" };
  return { score, reject: null };
}

/* ─── Units of an answer ──────────────────────────────────────────────── */

const MARKER_RE = /\s*\[\^(\d{1,3})\]/g;
/** An ask-the-vault citation, `[n] "quote"` (T29, W12.A1). */
const VAULT_RE = /\s*\[(\d{1,2})\](?:\s*[:—-]?\s*["“„«]([^"”«»\n]{3,300})["”»])?/g;
const ABBREV = /(?:\b(?:e\.g|i\.e|etc|vs|Dr|Mr|Mrs|Ms|Prof|No|pp?|cf|al|St)\.)$/;

/** Sentences of one line, each with the markers that follow its full stop. */
export function splitSentences(line: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (let i = 0; i < line.length; i++) {
    buf += line[i];
    if (!/[.!?׃]/.test(line[i])) continue;
    // Closing quotes, brackets and emphasis right after the stop belong to the sentence.
    let j = i + 1;
    while (j < line.length && /[)\]"'”’»*_]/.test(line[j]) && line[j] !== "[") j++;
    const tail = /^(?:\s*\[\^\d{1,3}\]|\s*\[\d{1,2}\](?:\s*[:—-]?\s*["“„«][^"”«»\n]{3,300}["”»])?)*/.exec(line.slice(j))?.[0] ?? "";
    const next = line[j + tail.length];
    if (next !== undefined && !/\s/.test(next)) continue; // "2.5", "a.b"
    if (ABBREV.test(buf)) continue;
    buf += line.slice(i + 1, j) + tail;
    i = j + tail.length - 1;
    out.push(buf);
    buf = "";
  }
  if (buf.trim()) out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

interface Parsed {
  claim: string;
  markers: number[];
  /** Model quotes given inline (`[n] "quote"`), by marker. */
  inline: Array<string | null>;
}

function parseUnit(text: string): Parsed {
  const markers: number[] = [];
  const inline: Array<string | null> = [];
  let claim = text.replace(MARKER_RE, (_m, n: string) => {
    markers.push(Number(n));
    inline.push(null);
    return "";
  });
  claim = claim.replace(VAULT_RE, (_m, n: string, q: string | undefined) => {
    markers.push(Number(n));
    inline.push(q?.trim() || null);
    return "";
  });
  return { claim: claim.replace(/\s+([.!?׃,;:])/g, "$1").trim(), markers, inline };
}

/** Sentences of a source with their offsets: the verifier's candidate passages. */
export interface Passage extends Alignment {
  /** The text its polarity is read in: a clause is read with the start of its sentence ("Do not, ever, add…"). */
  context: string;
}

export function sourcePassages(text: string): Passage[] {
  const out: Passage[] = [];
  const re = /[^\n.!?׃]+(?:[.!?׃]+(?=\s|$)|[.!?׃](?=\S)[^\n.!?׃]*)*[.!?׃]*/g;
  for (const m of text.matchAll(re)) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const t = raw.trim().replace(/^(?:[-*+]|\d+[.)]|#{1,6}|>)\s+/, "");
    if (!t || !longEnough(t)) continue;
    const start = (m.index ?? 0) + lead + (raw.trim().length - t.length);
    out.push({ start, end: start + t.length, text: text.slice(start, start + t.length), context: text.slice(start, start + t.length) });
  }
  // Two sentences together: a claim may join a subject and its predicate across a full stop.
  const pairs: Passage[] = [];
  for (let i = 0; i + 1 < out.length; i++) {
    if (/\n\s*\n/.test(text.slice(out[i].end, out[i + 1].start))) continue;
    const t = text.slice(out[i].start, out[i + 1].end);
    pairs.push({ start: out[i].start, end: out[i + 1].end, text: t, context: t });
  }
  // Clauses of a sentence: "Water at the base, not on the leaves" backs "water at the base".
  const clauses: Passage[] = [];
  for (const o of out) {
    let at = o.start;
    for (const part of o.text.split(/(?<=[,;:—–])\s+/)) {
      const t = part.replace(/[,;:—–.!?׃]+$/, "");
      const start = text.indexOf(part, at);
      at = start + part.length;
      if (t.length === o.text.length || !longEnough(t) || start < 0) continue;
      clauses.push({ start, end: start + t.length, text: text.slice(start, start + t.length), context: text.slice(o.start, start + t.length) });
    }
  }
  return [...out, ...clauses, ...pairs];
}

/** The smallest passage of the source that holds a span: the context its polarity is read in. */
function contextOf(span: Alignment, passages: readonly Passage[], text: string): string {
  let best: Passage | null = null;
  for (const p of passages) if (p.start <= span.start && span.end <= p.end && (!best || p.end - p.start < best.end - best.start)) best = p;
  // The passage's own context, widened to the span's start: a quote that starts before its clause reads that part too.
  if (best) return text.slice(Math.min(span.start, best.end - best.context.length), best.end);
  // Across sentences: from the start of the first to the end of the last it touches.
  const touched = passages.filter((p) => p.end > span.start && p.start < span.end);
  const start = Math.min(span.start, ...touched.map((p) => p.start));
  const end = Math.max(span.end, ...touched.map((p) => p.end));
  return text.slice(start, end);
}

/* ─── The gate ────────────────────────────────────────────────────────── */

function anchorAt(src: GateSource, offset: number): string | null {
  if (!src.note) return null;
  const p = noteParagraphs(src.text).find((q) => q.start <= offset && offset < q.end);
  return p?.anchor ?? null;
}

function bestEvidence(p: Parsed, sources: Map<number, GateSource>, modelQuotes: Map<number, string[]>, seen: Map<number, number>, minSupport: number): { evidence: GateEvidence | null; reason: DeleteReason | null } {
  if (!p.markers.length) return { evidence: null, reason: "no-citation" };
  const read = p.markers.map((n, i) => ({ n, i, src: sources.get(n) })).filter((m) => m.src);
  // Count markers per source in order, read or not, so quote k stays with marker k.
  const modelPick = p.markers.map((n, i) => {
    const k = seen.get(n) ?? 0;
    seen.set(n, k + 1);
    return p.inline[i] ?? modelQuotes.get(n)?.[k] ?? null;
  });
  if (!read.length) return { evidence: null, reason: "source-not-read" };
  let best: GateEvidence | null = null;
  let worst: DeleteReason = "no-support";
  for (const { n, i, src } of read) {
    const cands: Array<Alignment & { from: "model" | "source"; context: string }> = [];
    const passages = sourcePassages(src!.text);
    const mq = modelPick[i];
    const a = mq ? alignQuote(mq, src!.text) : null;
    if (a) cands.push({ ...a, from: "model", context: contextOf(a, passages, src!.text) });
    for (const s of passages) cands.push({ ...s, from: "source" });
    for (const c of cands) {
      const s = supportOf(p.claim, c.text, c.context);
      if (s.reject) {
        if (s.score >= minSupport) worst = s.reject;
        continue;
      }
      if (s.score < minSupport) continue;
      // Best support wins; on a tie the shorter passage, the more precise quote.
      const better = !best || s.score > best.support || (s.score === best.support && c.end - c.start < best.end - best.start);
      if (better) best = { n, sourceId: src!.id, start: c.start, end: c.end, text: c.text, sourceHash: fnv1a(src!.text), anchor: null, support: s.score, pickedFrom: c.from };
    }
  }
  if (!best) return { evidence: null, reason: worst };
  const src = sources.get(best.n)!;
  // The last word before anything is shown: the quote is the source's own slice.
  if (!alignmentHolds(best, src.text)) return { evidence: null, reason: "no-support" };
  best.anchor = anchorAt(src, best.start);
  return { evidence: best, reason: null };
}

const HEADING = /^\s{0,3}#{1,6}\s/;
const RULE = /^\s{0,3}(?:[-*_]\s*){3,}$/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const BULLET = /^(\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|\s*>\s?)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Run the gate over an answer. `sources` are the texts the run read, by
 * the number the answer cites them with.
 */
export function citeOrDelete(answer: string, sources: readonly GateSource[], opts: GateOptions = {}): GateResult {
  const minSupport = opts.minSupport ?? DEFAULT_MIN_SUPPORT;
  const byN = new Map(sources.map((s) => [s.n, s]));
  const modelQuotes = opts.modelQuotes ?? new Map<number, string[]>();
  const seen = new Map<number, number>();
  const evidence: GateEvidence[] = [];
  const kept: GateUnit[] = [];
  const deleted: GateUnit[] = [];
  const outLines: string[] = [];
  /** Layout lines waiting for kept content under them (a heading, a table header). */
  let pending: string[] = [];
  let tableHeader: string | null = null;

  const judge = (text: string): GateUnit => {
    const p = parseUnit(text);
    const { evidence: e, reason } = bestEvidence(p, byN, modelQuotes, seen, minSupport);
    const unit: GateUnit = { text, claim: p.claim, markers: p.markers, evidence: e, reason };
    if (e) {
      kept.push(unit);
      evidence.push(e);
    } else deleted.push(unit);
    return unit;
  };
  const cite = (u: GateUnit) => {
    // The marker goes where the model put it: after the full stop.
    return `${u.claim}{{cite:${evidence.indexOf(u.evidence!)}}}`;
  };
  const emit = (line: string) => {
    outLines.push(...pending, line);
    pending = [];
  };

  const lines = answer.split("\n");
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (FENCE.test(line)) {
      // A code block is one unit; nothing in a run quotes code at offsets, so it goes.
      const fence = FENCE.exec(line)![1];
      const block = [line];
      while (++li < lines.length) {
        block.push(lines[li]);
        if (lines[li].trimStart().startsWith(fence[0].repeat(fence.length))) break;
      }
      deleted.push({ text: block.join("\n"), claim: block.join("\n"), markers: [], evidence: null, reason: "no-citation" });
      continue;
    }
    if (!line.trim()) {
      if (outLines.length && outLines[outLines.length - 1] !== "") outLines.push("");
      tableHeader = null;
      continue;
    }
    if (HEADING.test(line) || RULE.test(line)) {
      // A new heading replaces one that got no content.
      pending = pending.filter((l) => !HEADING.test(l));
      if (pending.length && pending[pending.length - 1] !== "") pending.push("");
      pending.push(line, "");
      if (outLines[outLines.length - 1] === "") outLines.pop();
      continue;
    }
    if (/^\s*\|/.test(line)) {
      if (TABLE_SEP.test(lines[li + 1] ?? "")) {
        tableHeader = `${line}\n${lines[++li]}`;
        continue;
      }
      // A table row is one unit: its cells together are the claim.
      const u = judge(line.replace(/\|/g, " ").trim());
      if (u.evidence) {
        if (tableHeader) {
          emit(tableHeader);
          tableHeader = null;
        }
        const k = evidence.indexOf(u.evidence);
        emit(`${line.replace(/\s*\[\^\d{1,3}\]/g, "").replace(/\|\s*$/, "")}{{cite:${k}}} |`);
      }
      continue;
    }
    const bullet = BULLET.exec(line)?.[1] ?? "";
    const keptHere: string[] = [];
    for (const s of splitSentences(line.slice(bullet.length))) {
      const u = judge(s);
      if (u.evidence) keptHere.push(cite(u));
    }
    if (keptHere.length) emit(bullet + keptHere.join(" "));
  }
  while (outLines.length && outLines[outLines.length - 1] === "") outLines.pop();
  return { body: outLines.join("\n"), evidence, kept, deleted, deletedCount: deleted.length };
}

/** Plain-language reason for a deleted sentence. */
export const DELETE_REASON: Record<DeleteReason, { en: string; he: string }> = {
  "no-citation": { en: "it cites no source", he: "אין בו הפניה למקור" },
  "source-not-read": { en: "it cites a source that was not read", he: "הוא מפנה למקור שלא נקרא" },
  "no-support": { en: "no exact quote in its sources says it", he: "אין ציטוט מדויק במקורות שאומר זאת" },
  "number-mismatch": { en: "its numbers are not in the quote", he: "המספרים שבו לא מופיעים בציטוט" },
  "polarity-mismatch": { en: "the quote says the opposite", he: "הציטוט אומר את ההפך" },
};

/** The line every gated answer carries: how many sentences were removed. */
export function deletedLine(deletedCount: number, keptCount: number, lang: "en" | "he"): string {
  if (lang === "he") {
    if (!deletedCount) return "כל משפט בתשובה קשור לציטוט מדויק ממקור (0 משפטים נמחקו).";
    return `${deletedCount === 1 ? "משפט אחד נמחק" : `${deletedCount} משפטים נמחקו`}: אין ציטוט מדויק במקורות שתומך בהם.${keptCount ? "" : " לא נשאר משפט מאומת."}`;
  }
  if (!deletedCount) return "Every sentence is tied to an exact quote from a source (0 sentences removed).";
  return `${deletedCount} sentence${deletedCount === 1 ? " was" : "s were"} removed: no exact quote in the sources backs ${deletedCount === 1 ? "it" : "them"}.${keptCount ? "" : " No verified sentence is left."}`;
}
