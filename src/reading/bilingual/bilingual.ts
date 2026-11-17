/**
 * Bilingual and interlinear reading (W13.R12): a text and its translation,
 * aligned verse by verse, shown in two columns, line under line
 * (interlinear), or the source alone.
 *
 *  - A Sefaria source note (W5.1) with a Hebrew version and a translation
 *    version: the two official versions, paired by verse (Sefaria gives one
 *    string per verse in both), never a machine translation. A version
 *    whose licence keeps it link-only has no text here and is not offered.
 *  - Any other note with a translation sidecar (W12.H6, `<note>.<lang>.md`):
 *    paired by paragraph as the side-by-side view pairs them, and inside a
 *    paragraph by sentence when both have as many sentences (Intl.Segmenter);
 *    otherwise the paragraph stays one pair. It is marked as a machine
 *    translation made on this device.
 *
 * Reading only: the note and the sidecar are never written here.
 */
import { parseSourceNote } from "../../sources/sefaria/store";
import { hebrewNumeral } from "../../sources/sefaria/refs";
import { align, parseSidecar } from "../../ai/mt/sideBySide";

export type BilingualMode = "columns" | "interlinear" | "source";
export const BILINGUAL_MODES: readonly BilingualMode[] = ["columns", "interlinear", "source"];

export interface Side {
  lang: string;
  dir: "rtl" | "ltr";
  /** The version's title (official) or the translating layer (sidecar). */
  title: string;
  license: string | null;
}

export interface BiRow {
  /** 1-based verse or paragraph number. */
  n: number;
  /** How the number is shown on the source side (Hebrew numerals for Hebrew). */
  label: string;
  source: string;
  target: string | null;
  /** Sentence by sentence, when the paragraph's sentences pair up one to one. */
  sentences: Array<[string, string]> | null;
  /** The source changed since it was translated (sidecar only). */
  stale: boolean;
}

export interface Bilingual {
  kind: "official" | "machine";
  title: string;
  source: Side;
  target: Side;
  rows: BiRow[];
  /** Verses one side has and the other lacks (0 when the versions match). */
  unmatched: number;
}

const RTL_LANGS = new Set(["he", "ar", "yi", "fa", "arc", "jrb", "lad"]);
export const dirOfLang = (lang: string): "rtl" | "ltr" => (RTL_LANGS.has(lang.split("-")[0]) ? "rtl" : "ltr");

const label = (n: number, lang: string) => (lang === "he" ? hebrewNumeral(n) : String(n));

/** A paragraph's sentences (Intl.Segmenter; a punctuation split where it is missing). */
export function sentencesOf(text: string, lang: string): string[] {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return [];
  const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  const parts = Seg ? Array.from(new Seg(lang, { granularity: "sentence" }).segment(t), (s) => s.segment.trim()) : t.split(/(?<=[.!?׃:])\s+/);
  return parts.filter(Boolean);
}

/** Pair a paragraph's sentences one to one, or null when the counts differ. */
export function pairSentences(source: string, target: string, sourceLang: string, targetLang: string): Array<[string, string]> | null {
  const a = sentencesOf(source, sourceLang);
  const b = sentencesOf(target, targetLang);
  if (a.length < 2 || a.length !== b.length) return null;
  return a.map((s, i) => [s, b[i]]);
}

/** A Sefaria source note's Hebrew and translation versions, verse by verse. Null when it has no two texts to pair. */
export function fromSourceNote(md: string, prefer?: string): Bilingual | null {
  const p = parseSourceNote(md.replace(/\r\n/g, "\n"));
  if (!p) return null;
  const withText = p.versions.filter((v) => v.free && v.text?.length);
  const src = withText.find((v) => v.language === "he") ?? withText[0];
  const tgt = withText.find((v) => v !== src && (!prefer || v.language === prefer)) ?? withText.find((v) => v !== src);
  if (!src || !tgt) return null;
  const a = src.text!;
  const b = tgt.text!;
  const n = Math.max(a.length, b.length);
  const rows: BiRow[] = [];
  for (let i = 0; i < n; i++) rows.push({ n: i + 1, label: label(i + 1, src.language), source: a[i] ?? "", target: b[i] ?? null, sentences: null, stale: false });
  return {
    kind: "official",
    title: p.heRef ?? p.ref.he,
    source: { lang: src.language, dir: dirOfLang(src.language), title: src.title, license: src.license },
    target: { lang: tgt.language, dir: dirOfLang(tgt.language), title: tgt.title, license: tgt.license },
    rows,
    unmatched: Math.abs(a.length - b.length),
  };
}

/** A note and its translation sidecar, paragraph by paragraph (and sentence by sentence where they pair). */
export function fromSidecar(sourceMd: string, sidecarMd: string, sourceLang: string, title: string): Bilingual {
  const sidecar = parseSidecar(sidecarMd);
  const rows = align(sourceMd, sidecar).map((r, i): BiRow => {
    const target = r.translation;
    return {
      n: i + 1,
      label: String(i + 1),
      source: r.source.text,
      target,
      sentences: target && r.state === "ok" ? pairSentences(r.source.text, target, sourceLang, sidecar.lang) : null,
      stale: r.state === "stale",
    };
  });
  return {
    kind: "machine",
    title,
    source: { lang: sourceLang, dir: dirOfLang(sourceLang), title: "", license: null },
    target: { lang: sidecar.lang, dir: dirOfLang(sidecar.lang), title: sidecar.layer ?? "", license: null },
    rows,
    unmatched: rows.filter((r) => r.target === null).length,
  };
}

const KEY = "lumen-bilingual-mode";

export function readMode(): BilingualMode {
  try {
    const v = localStorage.getItem(KEY);
    return (BILINGUAL_MODES as readonly string[]).includes(v ?? "") ? (v as BilingualMode) : "columns";
  } catch {
    // why: storage blocked: the default view
    return "columns";
  }
}

export function saveMode(m: BilingualMode): void {
  try {
    localStorage.setItem(KEY, m);
  } catch {
    // why: storage blocked: the choice lasts for this view
  }
}
