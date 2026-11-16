/**
 * W13.W10 — Harper (Automattic, Apache-2.0, Rust → WASM) for local English
 * grammar, inside the suggestion engine.
 *
 * Harper lints English in milliseconds with a small fraction of
 * LanguageTool's memory, on the device: the answer to "no external tools".
 * This module is the part that does not depend on the package:
 *
 * - `englishSpans`: in a mixed Hebrew/English note only the English runs
 *   are linted (script + the local language id of plan 6.5), so Harper
 *   never sees Hebrew and never flags it;
 * - `toSuggestions` / `toGrammarMatches`: Harper's lints (spans in Unicode
 *   code points) become the W13.W1 Suggestion shape and the editor's
 *   GrammarMatch (UTF-16 offsets into the note);
 * - `harperCheck`: both together, over any linter with harper.js's
 *   `lint(text)` → `Lint[]` interface, with an AbortSignal.
 *
 * The linter itself runs in a worker (./harper.worker.ts) that loads
 * harper.js from the app's own origin (vendor/harper/, put there on the Mac
 * by scripts/writing/vendor-harper.mjs): no network beyond the app's files.
 */
import { detectLanguage } from "../../../text/langId";
import type { GrammarMatch } from "../../../ai/grammar";
import { conf, type WritingSuggestion } from "../suggestionShape";
import { throwIfAborted } from "../textTools";

export const AGENT_ID = "harperGrammar";

/** The parts of harper.js's API this module uses (harper.js 0.x: `Lint`, `Span`, `Suggestion`). */
export interface HarperSpan {
  start: number;
  end: number;
}
export interface HarperSuggestion {
  get_replacement_text(): string;
  /** 0 = Replace, 1 = Remove, 2 = InsertAfter (harper.js `SuggestionKind`). */
  kind(): number;
}
export interface HarperLint {
  span(): HarperSpan;
  message(): string;
  lint_kind(): string;
  lint_kind_pretty?(): string;
  suggestions(): HarperSuggestion[];
  get_problem_text?(): string;
}
export interface HarperLinterLike {
  lint(text: string, opts?: { language?: "plaintext" | "markdown" }): Promise<HarperLint[]>;
}

/** Plain-data lints, as the worker posts them. */
export interface LintData {
  start: number;
  end: number;
  message: string;
  kind: string;
  kindPretty: string;
  replacements: Array<{ kind: number; text: string }>;
}

export function lintData(l: HarperLint): LintData {
  const s = l.span();
  return {
    start: s.start,
    end: s.end,
    message: l.message(),
    kind: l.lint_kind(),
    kindPretty: l.lint_kind_pretty?.() ?? l.lint_kind(),
    replacements: l.suggestions().map((x) => ({ kind: x.kind(), text: x.get_replacement_text() })),
  };
}

/** UTF-16 offset of each code-point index of `text` (Harper's spans count code points). */
export function codePointOffsets(text: string): number[] {
  const out: number[] = [];
  let i = 0;
  for (const ch of text) {
    out.push(i);
    i += ch.length;
  }
  out.push(i);
  return out;
}

export interface Span {
  from: number;
  to: number;
}

const LATIN_RUN = /[A-Za-z][A-Za-z0-9'’"“”(),.;:!?%&\- \t]*[A-Za-z0-9.!?)"”’]/g;
const CODE = /```[\s\S]*?```|`[^`\n]*`|https?:\/\/\S+|\[\[[^\]]*\]\]|\]\([^)]*\)|<[^>]+>/g;

/**
 * The English runs of a note: code, links and HTML out; a run of Latin text
 * of at least three words that the language id calls English (or that has
 * no other reading). A whole English paragraph is one run.
 */
export function englishSpans(text: string, minWords = 3): Span[] {
  const masked = text.replace(CODE, (m) => " ".repeat(m.length));
  const out: Span[] = [];
  for (const m of masked.matchAll(LATIN_RUN)) {
    const run = m[0];
    if (run.split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length < minWords) continue;
    const g = detectLanguage(run, { prefer: ["en"] });
    if (g.lang !== "en" && g.confident) continue;
    const from = m.index ?? 0;
    out.push({ from, to: from + run.length });
  }
  return out;
}

/** Confidence by Harper's lint kind: spelling and style are softer than agreement or a wrong word. */
const KIND_CONFIDENCE: Record<string, number> = { Spelling: 0.7, Capitalization: 0.85, Agreement: 0.85, WordChoice: 0.75, Repetition: 0.9, Punctuation: 0.8, Grammar: 0.8, Style: 0.6, Readability: 0.55, Miscellaneous: 0.6 };

/** The replacement a lint proposes for its span, or null (no fix offered). */
function replacementOf(d: LintData, problem: string): string | null {
  const r = d.replacements[0];
  if (!r) return null;
  if (r.kind === 1) return "";
  if (r.kind === 2) return problem + r.text;
  return r.text;
}

export function toSuggestions(text: string, base: number, lints: readonly LintData[], model: string): WritingSuggestion[] {
  const cp = codePointOffsets(text);
  return lints
    .filter((d) => d.end > d.start && d.end < cp.length)
    .map((d) => {
      const from = cp[d.start];
      const to = cp[d.end];
      const problem = text.slice(from, to);
      return {
        range: { from: base + from, to: base + to },
        kind: `grammar:${d.kind}`,
        message: d.message,
        rationale: `${d.kindPretty}: ${d.message}${d.replacements.length > 1 ? ` (${d.replacements.length} options)` : ""} — Harper, on this device.`,
        confidence: conf(KIND_CONFIDENCE[d.kind] ?? 0.6),
        replacement: replacementOf(d, problem),
        agentId: AGENT_ID,
        model,
      };
    });
}

/** The same lints as the editor's GrammarMatch (rule id `harper:<kind>`). */
export function toGrammarMatches(sugs: readonly WritingSuggestion[]): GrammarMatch[] {
  return sugs.map((s) => ({
    offset: s.range.from,
    length: s.range.to - s.range.from,
    message: s.message,
    replacements: s.replacement === null ? [] : [s.replacement],
    rule: { id: `harper:${s.kind.replace(/^grammar:/, "")}`, category: "GRAMMAR" },
  }));
}

/** Lint the English runs of `text` with `linter`; offsets are into `text`. */
export async function harperCheck(text: string, linter: HarperLinterLike, opts: { signal?: AbortSignal; model?: string } = {}): Promise<WritingSuggestion[]> {
  const out: WritingSuggestion[] = [];
  for (const span of englishSpans(text)) {
    throwIfAborted(opts.signal);
    const part = text.slice(span.from, span.to);
    const lints = (await linter.lint(part, { language: "plaintext" })).map(lintData);
    throwIfAborted(opts.signal);
    out.push(...toSuggestions(part, span.from, lints, opts.model ?? "harper.js"));
  }
  return out;
}

/** Latency per paragraph, p50 and p95 in ms (W13.W17's measurement day uses it with the real linter). */
export async function lintLatency(linter: HarperLinterLike, paragraphs: readonly string[]): Promise<{ p50: number; p95: number; n: number }> {
  const ms: number[] = [];
  for (const p of paragraphs) {
    const t0 = performance.now();
    await linter.lint(p, { language: "plaintext" });
    ms.push(performance.now() - t0);
  }
  ms.sort((a, b) => a - b);
  const at = (q: number) => ms[Math.min(ms.length - 1, Math.floor(q * ms.length))] ?? 0;
  return { p50: at(0.5), p95: at(0.95), n: ms.length };
}

/**
 * Agreement with another checker on a labelled set (W13.W10's comparison
 * with a local LanguageTool): recall of each against the labelled spans.
 */
export function recallOn(items: ReadonlyArray<{ text: string; error: Span }>, found: ReadonlyArray<readonly Span[]>): number {
  if (!items.length) return 0;
  let hit = 0;
  items.forEach((it, i) => {
    if ((found[i] ?? []).some((s) => s.from < it.error.to && it.error.from < s.to)) hit++;
  });
  return hit / items.length;
}
