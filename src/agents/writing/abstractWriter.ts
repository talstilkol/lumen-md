/**
 * Title, abstract and TL;DR writer (plan W13.W12): three title options of
 * different lengths, an abstract of 150–250 words and a one-line TL;DR —
 * where every sentence proves itself. Notion AI and Apple Writing Tools
 * summarise; here a sentence that cannot be tied to a paragraph of the note
 * is deleted.
 *
 *  - A local model drafts (the `abstractWriter` agent: Ollama or web-llm,
 *    no tools, run by the caller through the agent runtime with its
 *    AbortSignal).
 *  - The R12.9 cite-or-delete gate (agents/cite/gate.ts) checks every
 *    sentence of the abstract and the TL;DR against the note: the verifier,
 *    not the model, picks the quote; numbers and polarity must agree. A
 *    sentence without support is deleted, and the count is shown. Each kept
 *    sentence carries its paragraph anchor (`^id`, or the virtual `p-…`).
 *  - An academic note (frontmatter `type: paper|article|thesis`, or
 *    headings such as Abstract / Methods / Results / מבוא / שיטה / ממצאים)
 *    gets a structured abstract: background, method, findings.
 *  - Titles are not claims, but each must be made of the note's own words
 *    (most of its content words occur in the note), and the three differ in
 *    length: short, medium, long.
 *  - Without a model, the baseline is the extractive summary (no titles).
 */
import { citeOrDelete, contentWords, wordIndex, hasWord, type GateEvidence } from "../cite/gate";
import { noteParagraphs } from "../../ai/paragraphAnchors";
import { extractiveSummary, splitSentences } from "../../ai/summarizeCore";
import { countWords } from "../../book/wordCount";
import type { AgentDefinition, AgentInput } from "../types";
import { registerAgent } from "../registry";
import { fail, ok } from "../defs/shared";

export const ABSTRACT_MIN_WORDS = 150;
export const ABSTRACT_MAX_WORDS = 250;
export const NOTE_MAX_CHARS = 12000;

export interface AnchoredSentence {
  text: string;
  /** The paragraph it rests on: `^id` or `p-<hash>`. */
  anchor: string;
  /** 1-based paragraph number in the note. */
  paragraph: number;
  /** The note's own words that support it. */
  quote: string;
}

export interface AbstractDraft {
  titles: string[];
  tldr: string;
  abstract?: string;
  background?: string;
  method?: string;
  findings?: string;
}

export interface AbstractResult {
  academic: boolean;
  titles: string[];
  tldr: AnchoredSentence | null;
  /** The abstract, sentence by sentence; for an academic note, by part. */
  abstract: AnchoredSentence[];
  parts?: { background: AnchoredSentence[]; method: AnchoredSentence[]; findings: AnchoredSentence[] };
  words: number;
  /** Words in the 150–250 range (or the note was too short for it). */
  lengthOk: boolean;
  /** Sentences the gate deleted (abstract + TL;DR), and titles dropped. */
  deleted: string[];
  droppedTitles: string[];
  engine: "model" | "extractive";
}

const ACADEMIC_TYPE = /^(?:type|kind|סוג)\s*:\s*["']?(paper|article|thesis|dissertation|study|research|seminar|מאמר|עבודה|עבודת סמינריון|תזה|מחקר)\b/im;
const ACADEMIC_HEADINGS = /^#{1,6}\s*(abstract|introduction|background|methods?|methodology|results|findings|discussion|conclusions?|references|bibliography|תקציר|מבוא|רקע|שיטה|שיטות|מתודולוגיה|ממצאים|תוצאות|דיון|סיכום ומסקנות|מסקנות|ביבליוגרפיה|מקורות)\s*$/gim;

/** Is the note academic (structured abstract)? */
export function isAcademic(markdown: string): boolean {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)?.[1] ?? "";
  if (ACADEMIC_TYPE.test(fm)) return true;
  return (markdown.match(ACADEMIC_HEADINGS)?.length ?? 0) >= 2;
}

/** The note as the model sees it: numbered paragraphs. */
export function numberedNote(markdown: string, max = NOTE_MAX_CHARS): string {
  const out: string[] = [];
  let used = 0;
  for (const p of noteParagraphs(markdown)) {
    const line = `[${p.index + 1}] ${p.text.replace(/\s+/g, " ").trim()}`;
    if (used + line.length > max) break;
    out.push(line);
    used += line.length + 1;
  }
  return out.join("\n");
}

/** Gate sentences against the note: each kept one with its paragraph anchor. */
export function anchorSentences(text: string | undefined, note: string, path: string): { kept: AnchoredSentence[]; deleted: string[] } {
  const sents = splitSentences((text ?? "").replace(/\[\^?\d+\]/g, "").trim());
  if (!sents.length) return { kept: [], deleted: [] };
  // One source, the note itself: each sentence cites it, and the gate looks for the passage that supports it.
  const answer = sents.map((s) => `${s} [^1]`).join("\n");
  const r = citeOrDelete(answer, [{ n: 1, id: path, text: note, note: true }]);
  const paras = noteParagraphs(note);
  const kept = r.kept.map((u) => {
    const e = u.evidence as GateEvidence;
    const para = paras.find((p) => p.anchor === e.anchor) ?? paras.find((p) => e.start >= p.start && e.start < p.end);
    return { text: u.claim.trim(), anchor: e.anchor ?? para?.anchor ?? "", paragraph: (para?.index ?? 0) + 1, quote: e.text };
  });
  return { kept, deleted: r.deleted.map((u) => u.claim.trim()) };
}

/** Titles made of the note's words, different lengths, short to long. */
export function checkTitles(titles: readonly string[], note: string): { kept: string[]; dropped: string[] } {
  const idx = wordIndex(note);
  const kept: string[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const raw of titles) {
    const t = raw.replace(/^["'“”«»#\s]+|["'“”«»\s]+$/g, "").replace(/\s+/g, " ").trim();
    if (!t) continue;
    const cw = contentWords(t);
    const inNote = cw.filter((w) => hasWord(idx, w)).length;
    const key = t.toLowerCase();
    if (seen.has(key) || !cw.length || inNote / cw.length < 0.5 || countWords(t) > 20) dropped.push(raw);
    else {
      seen.add(key);
      kept.push(t);
    }
  }
  kept.sort((a, b) => countWords(a) - countWords(b));
  return { kept: kept.slice(0, 3), dropped };
}

export interface AbstractWriterInput extends AgentInput {
  text: string;
  extra: { language: string; academic: boolean; minWords: number; maxWords: number };
}

/** The model's JSON, leniently: the first {...} block. */
export function parseDraft(text: string): AbstractDraft {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error("no JSON object in the answer");
  const j = JSON.parse(m[0]) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : Array.isArray(v) ? v.filter((x) => typeof x === "string").join(" ") : "");
  return {
    titles: Array.isArray(j.titles) ? j.titles.filter((x): x is string => typeof x === "string") : [],
    tldr: s(j.tldr),
    abstract: s(j.abstract) || undefined,
    background: s(j.background) || undefined,
    method: s(j.method) || undefined,
    findings: s(j.findings) || undefined,
  };
}

const wordsIn = (d: AbstractDraft) => countWords([d.abstract, d.background, d.method, d.findings].filter(Boolean).join(" "));

export const abstractWriterAgent: AgentDefinition<AbstractWriterInput, AbstractDraft> = registerAgent<AbstractWriterInput, AbstractDraft>({
  id: "abstractWriter",
  commandId: "writing.abstract",
  description: "Titles, an abstract and a TL;DR of a note, every sentence tied to a paragraph (on this device)",
  system: (input) =>
    `You write for a note in ${input.extra.language}, in that language. Answer with one JSON object only. ` +
    `"titles": exactly 3 titles of clearly different lengths (about 3, 7 and 12 words), made of the note's own key words. ` +
    `"tldr": one sentence with the note's main point. ` +
    (input.extra.academic
      ? `"background", "method", "findings": the parts of a structured abstract, together ${input.extra.minWords}–${input.extra.maxWords} words. `
      : `"abstract": ${input.extra.minWords}–${input.extra.maxWords} words. `) +
    "Every sentence must state only what a numbered paragraph of the note says, in close to its words; keep its numbers exact; never add facts, opinions or praise. " +
    "Sentences that the note does not support are deleted afterwards.",
  user: (input) => input.text,
  parse: (text) => parseDraft(text),
  validators: [
    {
      name: "shape",
      check: (d, input) => {
        if (!d.titles || d.titles.length < 3) return fail("fewer than 3 titles", "Give exactly 3 titles: short, medium and long.");
        if (!d.tldr) return fail("no tldr", "Add a one-sentence tldr.");
        const w = wordsIn(d);
        const ex = (input.extra ?? {}) as { minWords?: unknown; maxWords?: unknown };
        const [min, max] = [Number(ex.minWords), Number(ex.maxWords)];
        if (w < min * 0.8 || w > max * 1.2) return fail(`${w} words`, `The abstract must be ${min}–${max} words.`);
        return ok;
      },
    },
  ],
  // A note's content never goes to a cloud provider for this; no tools.
  executorPreference: ["ollama", "webllm"],
  language: "any",
  maxRetries: 1,
  tier: "small",
  temperature: 0.2,
  maxTokens: 900,
});

/** Run it. `model` is the caller's runAgent (with its AbortSignal); without one, the extractive baseline. */
export async function writeAbstract(
  note: string,
  opts: { path: string; lang: "he" | "en"; model?: (input: AbstractWriterInput) => Promise<AbstractDraft>; signal?: AbortSignal },
): Promise<AbstractResult> {
  const academic = isAcademic(note);
  const noteWords = countWords(note);
  // A short note cannot carry 150 words of abstract: aim at half of it.
  const minWords = Math.min(ABSTRACT_MIN_WORDS, Math.max(20, Math.floor(noteWords / 2)));
  const maxWords = Math.min(ABSTRACT_MAX_WORDS, Math.max(minWords + 20, Math.floor(noteWords * 0.8)));
  opts.signal?.throwIfAborted();
  if (!opts.model) {
    const sents = extractiveSummary(note.replace(/^---[\s\S]*?\n---\n/, ""), 6);
    const a = anchorSentences(sents.join(" "), note, opts.path);
    const words = countWords(a.kept.map((s) => s.text).join(" "));
    return { academic, titles: [], tldr: a.kept[0] ?? null, abstract: a.kept, words, lengthOk: words >= minWords && words <= maxWords, deleted: a.deleted, droppedTitles: [], engine: "extractive" };
  }
  const draft = await opts.model({ text: numberedNote(note), extra: { language: opts.lang === "he" ? "Hebrew" : "English", academic, minWords, maxWords } });
  opts.signal?.throwIfAborted();
  const t = checkTitles(draft.titles, note);
  const tl = anchorSentences(draft.tldr, note, opts.path);
  const deleted = [...tl.deleted];
  let abstract: AnchoredSentence[];
  let parts: AbstractResult["parts"];
  if (academic && (draft.background || draft.method || draft.findings)) {
    const b = anchorSentences(draft.background, note, opts.path);
    const m = anchorSentences(draft.method, note, opts.path);
    const f = anchorSentences(draft.findings, note, opts.path);
    parts = { background: b.kept, method: m.kept, findings: f.kept };
    abstract = [...b.kept, ...m.kept, ...f.kept];
    deleted.push(...b.deleted, ...m.deleted, ...f.deleted);
  } else {
    const a = anchorSentences(draft.abstract, note, opts.path);
    abstract = a.kept;
    deleted.push(...a.deleted);
  }
  const words = countWords(abstract.map((s) => s.text).join(" "));
  return { academic, titles: t.kept, tldr: tl.kept[0] ?? null, abstract, parts, words, lengthOk: words >= minWords && words <= maxWords, deleted, droppedTitles: t.dropped, engine: "model" };
}

/** The abstract as Markdown to insert: a callout, each sentence followed by its paragraph mark. */
export function abstractMarkdown(r: AbstractResult, lang: "he" | "en"): string {
  const he = lang === "he";
  const mark = (s: AnchoredSentence) => `${s.text} ${s.anchor.startsWith("^") ? `[[#${s.anchor}|¶${s.paragraph}]]` : `(¶${s.paragraph})`}`;
  const lines = [`> [!abstract] ${he ? "תקציר" : "Abstract"}`];
  if (r.tldr) lines.push(`> **TL;DR** ${mark(r.tldr)}`, ">");
  if (r.parts) {
    const label = { background: he ? "רקע" : "Background", method: he ? "שיטה" : "Method", findings: he ? "ממצאים" : "Findings" };
    for (const k of ["background", "method", "findings"] as const) if (r.parts[k].length) lines.push(`> **${label[k]}.** ${r.parts[k].map(mark).join(" ")}`, ">");
    if (lines[lines.length - 1] === ">") lines.pop();
  } else lines.push(`> ${r.abstract.map(mark).join(" ")}`);
  return lines.join("\n");
}
