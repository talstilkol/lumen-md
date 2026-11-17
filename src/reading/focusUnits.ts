/**
 * Focus mode's units (plan W13.R2): the line, the sentence or the paragraph
 * around the cursor — what stays bright while the rest of the note dims,
 * as in iA Writer.
 *
 * Sentences come from Intl.Segmenter (Hebrew and English rules from ICU),
 * run on the paragraph only, so a long note costs nothing. Markdown is
 * respected: a heading, a list item, a table row and a fenced code block are
 * their own paragraphs, and a sentence never runs past a paragraph. ICU
 * keeps geresh / gershayim (צה״ל) inside words but does not end a sentence
 * at the Hebrew sof pasuq (׃), so that split is added here; a piece a
 * segmenter split after an abbreviation ("Dr.", "e.g.") is joined back.
 */
export type FocusUnit = "line" | "sentence" | "paragraph";

export interface Span {
  from: number;
  to: number;
}

const BLOCK_START = /^(\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s?|\||```|~~~)|\s*$)/;

/** The line [from, to) holding `pos`. */
export function lineAt(text: string, pos: number): Span {
  const p = Math.max(0, Math.min(pos, text.length));
  const from = text.lastIndexOf("\n", p - 1) + 1;
  const nl = text.indexOf("\n", p);
  return { from, to: nl < 0 ? text.length : nl };
}

/**
 * The paragraph holding `pos`: lines up to a blank line, or a Markdown
 * block that stands alone (heading, list item, quote line, table row, a
 * whole fenced code block).
 */
export function paragraphAt(text: string, pos: number): Span {
  const line = lineAt(text, pos);
  const lineText = text.slice(line.from, line.to);
  if (!lineText.trim()) return line;
  // Inside a fenced code block: the whole block.
  const fence = fenceAround(text, line.from);
  if (fence) return fence;
  if (/^\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\|)/.test(lineText)) return line;
  let from = line.from;
  while (from > 0) {
    const prev = lineAt(text, from - 1);
    if (BLOCK_START.test(text.slice(prev.from, prev.to))) break;
    from = prev.from;
  }
  let to = line.to;
  while (to < text.length) {
    const next = lineAt(text, to + 1);
    if (BLOCK_START.test(text.slice(next.from, next.to))) break;
    to = next.to;
  }
  return { from, to };
}

function fenceAround(text: string, lineStart: number): Span | null {
  let open: number | null = null;
  const re = /^(```|~~~)/gm;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const end = text.indexOf("\n", m.index);
    const lineEnd = end < 0 ? text.length : end;
    if (open === null) {
      if (m.index > lineStart) return null;
      open = m.index;
    } else {
      if (lineStart >= open && lineStart <= m.index) return { from: open, to: lineEnd };
      open = null;
    }
  }
  return open !== null && lineStart >= open ? { from: open, to: text.length } : null;
}

const segmenters = new Map<string, Intl.Segmenter | null>();
function segmenter(lang: string): Intl.Segmenter | null {
  if (!segmenters.has(lang)) {
    try {
      segmenters.set(lang, typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(lang, { granularity: "sentence" }) : null);
    } catch {
      segmenters.set(lang, null);
    }
  }
  return segmenters.get(lang) ?? null;
}

/** The language for segmenting: Hebrew when the text is mostly Hebrew letters. */
export function langOf(text: string): "he" | "en" {
  const he = text.match(/[א-ת]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  return he > latin ? "he" : "en";
}

/** Sentences of one paragraph, as spans of `text` (trailing spaces trimmed). */
export function sentencesIn(text: string, para: Span, lang = langOf(text.slice(para.from, para.to))): Span[] {
  const chunk = text.slice(para.from, para.to);
  const seg = segmenter(lang);
  const raw: Span[] = [];
  if (seg) {
    for (const s of seg.segment(chunk)) raw.push({ from: s.index, to: s.index + s.segment.length });
  } else {
    // No Intl.Segmenter (old engines): split after . ! ? ׃ followed by space.
    const re = /[^.!?׃]*(?:[.!?׃]+["'”״)\]]*\s*|$)/g;
    for (let m = re.exec(chunk); m && m[0]; m = re.exec(chunk)) raw.push({ from: m.index, to: m.index + m[0].length });
  }
  // ICU does not end a sentence at the sof pasuq (׃): split there.
  const pieces: Span[] = [];
  for (const s of raw) {
    let start = s.from;
    for (const m of chunk.slice(s.from, s.to).matchAll(/׃\s+/g)) {
      const end = s.from + (m.index ?? 0) + m[0].length;
      if (end < s.to) {
        pieces.push({ from: start, to: end });
        start = end;
      }
    }
    pieces.push({ from: start, to: s.to });
  }
  // Join a piece a segmenter split after an abbreviation ("e.g. this", "Dr. Smith").
  const merged: Span[] = [];
  for (const s of pieces) {
    const prev = merged[merged.length - 1];
    const body = chunk.slice(s.from, s.to);
    const prevText = prev ? chunk.slice(prev.from, prev.to).trimEnd() : "";
    const abbrev = /\b(e\.g|i\.e|etc|vs|Mr|Mrs|Dr|St|cf)\.$/i.test(prevText) || /^[a-z]/.test(body.trimStart());
    if (prev && abbrev) prev.to = s.to;
    else merged.push({ ...s });
  }
  return merged
    .map((s) => {
      const t = chunk.slice(s.from, s.to);
      const lead = t.length - t.trimStart().length;
      return { from: para.from + s.from + lead, to: para.from + s.from + t.trimEnd().length };
    })
    .filter((s) => s.to > s.from);
}

/** The span that stays bright for `unit` with the cursor at `pos`. */
export function focusSpan(text: string, pos: number, unit: FocusUnit): Span {
  if (unit === "line") return lineAt(text, pos);
  const para = paragraphAt(text, pos);
  if (unit === "paragraph") return para;
  const sentences = sentencesIn(text, para);
  // The cursor right after a sentence's last character still belongs to it.
  const at = sentences.find((s) => pos >= s.from && pos <= s.to) ?? sentences.find((s) => s.from >= pos) ?? sentences[sentences.length - 1];
  return at ?? para;
}
