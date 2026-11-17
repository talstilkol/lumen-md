/**
 * Plan W13.W2 — scoring the writing agents on their eval sets
 * (eval/writing/<agent>/{he,en}.jsonl, scripts/eval/writing-sets.mjs).
 *
 *  - detectors (styleCoach): span precision and recall — a finding counts
 *    when its kind family matches an expected span it overlaps;
 *  - the rewriting agents' guards (toneShifter, concision): recall on the
 *    rewrites that changed a fact (the guard must block every one) and
 *    precision (how many blocks were right), plus the length check.
 * Per-item 0/1 scores are returned so the card's bootstrap intervals are
 * computed from them (scripts/lib/evalCard.mjs makeCard).
 */
import { coachRules } from "../../agents/writing/agents/styleCoach";
import { checkFacts } from "../../agents/writing/facts";
import { checkResult } from "../../agents/writing/agents/concision";
import type { WritingSuggestion } from "../../agents/writing/suggestion";

export type Split = "dev" | "heldout";

const FAMILY: Record<string, string> = { passive: "passive", nominalization: "nominalization", wordiness: "wordiness", redundancy: "redundancy", hedge: "hedge", repetition: "repetition", clarity: "clarity" };

export interface CoachItem {
  id: string;
  lang: "he" | "en";
  split: Split;
  level: "everyday" | "professional" | "academic";
  text: string;
  expect: Array<{ kind: string; text: string }>;
}

export interface SpanScores {
  /** One entry per finding: 1 when it matched an expected span. */
  precision: number[];
  /** One entry per expected span: 1 when a finding matched it. */
  recall: number[];
  ms: number[];
}

export function scoreCoach(items: readonly CoachItem[], find: (it: CoachItem) => WritingSuggestion[] = (it) => coachRules(it.text, it.lang, it.level)): SpanScores {
  const precision: number[] = [];
  const recall: number[] = [];
  const ms: number[] = [];
  for (const it of items) {
    const t0 = performance.now();
    const found = find(it);
    ms.push(performance.now() - t0);
    const spans = it.expect.map((e) => {
      const from = it.text.indexOf(e.text);
      return { kind: FAMILY[e.kind] ?? e.kind, from, to: from + e.text.length, hit: false };
    });
    for (const f of found) {
      const fam = FAMILY[f.kind] ?? f.kind;
      const m = spans.find((s) => s.kind === fam && s.from >= 0 && f.range.from < s.to && s.from < f.range.to);
      if (m) m.hit = true;
      precision.push(m ? 1 : 0);
    }
    for (const s of spans) recall.push(s.hit ? 1 : 0);
  }
  return { precision, recall, ms };
}

export interface ToneItem {
  id: string;
  lang: "he" | "en";
  split: Split;
  source: string;
  rewrite: string;
  label: "kept" | "changed";
}

/** The guard on tone rewrites: recall = changed rewrites it blocked; precision = blocks that were right; kept = kept rewrites it let through. */
export function scoreToneGuard(items: readonly ToneItem[]): { recall: number[]; precision: number[]; passKept: number[] } {
  const recall: number[] = [];
  const precision: number[] = [];
  const passKept: number[] = [];
  for (const it of items) {
    const blocked = !checkFacts(it.source, it.rewrite, it.lang).ok;
    if (it.label === "changed") recall.push(blocked ? 1 : 0);
    else passKept.push(blocked ? 0 : 1);
    if (blocked) precision.push(it.label === "changed" ? 1 : 0);
  }
  return { recall, precision, passKept };
}

export interface ConcisionItem {
  id: string;
  lang: "he" | "en";
  split: Split;
  source: string;
  result: string;
  percent: number;
  defect: string | null;
  factsOk: boolean;
  lengthOk: boolean;
}

/** The concision checks: invented / lost facts caught (recall), clean results passed, and the length check against an independent count. */
export function scoreConcision(items: readonly ConcisionItem[]): { factRecall: number[]; factPass: number[]; inventedCaught: number[]; lengthAgree: number[] } {
  const factRecall: number[] = [];
  const factPass: number[] = [];
  const inventedCaught: number[] = [];
  const lengthAgree: number[] = [];
  for (const it of items) {
    const c = checkResult(it.source, it.result, it.lang, { mode: "shorten", percent: it.percent });
    if (!it.factsOk) factRecall.push(c.facts.ok ? 0 : 1);
    else factPass.push(c.facts.ok ? 1 : 0);
    if (it.defect?.startsWith("invented")) inventedCaught.push(c.facts.ok ? 0 : 1);
    lengthAgree.push(c.lengthOk === it.lengthOk ? 1 : 0);
  }
  return { factRecall, factPass, inventedCaught, lengthAgree };
}

export const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
