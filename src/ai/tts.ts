/**
 * Read a note aloud (T32) with the system's own voices (Web Speech API) —
 * on macOS / Windows / Android that includes Hebrew. Nothing leaves the
 * device. Text is spoken sentence by sentence; each sentence's range in the
 * document is reported so the editor can highlight what is being read.
 */
import { hebrewRatio } from "../text/hebrew";
import { getAiPolicy } from "./policy";
import { recordSpeechVoice } from "./privacyLedger";

/** Opt-in for voices that synthesize on a server (Chrome's "Google …" voices send the text out). */
export const NETWORK_VOICES_KEY = "lumen.tts.networkVoices";

/** May a voice that is not `localService` be used? Never under local-only; otherwise only after opt-in. */
export function networkVoicesAllowed(): boolean {
  if (getAiPolicy() === "local-only") return false;
  try {
    return localStorage.getItem(NETWORK_VOICES_KEY) === "1";
  } catch {
    // why: storage blocked (private mode) — treat as not opted in
    return false;
  }
}

export interface Sentence {
  text: string;
  from: number;
  to: number;
}

/** Source ranges of fenced code blocks — ``` and ~~~ fences; an unclosed one runs to the end. */
function fencedRanges(markdown: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let open: { start: number; char: string; len: number } | null = null;
  let pos = 0;
  for (const line of markdown.split("\n")) {
    const end = pos + line.length + 1;
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.replace(/\r$/, ""));
    if (open) {
      if (m && m[1][0] === open.char && m[1].length >= open.len && !m[2].trim()) {
        out.push([open.start, Math.min(end, markdown.length)]);
        open = null;
      }
    } else if (m && !(m[1][0] === "`" && m[2].includes("`"))) {
      open = { start: pos, char: m[1][0], len: m[1].length };
    }
    pos = end;
  }
  if (open) out.push([open.start, markdown.length]);
  return out;
}

/** Markdown → speakable sentences with their source ranges. */
export function speakableSentences(markdown: string): Sentence[] {
  const out: Sentence[] = [];
  // Skip frontmatter and fenced code: nobody wants code read aloud.
  const skip: Array<[number, number]> = [];
  const fm = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (fm) skip.push([0, fm[0].length]);
  skip.push(...fencedRanges(markdown));
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

export function allowNetworkVoices(): void {
  try {
    localStorage.setItem(NETWORK_VOICES_KEY, "1");
  } catch {
    // why: storage blocked — the opt-in then lasts only until reload, which is acceptable
  }
}

/** Does the browser list any voice that synthesizes on a server? */
export function offersNetworkVoices(): boolean {
  return ttsAvailable() && window.speechSynthesis.getVoices().some((v) => !v.localService);
}

/** Is there an on-device voice for every language the note's sentences need? */
export function hasLocalVoiceFor(markdown: string, uiLang: string): boolean {
  if (!ttsAvailable()) return false;
  const langs = new Set(speakableSentences(markdown).map((s) => langFor(s.text, uiLang === "he" ? "he-IL" : uiLang)));
  return [...langs].every((l) => voiceFor(l, false));
}

/** Best voice for `lang`; network voices only when `allowNetwork`. Exported for tests. */
export function voiceFor(lang: string, allowNetwork = networkVoicesAllowed()): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices().filter((v) => allowNetwork || v.localService);
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
 * when done or stopped. Returns false when a needed voice is missing — under
 * local-only (or without the opt-in) only voices that run on this device count.
 * A network voice, when allowed, is recorded in the privacy ledger.
 */
export async function speak(markdown: string, opts: { uiLang: string; rate?: number; onSentence?: (s: Sentence) => void }): Promise<boolean> {
  if (!ttsAvailable()) return false;
  stopSpeaking();
  const sentences = speakableSentences(markdown);
  if (!sentences.length) return true;
  speaking = true;
  let hadVoice = true;
  const allowNetwork = networkVoicesAllowed();
  const logged = new Set<string>();
  for (const s of sentences) {
    if (!speaking) break;
    const lang = langFor(s.text, opts.uiLang === "he" ? "he-IL" : opts.uiLang);
    const u = new SpeechSynthesisUtterance(s.text);
    u.lang = lang;
    const v = voiceFor(lang, allowNetwork);
    if (!v) {
      // A missing local voice: say so instead of letting the browser pick a network one.
      hadVoice = false;
      continue;
    }
    u.voice = v;
    if (!v.localService && !logged.has(v.name)) {
      logged.add(v.name);
      recordSpeechVoice(v.name, lang, s.text.length);
    }
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
