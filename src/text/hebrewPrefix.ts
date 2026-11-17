/**
 * Hebrew prefix letters and marks for word lookups (plan W5.3), apart from
 * the spell checker (ai/hebrewSpell.ts) so that pure readers — the
 * frequency list of ai/hebrewFreqKnown.ts and through it the readability
 * index of W13.W9 — load no module that knows a download URL.
 */
import { HEBREW_MARK_CHARS as M } from "./hebrew";

export const PREFIX = new Set(["ו", "ה", "ב", "כ", "ל", "מ", "ש"]);

const MARKS = new RegExp(`[${M}]`, "g");

export function stripMarks(word: string): string {
  return word.normalize("NFD").replace(MARKS, "").normalize("NFC").replace(/״/g, '"').replace(/׳/g, "'");
}

/**
 * Which prefix letter may follow which: ו only first; ה, ב and ל end the
 * prefix (ב/ל/כ absorb the article); כ only before ש (כש); מ before ה or ש;
 * ש before the rest. So "ההבית" or "בבית" peeled twice are not words.
 */
export const PREFIX_NEXT: Record<string, string> = { "ו": "שהבכלמ", "ש": "הבכלמ", "כ": "ש", "מ": "הש", "ה": "", "ב": "", "ל": "" };
