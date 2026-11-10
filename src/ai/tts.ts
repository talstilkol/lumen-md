/**
 * Read a note aloud (T32) with the system's own voices (Web Speech API) —
 * on macOS / Windows / Android that includes Hebrew. Nothing leaves the
 * device. Text is spoken sentence by sentence; each sentence's range in the
 * document is reported so the editor can highlight what is being read, and
 * (plan W2.6) the word being read, from the voice's word boundaries.
 *
 * W2.6 also keeps the reading position per note (run again → it resumes; at
 * the end it starts over), and a speed and a voice per language chosen in
 * *Read aloud: voice and speed*. A neural Hebrew voice (./tts/) is used only
 * when a licensed one is installed — none exists yet (decision 15.10).
 */
import "./ttsStrings";
import { hebrewRatio } from "../text/hebrew";
import { log } from "../lib/logger";

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
/** Scripts that settle the language even for a short sentence (no shared-script guess). */
const SCRIPT_DECIDES = new Set(["hebrew", "kana", "han", "hangul", "greek", "thai"]);
const voiceTag = (lang: string) => (lang === "he" ? "he-IL" : lang);

/**
 * BCP-47 language for a sentence: Hebrew script → he-IL; with the local
 * detector (plan 6.5) any language it is sure of, or that the script alone
 * settles; otherwise `fallback` (the document's language, else the UI's).
 */
export function langFor(text: string, fallback: string, detect?: Detect): string {
  if (hebrewRatio(text) > 0.3) return "he-IL";
  if (detect) {
    const g = detect(text);
    if (g.lang !== "und" && (g.confident || (g.script && SCRIPT_DECIDES.has(g.script)))) return voiceTag(g.lang);
    return fallback;
  }
  if (/[؀-ۿ]/.test(text)) return "ar";
  return fallback;
}

export function ttsAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

function voiceFor(lang: string, chosen?: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const base = lang.split("-")[0].toLowerCase();
  const pick = chosen ? voices.find((v) => v.voiceURI === chosen && v.lang.toLowerCase().split("-")[0].replace("iw", "he") === base) : undefined;
  return pick ?? voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ?? voices.find((v) => v.lang.toLowerCase().startsWith(base)) ?? (base === "he" ? voices.find((v) => v.lang.toLowerCase().startsWith("iw")) : undefined);
}

export interface WordRange {
  from: number;
  to: number;
  /** Where the word starts in the spoken (cleaned) sentence text. */
  at: number;
}

/**
 * The spoken sentence's words mapped back to the note: each word of the
 * cleaned text found, in order, in the sentence's source (links and marks
 * were removed, so positions differ). A word that cannot be found is skipped.
 */
export function wordRanges(source: string, sentence: Sentence): WordRange[] {
  const src = source.slice(sentence.from, sentence.to);
  const out: WordRange[] = [];
  let cursor = 0;
  for (const m of sentence.text.matchAll(/[\p{L}\p{M}\p{N}'׳״"]+/gu)) {
    const i = src.indexOf(m[0], cursor);
    if (i < 0) continue;
    out.push({ from: sentence.from + i, to: sentence.from + i + m[0].length, at: m.index! });
    cursor = i + m[0].length;
  }
  return out;
}

/** The word a boundary event at `charIndex` (in the spoken text) falls in. */
export function wordAt(words: readonly WordRange[], charIndex: number): WordRange | null {
  let hit: WordRange | null = null;
  for (const w of words) {
    if (w.at <= charIndex) hit = w;
    else break;
  }
  return hit;
}

// ── Settings and position (per device; a convenience, so browser storage) ──

export interface TtsSettings {
  /** 0.5 – 2. */
  rate: number;
  /** Base language ("he", "en") → the system voice's voiceURI. */
  voices: Record<string, string>;
}

const SETTINGS_KEY = "lumen.tts.settings";
const POSITION_KEY = "lumen.tts.position:";

type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const storage = (): KV | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export function loadTtsSettings(kv: KV | null = storage()): TtsSettings {
  try {
    const raw = JSON.parse(kv?.getItem(SETTINGS_KEY) ?? "null") as Partial<TtsSettings> | null;
    const rate = typeof raw?.rate === "number" && raw.rate >= 0.5 && raw.rate <= 2 ? raw.rate : 1;
    const voices = raw?.voices && typeof raw.voices === "object" ? Object.fromEntries(Object.entries(raw.voices).filter(([, v]) => typeof v === "string")) : {};
    return { rate, voices };
  } catch {
    return { rate: 1, voices: {} };
  }
}

export function saveTtsSettings(next: TtsSettings, kv: KV | null = storage()): void {
  try {
    kv?.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: the setting lasts this session only */
  }
}

/**
 * Where to resume in a note: the saved sentence if its text is still there
 * (searched near the saved index, since edits shift it), else the start.
 */
export function resumeIndex(sentences: readonly Sentence[], noteKey: string, kv: KV | null = storage()): number {
  try {
    const saved = JSON.parse(kv?.getItem(POSITION_KEY + noteKey) ?? "null") as { index?: number; text?: string } | null;
    if (!saved || typeof saved.index !== "number" || typeof saved.text !== "string") return 0;
    let best = -1;
    sentences.forEach((s, i) => {
      if (s.text === saved.text && (best < 0 || Math.abs(i - saved.index!) < Math.abs(best - saved.index!))) best = i;
    });
    return best > 0 ? best : 0;
  } catch {
    return 0;
  }
}

export function savePosition(noteKey: string, sentence: Sentence | null, index: number, kv: KV | null = storage()): void {
  try {
    if (!sentence) kv?.removeItem(POSITION_KEY + noteKey);
    else kv?.setItem(POSITION_KEY + noteKey, JSON.stringify({ index, text: sentence.text }));
  } catch {
    /* storage blocked */
  }
}

let speaking = false;
/** Bumped by every speak() and stopSpeaking(): a run whose token is stale stops. */
let runToken = 0;

export function isSpeaking(): boolean {
  return speaking;
}

/** The neural voice's run, when one is reading (W2.6). */
let neuralAbort: AbortController | null = null;

export function stopSpeaking(): void {
  speaking = false;
  runToken++;
  neuralAbort?.abort();
  neuralAbort = null;
  if (ttsAvailable()) window.speechSynthesis.cancel();
}

export interface SpeakOptions {
  uiLang: string;
  rate?: number;
  onSentence?: (s: Sentence, index: number) => void;
  /** The word being read (from the voice's boundary events), in note offsets. */
  onWord?: (s: Sentence, word: WordRange) => void;
  /** Start at this sentence (resume). */
  startAt?: number;
  /** Base language → system voiceURI (TtsSettings.voices). */
  voices?: Record<string, string>;
  /** The note's text, for mapping words back to it (default: the markdown itself). */
  source?: string;
}

/**
 * Speak `markdown`. `onSentence` gets each sentence as it starts; resolves
 * when done or stopped. Returns false when a needed voice is missing.
 */
export async function speak(markdown: string, opts: SpeakOptions): Promise<boolean> {
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
  const source = opts.source ?? markdown;
  const start = Math.min(Math.max(opts.startAt ?? 0, 0), sentences.length - 1);
  for (let i = start; i < sentences.length; i++) {
    const s = sentences[i];
    if (!speaking || token !== runToken) break;
    const lang = langFor(s.text, docLang, detect);
    const u = new SpeechSynthesisUtterance(s.text);
    u.lang = lang;
    const v = voiceFor(lang, opts.voices?.[lang.split("-")[0].toLowerCase()]);
    if (v) u.voice = v;
    else if (lang.startsWith("he")) hadVoice = false;
    u.rate = opts.rate ?? 1;
    if (opts.onWord) {
      const words = wordRanges(source, s);
      u.onboundary = (ev: SpeechSynthesisEvent) => {
        if (ev.name && ev.name !== "word") return;
        const w = wordAt(words, ev.charIndex);
        if (w && token === runToken) opts.onWord?.(s, w);
      };
    }
    opts.onSentence?.(s, i);
    await new Promise<void>((resolve) => {
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    });
  }
  speaking = false;
  return hadVoice;
}

/** A note's key for the saved position: its workspace path, else its name. */
const noteKeyOf = (doc: { workspaceName?: string | null; name?: string | null }): string => doc.workspaceName ?? doc.name ?? "untitled";

/**
 * The palette's *Read aloud* (run again to stop): resumes where this note
 * was left, highlights the sentence and the word, remembers the position.
 */
export async function readAloudCommand(deps: {
  content: string;
  doc: { workspaceName?: string | null; name?: string | null };
  uiLang: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
  toast: (message: string, type?: "info" | "error" | "success") => void;
}): Promise<void> {
  if (isSpeaking()) {
    stopSpeaking();
    return;
  }
  if (!ttsAvailable()) {
    deps.toast(deps.t("toast.tts.unavailable"), "error");
    return;
  }
  const key = noteKeyOf(deps.doc);
  const sentences = speakableSentences(deps.content);
  const startAt = resumeIndex(sentences, key);
  if (startAt > 0) deps.toast(deps.t("tts.resumed", { n: startAt + 1, total: sentences.length }), "info");
  const settings = loadTtsSettings();
  const range = (detail: unknown) => window.dispatchEvent(new CustomEvent("lumen-speech-range", { detail }));
  let last = -1;
  const onSentence = (s: Sentence, i: number) => {
    last = i;
    savePosition(key, s, i);
    range({ from: s.from, to: s.to });
  };
  const onWord = (s: Sentence, w: WordRange) => range({ from: s.from, to: s.to, word: { from: w.from, to: w.to } });
  // A licensed neural Hebrew voice, when one exists (none yet — decision 15.10).
  if (hebrewRatio(deps.content) > 0.5) {
    const { HEBREW_VOICES } = await import("./tts/voices");
    const neural = HEBREW_VOICES.length ? await import("./tts/neuralReader") : null;
    const voice = neural ? await neural.neuralHebrewVoice() : null;
    if (neural && voice) {
      const ctl = new AbortController();
      neuralAbort = ctl;
      speaking = true;
      try {
        const [{ pointHebrew }, { uiConfirm }] = await Promise.all([import("./nikudService"), import("../ui/PromptDialog")]);
        await neural.speakNeural(voice, sentences, {
          rate: settings.rate,
          startAt,
          source: deps.content,
          signal: ctl.signal,
          wordRanges,
          point: (text) => pointHebrew(text, { consent: { confirm: uiConfirm, t: deps.t } }),
          onSentence,
          onWord,
          onFirstAudio: (ms) => log.info(`neural read-aloud: first audio after ${Math.round(ms)} ms`),
        });
      } finally {
        speaking = false;
        neuralAbort = null;
        range(null);
      }
      if (last === sentences.length - 1 && !ctl.signal.aborted) savePosition(key, null, 0);
      return;
    }
  }
  const ok = await speak(deps.content, {
    uiLang: deps.uiLang,
    rate: settings.rate,
    voices: settings.voices,
    startAt,
    onSentence,
    onWord,
  }).finally(() => range(null));
  // Read to the end (not stopped): the next run starts over.
  if (last === sentences.length - 1 && !isSpeaking()) savePosition(key, null, 0);
  if (!ok) deps.toast(deps.t("toast.tts.noHebrewVoice"), "info");
}

const RATES = [0.75, 1, 1.25, 1.5, 2];

/** *Read aloud: voice and speed* — the speed, and the system voice for the note's language. */
export async function readAloudSettings(deps: {
  content: string;
  uiLang: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
  toast: (message: string, type?: "info" | "error" | "success") => void;
  select: (o: { title?: string; message: string; defaultValue?: string; choices: { value: string; label: string }[] }) => Promise<string | null>;
}): Promise<void> {
  if (!ttsAvailable()) {
    deps.toast(deps.t("toast.tts.unavailable"), "error");
    return;
  }
  const settings = loadTtsSettings();
  const rate = await deps.select({
    title: deps.t("tts.settings.title"),
    message: deps.t("tts.settings.rate"),
    defaultValue: String(settings.rate),
    choices: RATES.map((r) => ({ value: String(r), label: `${r}×` })),
  });
  if (rate === null) return;
  const lang = hebrewRatio(deps.content) > 0.3 || deps.uiLang === "he" ? "he" : deps.uiLang.split("-")[0];
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().replace(/^iw/, "he").startsWith(lang));
  let voice: string | null = settings.voices[lang] ?? "";
  if (voices.length > 1) {
    voice = await deps.select({
      title: deps.t("tts.settings.title"),
      message: deps.t("tts.settings.voice", { lang }),
      defaultValue: settings.voices[lang] ?? voices[0].voiceURI,
      choices: voices.map((v) => ({ value: v.voiceURI, label: `${v.name} (${v.lang})${v.localService ? "" : " ☁"}` })),
    });
    if (voice === null) return;
  }
  saveTtsSettings({ rate: Number(rate), voices: { ...settings.voices, ...(voice ? { [lang]: voice } : {}) } });
  deps.toast(deps.t("tts.settings.saved", { rate: `${rate}×` }), "success");
  // Decision 15.10: no licensed neural Hebrew voice yet — say what is used.
  if (lang === "he") {
    const { HEBREW_VOICES } = await import("./tts/voices");
    if (!HEBREW_VOICES.length) deps.toast(deps.t("tts.neural.none"), "info");
  }
}
