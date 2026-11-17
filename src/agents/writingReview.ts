/**
 * The one review path of the writing agents (plan W13.W1, joined by INT7
 * for W13.W6–W15): every finding becomes a checked W1 suggestion
 * (`fromFinding`, agents/writing/suggestion.ts) and reaches the note only
 * through the review panel (agents/staging), never straight to a file.
 * This module lives outside src/agents/writing on purpose: it is the one
 * place that stages; the agents under src/agents/writing only propose (the
 * static check, src/__tests__/helpers/writingStatic.ts).
 *
 * - A suggestion with a replacement becomes one staged range change in its
 *   note: the review panel shows its diff, and the user accepts or rejects
 *   each one. The staged change carries the context around the range and
 *   the fingerprint of the text it was computed on, so an edit made since
 *   is found again or refused, never misapplied.
 * - Suggestions without a replacement (comments: fact conflicts, structure,
 *   argument) are gathered in one report note, itself a staged file the
 *   user approves or rejects. Each item lists its reason and its links.
 * - A finding that is not a valid W1 suggestion for its text (a range off
 *   the text, a replacement equal to the original, an unknown kind) is
 *   dropped and counted, never staged.
 *
 * At most MAX_STAGED range changes are staged per run (the staging area
 * holds 200 pending); the rest are listed in the report.
 */
import { rangeContext, stageChange, textFingerprint } from "./staging";
import type { ChangeProposal, StagedChange } from "./types";
import { resolveParagraphAnchor } from "../ai/paragraphAnchors";
import { fromFinding, type CheckerFinding, type FindingSuggestion, type WritingSuggestion } from "./writing/suggestion";

export const REPORT_DIR = "בדיקות כתיבה";
export const MAX_STAGED = 150;

export interface ReportLabels {
  title: string;
  /** "{{n}} findings" */
  count: (n: number) => string;
  none: string;
  why: string;
  sources: string;
  staged: (n: number) => string;
  /** A finding's kind, as the user reads it. */
  kind: (kind: string) => string;
}

export interface StageInput {
  suggestions: readonly CheckerFinding[];
  /** The text each suggestion's offsets refer to, by path ("" = the open note when it has no path). */
  texts: ReadonlyMap<string, string>;
  agentId: string;
  tool: string;
  labels: ReportLabels;
  /** YYYY-MM-DD, for the report's name. */
  today: string;
  /** The report's current text, when the file exists (it is overwritten only on approval). */
  reportBefore?: string | null;
}

export interface StageResult {
  staged: StagedChange[];
  report: StagedChange | null;
  reportPath: string;
  /** Findings that were not valid W1 suggestions for their text (never staged). */
  dropped: number;
}

const noteName = (path: string) => path.replace(/\.(md|markdown)$/i, "");

/** One link as Markdown: a real block id as a wiki link, a virtual anchor as the note plus a quote of the paragraph. */
export function renderLink(link: string, texts: ReadonlyMap<string, string>): string {
  if (link.startsWith("entity:")) return `\`${link}\``;
  const hash = link.lastIndexOf("#");
  const path = hash >= 0 ? link.slice(0, hash) : link;
  const anchor = hash >= 0 ? link.slice(hash + 1) : "";
  if (anchor.startsWith("^")) return `[[${noteName(path)}#${anchor}]]`;
  const text = texts.get(path);
  const p = text && anchor ? resolveParagraphAnchor(text, anchor) : null;
  const quote = p ? p.text.replace(/\s+/g, " ").trim() : "";
  const short = quote.length > 140 ? `${quote.slice(0, 137)}…` : quote;
  return short ? `[[${noteName(path)}]] — «${short}»` : `[[${noteName(path)}]]`;
}

export function reportMarkdown(items: readonly FindingSuggestion[], input: Pick<StageInput, "texts" | "labels" | "today">, stagedCount: number): string {
  const { labels } = input;
  const out = [`# ${labels.title} · ${input.today}`, ""];
  out.push(items.length ? labels.count(items.length) : labels.none);
  if (stagedCount) out.push("", labels.staged(stagedCount));
  items.forEach((s, i) => {
    out.push("", `## ${i + 1}. ${labels.kind(s.ruleId ?? s.kind)}: ${s.message}`, "", `**${labels.why}:** ${s.rationale}`);
    const links = s.links?.length ? s.links : s.path ? [s.path] : [];
    if (links.length) out.push("", `**${labels.sources}:**`, ...links.map((l) => `- ${renderLink(l, input.texts)}`));
  });
  return `${out.join("\n")}\n`;
}

/** The review-queue proposal for a W1 suggestion with a replacement (null for advice, a blocked or a stale one). */
export function suggestionProposal(s: WritingSuggestion, text: string, path: string | null): ChangeProposal | null {
  if (s.replacement === null || s.blocked || text.slice(s.range.from, s.range.to) !== s.original) return null;
  const { from, to } = s.range;
  return { kind: "range", path, from, to, before: s.original, after: s.replacement, context: rangeContext(text, from, to), basis: textFingerprint(text), summary: s.message } as ChangeProposal;
}

/** A checker finding's proposal: the finding made a W1 suggestion for `text` first (null when it is not valid for it). */
export function toRangeProposal(f: CheckerFinding, text: string, path: string | null): ChangeProposal | null {
  try {
    return suggestionProposal(fromFinding(text, f), text, path);
  } catch {
    return null;
  }
}

/** One staged range change for a W1 suggestion with a replacement (null for advice, a blocked or a stale one). */
export function stageSuggestion(s: WritingSuggestion, text: string, path: string | null, meta: { tool: string; agentId?: string }): StagedChange | null {
  const p = suggestionProposal(s, text, path);
  return p ? stageChange(p, { tool: meta.tool, agentId: meta.agentId ?? s.agentId }) : null;
}

/** A checker's finding on `text`, as a W1 suggestion, staged (null when it is not valid for the text or has nothing to replace). */
export function stageFinding(f: CheckerFinding, text: string, path: string | null, meta: { tool: string }): StagedChange | null {
  let s: FindingSuggestion;
  try {
    s = fromFinding(text, f);
  } catch {
    return null;
  }
  return stageSuggestion(s, text, path, { tool: meta.tool, agentId: f.agentId });
}

/** Stage the suggestions (see the file comment). Nothing is written. */
export function stageWritingSuggestions(input: StageInput): StageResult {
  const staged: StagedChange[] = [];
  const comments: FindingSuggestion[] = [];
  let dropped = 0;
  for (const f of input.suggestions) {
    const text = input.texts.get(f.path ?? "");
    let s: FindingSuggestion;
    try {
      // A finding is checked against the text it was made on; without that text it is not a suggestion.
      if (text === undefined) throw new Error("no text");
      s = fromFinding(text, f);
    } catch {
      dropped++;
      continue;
    }
    if (s.replacement === null || s.blocked || staged.length >= MAX_STAGED) {
      comments.push(s);
      continue;
    }
    const c = stageSuggestion(s, text, s.path ?? null, { tool: input.tool, agentId: input.agentId });
    if (c) staged.push(c);
    else comments.push(s);
  }
  const reportPath = `${REPORT_DIR}/${input.agentId}-${input.today}.md`;
  const report = comments.length
    ? stageChange({ kind: "file", path: reportPath, before: input.reportBefore ?? null, after: reportMarkdown(comments, input, staged.length), summary: input.labels.count(comments.length) }, { tool: input.tool, agentId: input.agentId })
    : null;
  return { staged, report, reportPath, dropped };
}
