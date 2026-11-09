/**
 * Read a note aloud (T32) with the system's own voices (Web Speech API) —
 * on macOS / Windows / Android that includes Hebrew. Nothing leaves the
 * device. Text is spoken sentence by sentence; each sentence's range in the
 * document is reported so the editor can highlight what is being read.
 */
import { hebrewRatio } from "../text/hebrew";

export interface Sentence {
  text: string;
  from: number;
  to: number;
}

/** Markdown → speakable sentences with their source ranges. */
export function speakableSentences(markdown: string): Sentence[] {
  const out: Sentence[] = [];
  // Skip frontmatter and fenced code: nobody wants code read aloud.
  const skip: Array<[number, number]> = [];
  const fm = /^---\n[\s\S]*?\n---\n/.exec(markdown);
  if (fm) skip.push([0, fm[0].length]);
  for (const m of markdown.matchAll(/^```[\s\S]*?^```/gm)) skip.push([m.index!, m.index! + m[0].length]);
  const inSkip = (i: number) => skip.some(([a, b]) => i >= a && i < b);
  // A sentence ends at . ! ? followed by whitespace — "x.y" (URLs, 3.5) doesn't.
  const re = /[^.!?。؟\n]+(?:[.!?。؟]+(?=[^\s.!?。؟])[^.!?。؟\n]*)*[.!?。؟]*/g;
  for (const m of markdown.matchAll(re)) {
    const from = m.index!;
    if (inSkip(from)) continue;
    const text = m[0]
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_a, t, alias) => alias ?? t)
      .replace(/[#>*_`~|-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (/[\p{L}\p{N}]/u.test(text)) out.push({ text, from, to: from + m[0].length });
  }
  return out;
}

/** BCP-47 language for a sentence: Hebrew script → he-IL, else the UI's. */
export function langFor(text: string, fallback: string): string {
  if (hebrewRatio(text) > 0.3) return "he-IL";
  if (/[؀-ۿ]/.test(text)) return "ar";
  return fallback;
}

export function ttsAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

function voiceFor(lang: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const base = lang.split("-")[0].toLowerCase();
  return voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ?? voices.find((v) => v.lang.toLowerCase().startsWith(base)) ?? (base === "he" ? voices.find((v) => v.lang.toLowerCase().startsWith("iw")) : undefined);
}

let speaking = false;

export function isSpeaking(): boolean {
  return speaking;
}

export function stopSpeaking(): void {
  speaking = false;
  if (ttsAvailable()) window.speechSynthesis.cancel();
}

/**
 * Speak `markdown`. `onSentence` gets each sentence as it starts; resolves
 * when done or stopped. Returns false when a needed voice is missing.
 */
export async function speak(markdown: string, opts: { uiLang: string; rate?: number; onSentence?: (s: Sentence) => void }): Promise<boolean> {
  if (!ttsAvailable()) return false;
  stopSpeaking();
  const sentences = speakableSentences(markdown);
  if (!sentences.length) return true;
  speaking = true;
  let hadVoice = true;
  for (const s of sentences) {
    if (!speaking) break;
    const lang = langFor(s.text, opts.uiLang === "he" ? "he-IL" : opts.uiLang);
    const u = new SpeechSynthesisUtterance(s.text);
    u.lang = lang;
    const v = voiceFor(lang);
    if (v) u.voice = v;
    else if (lang.startsWith("he")) hadVoice = false;
    u.rate = opts.rate ?? 1;
    opts.onSentence?.(s);
    await new Promise<void>((resolve) => {
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    });
  }
  speaking = false;
  return hadVoice;
}
