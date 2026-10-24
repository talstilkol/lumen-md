/**
 * Mixed-direction lines in Hebrew OCR (plan 7.5): Latin words, e-mail
 * addresses, URLs and numbers inside a right-to-left line.
 *
 * tesseract (heb+eng) reads a Hebrew prefix glued to a Latin word as a Latin
 * symbol — "ו-Bluetooth" as "Bluetooth-1", "ה-PDF" as "PDF-A" — and a short
 * Hebrew word between Latin runs as Latin ("או" as "IN"). The Hebrew letter
 * then no longer breaks the left-to-right run, so the whole run comes out in
 * visual order. Only for lines that contain Latin letters, this module
 *  1. re-reads, with a Hebrew-only single-word pass, a lone symbol glued to a
 *     Latin word by a hyphen and short Latin words tesseract was unsure of,
 *     keeping the Hebrew reading only when it is a Hebrew word read with
 *     more confidence;
 *  2. rebuilds the line in logical order from the word boxes: right to left,
 *     each run of left-to-right words read left to right.
 * Lines without Latin letters keep tesseract's own text.
 */

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrSymbol {
  text: string;
  bbox: Box;
  confidence: number;
}

export interface OcrWord {
  text: string;
  bbox: Box;
  confidence: number;
  symbols: OcrSymbol[];
}

export interface OcrLine {
  text: string;
  words: OcrWord[];
}

/** A Hebrew-only reading of one rectangle of the image. */
export type ReadHebrew = (box: Box) => Promise<{ text: string; confidence: number }>;

const MARKS = /[‎‏‪-‮⁦-⁩]/g;
const HEB = /[א-ת]/;
const LATIN = /[A-Za-z]/;
/** The letters that attach to the next word with a hyphen before a foreign word: ו-, ה-, ב-, ל-, מ-, ש-, כ-. */
const PREFIX = "והבלמשכ";

const strip = (s: string) => s.replace(MARKS, "");

function union(boxes: Box[]): Box {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

/** Pad a box a little: a single glyph read alone needs some margin. */
function pad(b: Box, by = 3): Box {
  return { x0: Math.max(0, b.x0 - by), y0: Math.max(0, b.y0 - by), x1: b.x1 + by, y1: b.y1 + by };
}

/** A word whose logical form is left-to-right: its first strong letter is Latin, or it has no letters but digits. */
export function isLtrWord(text: string): boolean {
  const t = strip(text);
  const first = /[א-תA-Za-z]/.exec(t)?.[0];
  if (first) return LATIN.test(first);
  return /\d/.test(t);
}

interface Piece {
  /** Logical text of the word. */
  text: string;
  bbox: Box;
}

/**
 * One word, fixed: "Bluetooth-1" with its last symbol re-read as Hebrew "ו"
 * becomes "ו-Bluetooth" (the prefix sits at the visual right, logically
 * first); a trailing sentence mark at the visual left moves to the end.
 */
async function fixWord(word: OcrWord, read: ReadHebrew): Promise<Piece> {
  const text = strip(word.text);
  if (!LATIN.test(text) || HEB.test(text)) return { text, bbox: word.bbox };
  const syms = word.symbols.map((s) => ({ ...s, text: strip(s.text) })).filter((s) => s.text);
  // Visual order, left to right (tesseract lists an LTR word's symbols that way; sort to be sure).
  syms.sort((a, b) => a.bbox.x0 - b.bbox.x0);
  // Sentence marks at the visual left of a word in an RTL line end it logically.
  let trail = "";
  while (syms.length > 1 && /^[.,;:!?]$/.test(syms[0].text)) trail += syms.shift()!.text;
  const n = syms.length;
  // "<Latin>-X": X, at the visual right, is a Hebrew prefix letter read as Latin.
  if (n >= 3 && syms[n - 2].text === "-" && !/^[A-Za-z]{2,}$/.test(syms[n - 1].text) && LATIN.test(syms[n - 3].text)) {
    // The glyph's own columns, the word's full height: a tight box loses the letter's shape.
    const glyph = syms[n - 1].bbox;
    const heb = await read(pad({ x0: glyph.x0, x1: glyph.x1, y0: word.bbox.y0, y1: word.bbox.y1 }, 3)).catch(() => null);
    const letter = heb ? strip(heb.text).replace(/[^א-ת]/g, "") : "";
    if (letter.length === 1 && PREFIX.includes(letter)) {
      const latin = syms.slice(0, n - 2).map((s) => s.text).join("");
      return { text: `${letter}-${latin}${trail}`, bbox: word.bbox };
    }
  }
  const latin = syms.map((s) => s.text).join("") + trail;
  // A short word tesseract was unsure of: maybe Hebrew ("או" read as "IN").
  if (/^[A-Za-z]{1,3}$/.test(latin) && word.confidence < 80) {
    const heb = await read(pad(word.bbox)).catch(() => null);
    const t = heb ? strip(heb.text).trim() : "";
    if (heb && /^[א-ת]{1,4}$/.test(t) && heb.confidence > word.confidence) return { text: t, bbox: word.bbox };
  }
  return { text: latin, bbox: word.bbox };
}

/**
 * The line's text in logical order. Unchanged (tesseract's own) when the
 * line has no Latin letter or no Hebrew one.
 */
export async function fixMixedLine(line: OcrLine, read: ReadHebrew): Promise<string> {
  const own = line.text.replace(/\n$/, "");
  if (!LATIN.test(own) || !HEB.test(own) || !line.words.length) return own;
  const pieces = await Promise.all(line.words.map((w) => fixWord(w, read)));
  // Right to left; a run of LTR pieces is read left to right.
  const visual = [...pieces].sort((a, b) => b.bbox.x1 - a.bbox.x1);
  const out: string[] = [];
  for (let i = 0; i < visual.length; ) {
    if (!isLtrWord(visual[i].text)) {
      out.push(visual[i++].text);
      continue;
    }
    const run: Piece[] = [];
    while (i < visual.length && isLtrWord(visual[i].text)) run.push(visual[i++]);
    out.push(...run.reverse().map((p) => p.text));
  }
  return out.join(" ");
}

/** Every line of a page, fixed, joined with newlines. */
export async function fixMixedText(lines: OcrLine[], read: ReadHebrew): Promise<string> {
  const out: string[] = [];
  for (const l of lines) out.push(await fixMixedLine(l, read));
  return out.join("\n");
}

/** The words' union box (tests). */
export const boxOf = (words: OcrWord[]): Box => union(words.map((w) => w.bbox));
