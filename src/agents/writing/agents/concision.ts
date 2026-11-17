/**
 * Shorten and expand (plan W13.W5): "shorten by 30%" and "turn these
 * bullets into a paragraph" — the most used Writing Tools actions, where
 * the danger is invention. So the checks are part of the agent:
 *  - length: words are counted the way a Hebrew writer counts them (W5.8,
 *    book/wordCount), and a shortened text must land within ±10% of the
 *    target; a miss is retried with the count it got, twice at most;
 *  - nothing invented: every number and name of the result is in the
 *    source (facts.ts), and nothing the source states is lost; a negation
 *    may not flip;
 *  - an expansion is the model's text: accepted, it carries the AI tag
 *    (5.9; `aiAuthored` follows from `model`).
 * A result that still fails is shown blocked, with what it changed.
 */
import { countWords } from "../../../book/wordCount";
import { checkAbort, registerWritingAgent, type WritingAgent, type WritingContext } from "../agent";
import { checkFacts, factProblem, type EntityFinder, type FactReport } from "../facts";
import type { LocalModel } from "../model";
import { makeSuggestion, type WritingSuggestion } from "../suggestion";

export const CONCISION_ID = "concision";
export const LENGTH_TOLERANCE = 0.1;
export const MAX_ATTEMPTS = 3;

export interface ConcisionOptions {
  mode: "shorten" | "expand";
  /** Shorten by this share (default 30 %). */
  percent?: number;
  entities?: EntityFinder;
}

/** The word target of "shorten by p %". */
export function targetWords(text: string, percent = 30): number {
  return Math.max(1, Math.round(countWords(text) * (1 - percent / 100)));
}

/** Whether `n` words is within ±10 % of `target` (at least one word of slack). */
export function inRange(n: number, target: number, tol = LENGTH_TOLERANCE): boolean {
  return Math.abs(n - target) <= Math.max(1, Math.round(target * tol));
}

/** Bullets (- * + or 1.) as plain lines, for the expand prompt and its check. */
export function bulletsOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*+•]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "").trim())
    .filter(Boolean);
}

export interface ConcisionCheck {
  words: number;
  target: number | null;
  lengthOk: boolean;
  facts: FactReport;
  ok: boolean;
}

/** The two checks on one result. */
export function checkResult(source: string, result: string, lang: "he" | "en", o: ConcisionOptions): ConcisionCheck {
  const words = countWords(result);
  const target = o.mode === "shorten" ? targetWords(source, o.percent) : null;
  const lengthOk = target === null ? words > countWords(source) * 0.9 : inRange(words, target);
  const facts = checkFacts(source, result, lang, { entities: o.entities });
  return { words, target, lengthOk, facts, ok: lengthOk && facts.ok };
}

function prompt(text: string, lang: "he" | "en", o: ConcisionOptions, feedback: string): { system: string; user: string } {
  const language = lang === "he" ? "Hebrew" : "English";
  if (o.mode === "expand") {
    return {
      system:
        `Turn the bullet points into one well-written paragraph in ${language}. Use only what the bullets say: add no facts, numbers, names, dates or examples, and keep every one of theirs; keep every negation. ` +
        "Connect the points with natural transitions. Answer with the paragraph only.",
      user: `${feedback}Bullets:\n${bulletsOf(text).map((b) => `- ${b}`).join("\n")}`,
    };
  }
  const target = targetWords(text, o.percent);
  return {
    system:
      `Shorten the text in ${language} to about ${target} words (it has ${countWords(text)}). Keep every number, name, date and negation exactly; add nothing. ` +
      "Cut repetition, filler and wordy phrases before content. Keep Markdown formatting. Answer with the shortened text only.",
    user: `${feedback}Text:\n${text}`,
  };
}

const clean = (s: string) => s.replace(/^```[a-z]*\n?|\n?```$/g, "").replace(/^\s*(?:Shortened text|Paragraph|טקסט מקוצר|פסקה)\s*:\s*/i, "").trim();

/** Runs the model until a result passes both checks, or MAX_ATTEMPTS. */
export async function concise(text: string, lang: "he" | "en", o: ConcisionOptions, model: LocalModel, signal: AbortSignal): Promise<{ result: string; check: ConcisionCheck; attempts: number; model: string } | null> {
  let feedback = "";
  let last: { result: string; check: ConcisionCheck; attempts: number; model: string } | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    checkAbort(signal);
    const { system, user } = prompt(text, lang, o, feedback);
    const ans = await model({ system, user, temperature: attempt === 1 ? 0.2 : 0.4, maxTokens: Math.min(2500, 100 + text.length * (o.mode === "expand" ? 4 : 2)), tier: "small" }, signal);
    const result = clean(ans.text);
    if (!result) continue;
    const check = checkResult(text, result, lang, o);
    last = { result, check, attempts: attempt, model: ans.model };
    if (check.ok) return last;
    const notes: string[] = [];
    if (!check.lengthOk && check.target !== null) notes.push(`Your previous answer had ${check.words} words; the target is ${check.target}.`);
    if (!check.facts.ok) notes.push(`Your previous answer changed facts (${factProblem(check.facts, "en")}); keep exactly the source's facts.`);
    feedback = `${notes.join(" ")}\n\n`;
  }
  return last;
}

export function concisionSuggestion(text: string, out: { result: string; check: ConcisionCheck; attempts: number; model: string }, lang: "he" | "en", o: ConcisionOptions): WritingSuggestion {
  const lead = text.length - text.trimStart().length;
  const core = text.trim();
  const { check } = out;
  const he = lang === "he";
  const message =
    o.mode === "expand"
      ? he ? "נקודות → פסקה" : "Bullets → paragraph"
      : he ? `קיצור ב־${o.percent ?? 30}%: ${countWords(core)} → ${check.words} מילים` : `Shorten by ${o.percent ?? 30}%: ${countWords(core)} → ${check.words} words`;
  const problems = [!check.lengthOk && check.target !== null ? (he ? `מחוץ לטווח האורך (יעד ${check.target})` : `outside the length range (target ${check.target})`) : "", check.facts.ok ? "" : factProblem(check.facts, lang)].filter(Boolean).join("; ");
  const s = makeSuggestion(text, {
    range: { from: lead, to: lead + core.length },
    kind: o.mode === "expand" ? "expansion" : "concision",
    message,
    rationale: problems || (he ? `כל המספרים והשמות נשמרו; ניסיון ${out.attempts}` : `every number and name kept; attempt ${out.attempts}`),
    confidence: check.ok ? 0.75 : 0.2,
    replacement: out.result === core ? `${out.result} ` : out.result,
    agentId: CONCISION_ID,
    model: out.model,
    ruleId: `concision.${o.mode}`,
  });
  return check.ok ? s : { ...s, blocked: problems };
}

export const concisionAgent: WritingAgent = registerWritingAgent({
  id: CONCISION_ID,
  kind: "generator",
  needsModel: true,
  async run(ctx: WritingContext) {
    checkAbort(ctx.signal);
    if (!ctx.model || !ctx.text.trim()) return [];
    const o = { mode: "shorten", percent: 30, ...(ctx.options ?? {}) } as ConcisionOptions;
    const out = await concise(ctx.text.trim(), ctx.lang, o, ctx.model, ctx.signal);
    return out ? [concisionSuggestion(ctx.text, out, ctx.lang, o)] : [];
  },
});
