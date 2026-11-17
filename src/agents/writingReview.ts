/**
 * How the L5 writing checkers (W13.W6–W10) reach the user: through the
 * review panel, never straight to a file.
 *
 * - A suggestion with a replacement becomes one staged range change in its
 *   note (agents/staging): the review panel shows its diff, and the user
 *   accepts or rejects each one. The staged change carries the context
 *   around the range and the fingerprint of the text it was computed on,
 *   so an edit made since is found again or refused, never misapplied.
 * - Suggestions without a replacement (comments: fact conflicts, structure,
 *   argument) are gathered in one report note, itself a staged file the
 *   user approves or rejects. Each item lists its reason and its links.
 *
 * At most MAX_STAGED range changes are staged per run (the staging area
 * holds 200 pending); the rest are listed in the report.
 */
import { rangeContext, stageChange, textFingerprint } from "../staging";
import type { StagedChange } from "../types";
import { resolveParagraphAnchor } from "../../ai/paragraphAnchors";
import type { WritingSuggestion } from "./suggestionShape";

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
  suggestions: readonly WritingSuggestion[];
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

export function reportMarkdown(items: readonly WritingSuggestion[], input: Pick<StageInput, "texts" | "labels" | "today">, stagedCount: number): string {
  const { labels } = input;
  const out = [`# ${labels.title} · ${input.today}`, ""];
  out.push(items.length ? labels.count(items.length) : labels.none);
  if (stagedCount) out.push("", labels.staged(stagedCount));
  items.forEach((s, i) => {
    out.push("", `## ${i + 1}. ${labels.kind(s.kind)}: ${s.message}`, "", `**${labels.why}:** ${s.rationale}`);
    const links = s.links?.length ? s.links : s.path ? [s.path] : [];
    if (links.length) out.push("", `**${labels.sources}:**`, ...links.map((l) => `- ${renderLink(l, input.texts)}`));
  });
  return `${out.join("\n")}\n`;
}

/** Stage the suggestions (see the file comment). Nothing is written. */
export function stageWritingSuggestions(input: StageInput): StageResult {
  const staged: StagedChange[] = [];
  const comments: WritingSuggestion[] = [];
  for (const s of input.suggestions) {
    const text = input.texts.get(s.path ?? "");
    if (s.replacement === null || text === undefined || staged.length >= MAX_STAGED) {
      comments.push(s);
      continue;
    }
    const { from, to } = s.range;
    staged.push(
      stageChange(
        { kind: "range", path: s.path ?? null, from, to, before: text.slice(from, to), after: s.replacement, context: rangeContext(text, from, to), basis: textFingerprint(text), summary: s.message },
        { tool: input.tool, agentId: input.agentId },
      ),
    );
  }
  const reportPath = `${REPORT_DIR}/${input.agentId}-${input.today}.md`;
  const report = comments.length
    ? stageChange({ kind: "file", path: reportPath, before: input.reportBefore ?? null, after: reportMarkdown(comments, input, staged.length), summary: input.labels.count(comments.length) }, { tool: input.tool, agentId: input.agentId })
    : null;
  return { staged, report, reportPath };
}
