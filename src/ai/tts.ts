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

type Detect = (text: string) => { lang: string; confident: boolean; script: string | null };
const voiceTag = (lang: string) => (lang === "he" ? "he-IL" : lang);

/** The script a language is written in (for the languages the detector reports); Latin otherwise. */
const SCRIPT_OF_LANG: Record<string, string> = { he: "hebrew", yi: "hebrew", ar: "arabic", fa: "arabic", ur: "arabic", ps: "arabic", ru: "cyrillic", uk: "cyrillic", be: "cyrillic", bg: "cyrillic", sr: "cyrillic", kk: "cyrillic", ja: "kana", zh: "han", ko: "hangul", el: "greek", th: "thai", hi: "devanagari", mr: "devanagari", ne: "devanagari" };
const scriptOfLang = (tag: string) => SCRIPT_OF_LANG[tag.split(/[-_]/)[0].toLowerCase()] ?? "latin";

/**
 * BCP-47 language for a sentence: Hebrew script → he-IL. With the local
 * detector (plan 6.5): a language it is sure of; for a short or unclear
 * sentence, the document's language (`fallback`) when that is written in
 * the sentence's script — a short Latin or Cyrillic sentence takes the
 * document's voice, kanji inside a Japanese document stay Japanese —
 * and otherwise the detector's best guess for the script, so a short
 * Arabic, Hebrew, kana, Han, Hangul, Greek or Thai sentence under an
 * English document is never read with the English voice.
 */
export function langFor(text: string, fallback: string, detect?: Detect): string {
  if (hebrewRatio(text) > 0.3) return "he-IL";
  if (detect) {
    const g = detect(text);
    if (g.lang === "und" || !g.script) return fallback;
    const docScript = scriptOfLang(fallback);
    const docCovers = docScript === g.script || (docScript === "kana" && g.script === "han");
    if (docCovers && (!g.confident || g.script === "han")) return fallback;
    return g.confident || !docCovers ? voiceTag(g.lang) : fallback;
  }
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
/** Bumped by every speak() and stopSpeaking(): a run whose token is stale stops. */
let runToken = 0;

export function isSpeaking(): boolean {
  return speaking;
}

export function stopSpeaking(): void {
  speaking = false;
  runToken++;
  if (ttsAvailable()) window.speechSynthesis.cancel();
}

/**
 * Speak `markdown`. `onSentence` gets each sentence as it starts; resolves
 * when done or stopped. Returns false when a needed voice is missing.
 */
export async function speak(markdown: string, opts: { uiLang: string; rate?: number; onSentence?: (s: Sentence) => void }): Promise<boolean> {
  if (!ttsAvailable()) return false;
  stopSpeaking();
  const token = runToken;
  const sentences = speakableSentences(markdown);
  if (!sentences.length) return true;
  // Local language detection (plan 6.5): each sentence gets the voice of
  // its own language; short or unclear ones the document's language.
  let detect: Detect | undefined;
  try {
    detect = (await import("../text/langId")).detectLanguage;
  } catch {
    detect = undefined;
  }
  // A newer speak() or a stop while the detector loaded: this run is over.
  if (token !== runToken) return true;
  speaking = true;
  let hadVoice = true;
  const ui = opts.uiLang === "he" ? "he-IL" : opts.uiLang;
  const whole = detect?.(sentences.map((x) => x.text).join(" "));
  const docLang = whole && whole.confident && whole.lang !== "und" ? voiceTag(whole.lang) : ui;
  for (const s of sentences) {
    if (!speaking || token !== runToken) break;
    const lang = langFor(s.text, docLang, detect);
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
