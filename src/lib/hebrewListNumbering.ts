/**
 * Hebrew list numbering (plan W13.H5): א. ב. ג. … in the preview, the PDF
 * and DOCX, while the Markdown keeps 1. 2. 3. (portable to every other tool).
 *
 * A note asks for it in its frontmatter:
 *
 *     ---
 *     listNumbering: hebrew
 *     ---
 *
 * The numerals are the traditional ones: 15 and 16 are ט״ו / ט״ז ("טו",
 * "טז", never יה / יו), and the combinations that spell an ill-omened word
 * are reordered as in print — 270 ער (not רע), 272 ערב, 275 ערה, 298 רחצ,
 * 304 דש, 344 שדמ — also inside larger numbers (744 תשדמ). A list marker has
 * no geresh: "טו." like Word's hebrew1 and CSS's `hebrew`.
 */

const LETTERS: ReadonlyArray<[number, string]> = [
  [400, "ת"], [300, "ש"], [200, "ר"], [100, "ק"], [90, "צ"], [80, "פ"], [70, "ע"], [60, "ס"], [50, "נ"],
  [40, "מ"], [30, "ל"], [20, "כ"], [10, "י"], [9, "ט"], [8, "ח"], [7, "ז"], [6, "ו"], [5, "ה"], [4, "ד"], [3, "ג"], [2, "ב"], [1, "א"],
];

/** Endings printed in another order (the letters of the number stay the same). */
const REORDER: ReadonlyArray<[string, string]> = [
  ["רעב", "ערב"],
  ["רעה", "ערה"],
  ["רצח", "רחצ"],
  ["שמד", "שדמ"],
  ["רע", "ער"],
  ["שד", "דש"],
];

/** 1–999 in Hebrew letters, without geresh. Out of range: the decimal number. */
export function hebrewNumeral(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 999) return String(n);
  let s = "";
  let rest = n;
  while (rest > 0) {
    if (rest === 15 || rest === 16) {
      s += rest === 15 ? "טו" : "טז";
      break;
    }
    const [v, l] = LETTERS.find(([v]) => v <= rest)!;
    s += l;
    rest -= v;
  }
  for (const [bad, good] of REORDER) {
    if (s.endsWith(bad)) {
      s = s.slice(0, s.length - bad.length) + good;
      break;
    }
  }
  return s;
}

import { listNumberingOf, type ListNumbering } from "./listNumberingOf";

export { listNumberingOf, type ListNumbering };

/** The same from the note's text, without a YAML parser (export paths): the `listNumbering:` line of its frontmatter. */
export function listNumberingOfMarkdown(markdown: string): ListNumbering {
  const fm = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/.exec(markdown);
  if (!fm) return "decimal";
  const line = /^(?:listNumbering|list-numbering)\s*:\s*["']?([^"'\r\n#]+?)["']?\s*(?:#.*)?$/m.exec(fm[1]);
  return line ? listNumberingOf({ listNumbering: line[1] }) : "decimal";
}

/** The CSS counter style name; `hebrew` (the browser's own, no reordering) is its fallback. */
export const COUNTER_STYLE = "lumen-hebrew";

/**
 * A stylesheet for ordered lists under `scope`: CSS's built-in `hebrew` first
 * (works everywhere, even before this sheet), then this exact list of 999
 * markers as a fixed counter style, with `hebrew` as its fallback past 999.
 */
export function hebrewListCss(scope: string): string {
  const symbols: string[] = [];
  for (let i = 1; i <= 999; i++) symbols.push(`"${hebrewNumeral(i)}"`);
  return (
    `@counter-style ${COUNTER_STYLE} { system: fixed 1; symbols: ${symbols.join(" ")}; suffix: ". "; fallback: hebrew; }\n` +
    `${scope} ol { list-style-type: ${COUNTER_STYLE}; }`
  );
}

/** Put the stylesheet in `doc` once (the preview). */
export function ensureHebrewListStyle(doc: Document = document): void {
  if (doc.getElementById("lumen-hebrew-lists")) return;
  const style = doc.createElement("style");
  style.id = "lumen-hebrew-lists";
  style.textContent = hebrewListCss('[data-list-numbering="hebrew"]');
  doc.head.appendChild(style);
}
