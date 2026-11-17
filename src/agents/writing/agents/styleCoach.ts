/**
 * The clarity and style coach (plan W13.W3): Hemingway / ProWritingAid's
 * checks, in Hebrew too, on this device. Local rules find long sentences,
 * passives (״נעשה על ידי״, "was written by"), action nouns (״ביצוע של״,
 * "make a decision"), hedges and fillers, wordy phrases (״באופן ש״,
 * "in order to") and redundant or doubled words; a small local model, when
 * one is set up, ranks the findings to drop false alarms. The level
 * (everyday / professional / academic) decides which rules run and how
 * long a sentence may be.
 *
 * Budget: ≤ 150 ms a paragraph with rules only; with the model, the ranking
 * step gets what is left of 600 ms and is skipped when it runs out (the
 * card shows the unranked findings rather than wait).
 */
import { checkAbort, registerWritingAgent, type WritingAgent, type WritingContext, type WritingLevel } from "../agent";
import { jsonIn, withTimeout, type LocalModel } from "../model";
import { makeSuggestion, type WritingSuggestion } from "../suggestion";
import { DOUBLE_OK, isPassiveFalseAlarm, LONG_SENTENCE, STYLE_RULES, type StyleRule } from "./styleRules";

export const STYLE_COACH_ID = "styleCoach";
/** The ranking step's budget, so rules + ranking stay under 600 ms. */
export const RANK_BUDGET_MS = 450;
/** Below this model score a finding is dropped as a false alarm. */
export const RANK_DROP = 0.35;

const WORD = /[\p{L}\p{M}\p{N}]+(?:['’׳״"\-־][\p{L}\p{M}\p{N}]+)*/gu;

/** Sentences with their offsets: they end at . ! ? before a space (not "3.5", not "e.g."), and at line breaks. */
export function sentences(text: string): Array<{ from: number; to: number; text: string }> {
  const out: Array<{ from: number; to: number; text: string }> = [];
  let start = 0;
  for (const m of text.matchAll(/[.!?]+(?=\s|$)|\n+/g)) {
    const end = m.index! + m[0].length;
    if (m[0][0] === "." && /(?:^|[\s(])(?:e\.g|i\.e|etc|Dr|Mr|Mrs|Ms|vs|St|No|Prof|cf|[A-Z])$/.test(text.slice(start, m.index))) continue;
    if (/\S/.test(text.slice(start, end))) out.push({ from: start, to: end, text: text.slice(start, end) });
    start = end;
  }
  if (/\S/.test(text.slice(start))) out.push({ from: start, to: text.length, text: text.slice(start) });
  return out;
}

/** Hebrew points and cantillation (U+0591–U+05C7, not the maqaf): the rules read the text without them. */
const MARK = /[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/;

/** The text without marks, and where each of its characters is in the original. */
export function unpointed(text: string): { plain: string; at: number[] } {
  let plain = "";
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (MARK.test(text[i])) continue;
    plain += text[i];
    at.push(i);
  }
  at.push(text.length);
  return { plain, at };
}

const ruleOn = (r: StyleRule, lang: "he" | "en", level: WritingLevel) => r.lang === lang && (r.levels ?? ["everyday", "professional", "academic"]).includes(level);

/** Removing a filler: take the comma and space after it, and capitalise what then starts the sentence. */
function removal(text: string, from: number, to: number): { from: number; to: number; insert: string } {
  let start = from;
  let end = to;
  if (text[end] === ",") end++;
  // One space goes with it: the one after ("very good" → "good"), else the one before ("good, really." → "good.").
  if (text[end] === " ") end++;
  else if (text[start - 1] === " ") {
    start--;
    if (text[start - 1] === "," && /^[.!?;:]/.test(text.slice(end))) start--;
  }
  const atStart = start === 0 || /[.!?\n]\s*$/.test(text.slice(0, start));
  const next = text[end];
  if (atStart && next && /\p{Ll}/u.test(next)) {
    // The whole next word, so the card reads "Basically, the" → "The", not "Basically, t" → "T".
    const word = /^[\p{L}\p{M}'’-]+/u.exec(text.slice(end))![0];
    return { from: start, to: end + word.length, insert: word[0].toUpperCase() + word.slice(1) };
  }
  return { from: start, to: end, insert: "" };
}

/**
 * The rule findings of a text (no model). Pointed Hebrew (niqqud) is read
 * without its marks and the findings are mapped back to the pointed text;
 * a fix there is written unpointed.
 */
export function coachRules(text: string, lang: "he" | "en", level: WritingLevel): WritingSuggestion[] {
  if (!MARK.test(text)) return coachPlain(text, lang, level);
  const { plain, at } = unpointed(text);
  const out: WritingSuggestion[] = [];
  for (const s of coachPlain(plain, lang, level)) {
    let to = at[s.range.to - 1] + 1;
    while (to < text.length && MARK.test(text[to])) to++;
    const from = s.range.to > s.range.from ? at[s.range.from] : at[s.range.from];
    try {
      out.push(makeSuggestion(text, { ...s, id: undefined, range: { from, to } }));
    } catch {
      /* why: a fix that only removed the marks is not a suggestion */
    }
  }
  return out;
}

function coachPlain(text: string, lang: "he" | "en", level: WritingLevel): WritingSuggestion[] {
  const out: WritingSuggestion[] = [];
  // Which characters a finding already covers: a lookup per character, not per finding (a 10 000-paragraph note has 20 000 findings).
  const taken = new Uint8Array(text.length + 1);
  const free = (a: number, b: number) => {
    for (let i = a; i < b; i++) if (taken[i]) return false;
    return true;
  };
  const add = (r: { id: string; kind: WritingSuggestion["kind"]; confidence: number; en: string; he: string }, from: number, to: number, replacement: string | null, rationale: string) => {
    if (!free(from, to) || to <= from) return;
    try {
      out.push(makeSuggestion(text, { range: { from, to }, kind: r.kind, message: lang === "he" ? r.he : r.en, rationale, confidence: r.confidence, replacement, agentId: STYLE_COACH_ID, model: "rules", ruleId: r.id }));
      taken.fill(1, from, to);
    } catch {
      /* why: a fix equal to the original (case-only) is not a suggestion */
    }
  };
  for (const r of STYLE_RULES) {
    if (!ruleOn(r, lang, level)) continue;
    r.re.lastIndex = 0;
    for (const m of text.matchAll(r.re)) {
      const from = m.index!;
      const to = from + m[0].length;
      if (r.kind === "passive" && lang === "en" && (isPassiveFalseAlarm(m[1]) && !m[2])) continue;
      if (r.kind === "repetition" && DOUBLE_OK[lang].has(m[1].toLowerCase())) continue;
      const rationale = `${r.id}${level !== "everyday" ? ` (${level})` : ""}`;
      if (r.fix === null) {
        const conf = r.kind === "passive" && lang === "en" ? (m[2] ? 0.8 : level === "academic" ? 0.45 : 0.6) : r.confidence;
        add({ ...r, confidence: conf }, from, to, null, rationale);
        continue;
      }
      const fix = r.fix(m as unknown as RegExpExecArray);
      if (fix === "" || (r.kind === "hedge" && !fix)) {
        // Keep the match's own trailing space out: removal() decides the spacing.
        const core = m[0].replace(/\s+$/, "");
        const rm = removal(text, from, from + core.length);
        if (!free(rm.from, rm.to)) continue;
        add(r, rm.from, rm.to, rm.insert, rationale);
      } else add(r, from, to, fix, rationale);
    }
  }
  // Long sentences: advice, last, so a fix inside one still shows.
  const limit = LONG_SENTENCE[lang][level];
  for (const s of sentences(text)) {
    const n = s.text.match(WORD)?.length ?? 0;
    if (n <= limit) continue;
    const lead = s.text.length - s.text.trimStart().length;
    const tail = s.text.length - s.text.trimEnd().length;
    const from = s.from + lead;
    const to = s.to - tail;
    try {
      out.push(
        makeSuggestion(text, {
          range: { from, to },
          kind: "clarity",
          message: lang === "he" ? `משפט ארוך: ${n} מילים (עד ${limit})` : `Long sentence: ${n} words (up to ${limit})`,
          rationale: `long-sentence > ${limit} (${level})`,
          confidence: Math.min(0.95, 0.6 + (n - limit) / 40),
          replacement: null,
          agentId: STYLE_COACH_ID,
          model: "rules",
          ruleId: `${lang}.longSentence`,
        }),
      );
    } catch {
      /* why: an empty range is not a finding */
    }
  }
  return out.sort((a, b) => a.range.from - b.range.from);
}

/**
 * The model's ranking: each finding with its sentence, scored 0..1 for
 * "a real improvement here". Findings under RANK_DROP go; the others keep
 * the mean of the rule's and the model's confidence. A failed or late
 * ranking returns the findings unchanged.
 */
export async function rankFindings(text: string, list: WritingSuggestion[], model: LocalModel, signal: AbortSignal, lang: "he" | "en"): Promise<WritingSuggestion[]> {
  if (!list.length) return list;
  const lines = list.slice(0, 40).map((s, i) => `${i + 1}. [${s.kind}] "${s.original.slice(0, 120)}"${s.replacement !== null ? ` → "${s.replacement.slice(0, 120)}"` : ""}`);
  try {
    const ans = await model(
      {
        system:
          "You rank writing-style findings. For each numbered finding, judge whether changing it would really improve the text (not a false alarm: an idiom, a quote, a needed passive, a term). " +
          'Answer ONLY JSON: {"scores": [numbers 0..1, one per finding, in order]}.',
        user: `Language: ${lang}\nText:\n${text.slice(0, 3000)}\n\nFindings:\n${lines.join("\n")}`,
        temperature: 0,
        maxTokens: 200,
        tier: "tiny",
      },
      withTimeout(signal, RANK_BUDGET_MS),
    );
    const scores = jsonIn<{ scores?: unknown[] }>(ans.text)?.scores;
    if (!Array.isArray(scores)) return list;
    return list.flatMap((s, i) => {
      const v = Number(scores[i]);
      if (i >= scores.length || !Number.isFinite(v)) return [s];
      if (v < RANK_DROP) return [];
      return [{ ...s, confidence: Math.round(((s.confidence + Math.max(0, Math.min(1, v))) / 2) * 1000) / 1000, rationale: `${s.rationale}; ranked ${v.toFixed(2)} by ${ans.model}` }];
    });
  } catch (e) {
    checkAbort(signal);
    void e;
    return list;
  }
}

export const styleCoach: WritingAgent = registerWritingAgent({
  id: STYLE_COACH_ID,
  kind: "detector",
  needsModel: false,
  async run(ctx: WritingContext) {
    checkAbort(ctx.signal);
    const found = coachRules(ctx.text, ctx.lang, ctx.level);
    if (!ctx.model || !found.length) return found;
    return rankFindings(ctx.text, found, ctx.model, ctx.signal, ctx.lang);
  },
});
