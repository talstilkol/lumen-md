/**
 * Syllables of an English word (Flesch–Kincaid's count), by rule: vowel
 * groups, the silent endings (cake, makes, jumped — not table, boxes,
 * wanted), and the vowel pairs that are two syllables (me-di-a, ra-di-o,
 * mu-se-um, ac-tu-al, eas-i-er). Audit r4 A2.9: the old count split every
 * pair of vowels ("beautiful" = 4) and joined every hiatus ("museum" = 2).
 * Shared by the readability index and the goals' fallback.
 */
const SILENT = /(?:[^laeiouysxzh]es|[^laeiouydt]ed|[^laeiouy]e|[aeiouy]le)$/;
/** Two vowels heard apart inside one group. */
const HIATUS = [/[^cts]ia/, /[^tscgx]io/, /iu/, /eum$/, /[^gq]ua[^auieo]/, /[^gq]ua$/, /ie(?:r|st)$/, /ii/, /uity$/, /eo(?!p)/, /ya/, /ao/, /[^aeiou]ea$/, /[^aeiourt]ien|rien[ct]/, /uie/, /oe(?!s$)/, /[aou]ing$/, /eing$/, /[^u]iet/, /[aeiou]y[aeiou]/];

export function syllables(word: string): number {
  let w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(SILENT, (m) => m[0]).replace(/^y/, "");
  const groups = w.match(/[aeiouy]+/g)?.length ?? 0;
  const extra = HIATUS.reduce((n, re) => n + (re.test(w) ? 1 : 0), 0);
  return Math.max(1, groups + extra);
}
