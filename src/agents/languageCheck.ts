/**
 * The answer-language checks of the runtime (plans 2.6, 6.5), moved out of
 * runtime.ts unchanged (R12.18 needed the room; runtime.ts may not grow past
 * its max-lines baseline). runtime.ts re-exports both.
 */
import { hebrewRatio } from "../text/hebrew";

/**
 * The script check behind it: a mostly-Hebrew input must not get a
 * mostly-Latin answer. Short answers (under 20 letters) and non-Hebrew
 * inputs pass — they say too little to judge. Code (fenced blocks, inline
 * code spans, HTML tags) is not prose and does not count.
 */
export function sameScript(inputText: string, output: unknown): { ok: true } | { ok: false; reason: string; hint: string } {
  if (hebrewRatio(inputText) < 0.5) return { ok: true };
  const raw = typeof output === "string" ? output : JSON.stringify(output ?? "").replace(/"[\w$-]+":/g, " ");
  const text = raw
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/<\/?[A-Za-z][^<>]*>/g, " ");
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < 20) return { ok: true };
  const r = hebrewRatio(text);
  if (r >= 0.15) return { ok: true };
  return { ok: false, reason: `the input is Hebrew but the answer is ${Math.round(r * 100)}% Hebrew`, hint: "Answer in Hebrew, the language of the user's text." };
}

const LANGUAGE_NAMES: Record<string, string> = { he: "Hebrew", en: "English", ar: "Arabic", ru: "Russian", fr: "French", de: "German", ja: "Japanese", zh: "Chinese", es: "Spanish", it: "Italian", pt: "Portuguese", nl: "Dutch", uk: "Ukrainian", fa: "Persian", tr: "Turkish", pl: "Polish" };
const languageName = (tag: string) => LANGUAGE_NAMES[tag] ?? tag;

/**
 * The language check (plan 6.5): `sameScript` first; then, where input and
 * answer share a script (French in, English out), local language
 * identification decides. It acts only when both texts are long enough for
 * a confident guess, so a short or mixed answer is never rejected on it.
 */
export async function sameLanguage(inputText: string, output: unknown): Promise<{ ok: true } | { ok: false; reason: string; hint: string }> {
  const script = sameScript(inputText, output);
  if (!script.ok || hebrewRatio(inputText) >= 0.5) return script;
  const raw = typeof output === "string" ? output : JSON.stringify(output ?? "").replace(/"[\w$-]+":/g, " ");
  let detect: typeof import("../text/langId").detectLanguage;
  try {
    ({ detectLanguage: detect } = await import("../text/langId"));
  } catch {
    return { ok: true }; // the detector chunk failed to load: keep the script check only
  }
  const a = detect(inputText);
  const b = detect(raw);
  if (!a.confident || !b.confident || a.lang === "und" || b.lang === "und" || a.lang === b.lang || a.script !== b.script) return { ok: true };
  return { ok: false, reason: `the input is ${languageName(a.lang)} but the answer is ${languageName(b.lang)}`, hint: `Answer in ${languageName(a.lang)}, the language of the user's text.` };
}
