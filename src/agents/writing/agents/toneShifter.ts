/**
 * The tone and register shifter (plan W13.W4): formal / neutral / friendly,
 * and in Hebrew high (גבוהה) or spoken (מדוברת) register — in Hebrew the
 * register is grammar, not only style (אינו / לא, כיצד / איך, סמיכות).
 * The local model writes three versions; each is checked against the
 * source by the fact guard (facts.ts): the same numbers, the same names,
 * the same negations. Versions that pass are offered, the first as the
 * replacement and the others as alternatives; when none passes, the card
 * shows the first one blocked, with what it changed.
 */
import { checkAbort, registerWritingAgent, type WritingAgent, type WritingContext } from "../agent";
import { checkFacts, factProblem, type EntityFinder } from "../facts";
import { jsonIn } from "../model";
import { makeSuggestion, type WritingSuggestion } from "../suggestion";

export const TONE_SHIFTER_ID = "toneShifter";
export type Tone = "formal" | "neutral" | "friendly";
export type HebrewRegister = "high" | "spoken";
export const TONES: readonly Tone[] = ["formal", "neutral", "friendly"];
export const VERSIONS = 3;

export interface ToneOptions {
  tone: Tone;
  /** Hebrew only. */
  register?: HebrewRegister;
  /** The user's style profile as an instruction (ai/styleProfiles styleInstruction), when they turned it on. */
  styleInstruction?: string;
  /** The app's NER for the fact guard (W11.H11), when loaded. */
  entities?: EntityFinder;
}

const TONE_EN: Record<Tone, string> = {
  formal: "formal and courteous: complete sentences, no contractions, no slang, precise words",
  neutral: "neutral and plain: clear, direct, neither stiff nor chatty",
  friendly: "friendly and warm: conversational, short sentences, contractions are fine, still respectful",
};
const REGISTER_HE: Record<HebrewRegister, string> = {
  high: "עברית גבוהה ותקנית: אינו/אינה במקום לא לפני שם או תואר כשמתאים, כיצד במקום איך, מדוע במקום למה, סמיכות במקום ״של״ כשטבעי, בלי סלנג ובלי מילים לועזיות מיותרות",
  spoken: "עברית מדוברת וטבעית: איך, למה, משפטים קצרים, מילים יומיומיות — בלי סלנג גס ובלי שגיאות דקדוק",
};

export function tonePrompt(text: string, lang: "he" | "en", o: ToneOptions): { system: string; user: string } {
  const reg = lang === "he" && o.register ? `\nRegister (Hebrew): ${REGISTER_HE[o.register]}` : "";
  const style = o.styleInstruction ? `\nFollow the writer's own style where it does not contradict the tone:\n${o.styleInstruction}` : "";
  return {
    system:
      `You rewrite text in a requested tone. Keep the meaning exactly: every number, name, date and negation stays as it is; add no facts, drop none. ` +
      `Write in the language of the text (${lang === "he" ? "Hebrew" : "English"}). Keep Markdown formatting. ` +
      `Answer ONLY JSON: {"versions": ["…", "…", "…"]} with ${VERSIONS} different rewrites.`,
    user: `Tone: ${TONE_EN[o.tone]}${reg}${style}\n\nText:\n${text}`,
  };
}

const LABEL: Record<Tone, { en: string; he: string }> = {
  formal: { en: "Formal tone", he: "טון רשמי" },
  neutral: { en: "Neutral tone", he: "טון ניטרלי" },
  friendly: { en: "Friendly tone", he: "טון ידידותי" },
};
const REG_LABEL: Record<HebrewRegister, string> = { high: "עברית גבוהה", spoken: "עברית מדוברת" };

/** The versions of a model answer (JSON, or numbered lines as a fallback), trimmed, distinct, not the source. */
export function versionsOf(answer: string, source: string): string[] {
  const parsed = jsonIn<{ versions?: unknown }>(answer)?.versions;
  const raw = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : answer.split(/\n(?=\s*\d+[.)]\s)/).map((l) => l.replace(/^\s*\d+[.)]\s*/, ""));
  const seen = new Set<string>();
  return raw.map((v) => v.trim()).filter((v) => v && v !== source.trim() && !seen.has(v) && (seen.add(v), true)).slice(0, VERSIONS);
}

/** The suggestion for a passage from its versions: the guard decides what can be accepted. */
export function toneSuggestion(text: string, versions: readonly string[], lang: "he" | "en", o: ToneOptions, model: string): WritingSuggestion | null {
  if (!versions.length) return null;
  const lead = text.length - text.trimStart().length;
  const core = text.trim();
  const checked = versions.map((v) => ({ v, r: checkFacts(core, v, lang, { entities: o.entities }) }));
  const pass = checked.filter((c) => c.r.ok).map((c) => c.v);
  const label = `${LABEL[o.tone][lang]}${lang === "he" && o.register ? ` · ${REG_LABEL[o.register]}` : ""}`;
  const base = {
    range: { from: lead, to: lead + core.length },
    kind: (lang === "he" && o.register ? "register" : "tone") as WritingSuggestion["kind"],
    agentId: TONE_SHIFTER_ID,
    model,
    ruleId: `tone.${o.tone}${o.register ? `.${o.register}` : ""}`,
  };
  if (pass.length) {
    return makeSuggestion(text, {
      ...base,
      message: label,
      rationale: lang === "he" ? `${pass.length} מתוך ${versions.length} גרסאות שמרו על כל המספרים, השמות והשלילות` : `${pass.length} of ${versions.length} versions kept every number, name and negation`,
      confidence: 0.55 + 0.1 * pass.length,
      replacement: pass[0],
      alternatives: pass.length > 1 ? pass.slice(1) : undefined,
    });
  }
  const problem = factProblem(checked[0].r, lang);
  return { ...makeSuggestion(text, { ...base, message: label, rationale: problem, confidence: 0.2, replacement: checked[0].v }), blocked: problem };
}

export const toneShifter: WritingAgent = registerWritingAgent({
  id: TONE_SHIFTER_ID,
  kind: "generator",
  needsModel: true,
  async run(ctx: WritingContext) {
    checkAbort(ctx.signal);
    if (!ctx.model || !ctx.text.trim()) return [];
    const o = { tone: "neutral", ...(ctx.options ?? {}) } as ToneOptions;
    const { system, user } = tonePrompt(ctx.text.trim(), ctx.lang, o);
    const ans = await ctx.model({ system, user, temperature: 0.7, maxTokens: Math.min(2000, 200 + ctx.text.length * 3), tier: "small" }, ctx.signal);
    checkAbort(ctx.signal);
    const s = toneSuggestion(ctx.text, versionsOf(ans.text, ctx.text), ctx.lang, o, ans.model);
    return s ? [s] : [];
  },
});
