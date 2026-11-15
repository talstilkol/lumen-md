/**
 * Phonetic transliteration keys (plan R12.16): what lets "Kohen" find "כהן",
 * "Lapid" find "לפיד" and "ירושלים" find "Jerusalem".
 *
 * A key is a string of sound classes, the same alphabet for both scripts:
 * vowels are dropped, sibilants and gutturals keep their own classes, and a
 * doubled Latin consonant is one sound. A letter that reads two ways gets
 * both readings, so a word has a few keys (at most MAX_KEYS):
 *
 *   Hebrew  ב b/v · כ k/kh · פ p/f · ש sh/s · ו v/vowel · י y/vowel ·
 *           ה h/silent (silent at the end) · א ע silent
 *   Latin   c k/s (s before e, i, y) · ch kh/k/tsh · j y/dzh · z z/ts ·
 *           h h/kh, silent at the end · y y before a vowel, else a vowel ·
 *           w v · x ks · q k
 *
 * Two words in different scripts are a transliteration of each other when
 * they share a key. Only Hebrew words of three letters or more and Latin
 * words of four or more take part, and a short word (Hebrew under four
 * letters, Latin under five) needs a key of three classes: shorter ones join
 * too many unrelated words ("בית" would meet "but", "mail" would meet "מלא").
 *
 * Written for lumen-md; israelconnect's he_norm.js and translit.py were read
 * as a description of the problem only, no code was copied.
 */

/** Sound classes (one character each). */
const C = {
  b: "b", v: "v", g: "g", j: "j", d: "d", h: "h", x: "x", z: "z", t: "t", y: "y", k: "k",
  l: "l", m: "m", n: "n", s: "s", sh: "S", p: "p", f: "f", ts: "c", r: "r",
} as const;

const MAX_KEYS = 16;

/** Each Hebrew letter's readings ("" = silent). Final forms read as the plain letter. */
function hebrewReadings(ch: string, i: number, last: boolean, next: string): string[] {
  switch (ch) {
    case "א":
    case "ע":
      return [""];
    case "ב":
      return [C.b, C.v];
    case "ג":
      // ג׳ (geresh) is j as in ג׳ורג׳.
      return next === "'" || next === "׳" ? [C.j] : [C.g];
    case "ד":
      return [C.d];
    case "ה":
      return last ? [""] : [C.h, ""];
    case "ו":
      return i === 0 ? [C.v] : ["", C.v];
    case "ז":
      return next === "'" || next === "׳" ? [C.j] : [C.z];
    case "ח":
      return [C.x, C.h];
    case "ט":
    case "ת":
      return [C.t];
    case "י":
      return i === 0 ? [C.y] : ["", C.y];
    case "כ":
    case "ך":
      return [C.k, C.x];
    case "ק":
      return [C.k];
    case "ל":
      return [C.l];
    case "מ":
    case "ם":
      return [C.m];
    case "נ":
    case "ן":
      return [C.n];
    case "ס":
      return [C.s];
    case "פ":
    case "ף":
      return [C.p, C.f];
    case "צ":
    case "ץ":
      return next === "'" || next === "׳" ? [C.sh + "t"] : [C.ts];
    case "ר":
      return [C.r];
    case "ש":
      return [C.sh, C.s];
    default:
      return [""];
  }
}

const VOWEL = /[aeiou]/;

/** Latin units (digraphs first) and their readings. */
function latinUnits(w: string): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < w.length; ) {
    const two = w.slice(i, i + 2);
    const three = w.slice(i, i + 3);
    const next = w[i + 1] ?? "";
    if (three === "sch" || three === "tsh") { out.push([C.sh]); i += 3; continue; }
    if (two === "sh") { out.push([C.sh]); i += 2; continue; }
    if (two === "ch") { out.push([C.x, C.k, C.sh]); i += 2; continue; }
    if (two === "kh") { out.push([C.x]); i += 2; continue; }
    if (two === "ph") { out.push([C.f]); i += 2; continue; }
    if (two === "th") { out.push([C.t]); i += 2; continue; }
    if (two === "tz" || two === "ts") { out.push([C.ts]); i += 2; continue; }
    if (two === "ck") { out.push([C.k]); i += 2; continue; }
    if (two === "zh") { out.push([C.j]); i += 2; continue; }
    if (two === "dj" || two === "dg") { out.push([C.j]); i += 2; continue; }
    const ch = w[i];
    i++;
    // A doubled consonant is one sound ("Yossi", "Hillel").
    if (!VOWEL.test(ch) && ch === w[i - 2]) continue;
    if (VOWEL.test(ch)) { out.push([""]); continue; }
    switch (ch) {
      case "b": out.push([C.b]); break;
      case "v": case "w": out.push([C.v]); break;
      case "g": out.push([C.g]); break;
      case "j": out.push([C.y, C.j]); break;
      case "d": out.push([C.d]); break;
      // A final h is silent ("Sarah"); inside a word it is h or kh, never nothing.
      case "h": out.push(i === w.length ? [""] : [C.h, C.x]); break;
      case "z": out.push([C.z, C.ts]); break;
      case "t": out.push([C.t]); break;
      case "y": out.push(VOWEL.test(next) ? [C.y] : [""]); break;
      case "c": out.push(/[eiy]/.test(next) ? [C.s, C.ts] : [C.k]); break;
      case "k": case "q": out.push([C.k]); break;
      case "x": out.push([C.k + C.s]); break;
      case "l": out.push([C.l]); break;
      case "m": out.push([C.m]); break;
      case "n": out.push([C.n]); break;
      case "s": out.push([C.s]); break;
      case "p": out.push([C.p]); break;
      case "f": out.push([C.f]); break;
      case "r": out.push([C.r]); break;
      default: out.push([""]);
    }
  }
  return out;
}

/** Every combination of the readings, capped; keys shorter than `minKey` classes dropped. */
function expand(units: string[][], minKey: number): string[] {
  let keys = [""];
  for (const options of units) {
    const next = new Set<string>();
    for (const k of keys) for (const o of options) {
      next.add(k + o);
      if (next.size >= MAX_KEYS * 4) break;
    }
    keys = [...next];
  }
  const out = new Set<string>();
  for (const k of keys) {
    if (k.length >= minKey) out.add(k);
    if (out.size >= MAX_KEYS) break;
  }
  return [...out];
}

const HEB = /^[א-ת'׳"״]+$/;
const LAT = /^[a-z']+$/;

/** The script a word's keys are for: "he", "la" or null (mixed, digits, other scripts). */
export function translitScript(word: string): "he" | "la" | null {
  if (HEB.test(word)) return "he";
  if (LAT.test(word)) return "la";
  return null;
}

/**
 * The phonetic keys of one word (its comparison form: lower-case, niqqud off,
 * final letters folded or not). Empty for short words (Hebrew under three
 * letters, Latin under four), for words with digits or mixed scripts.
 */
export function phoneticKeys(word: string): string[] {
  const script = translitScript(word);
  if (!script) return [];
  const letters = word.replace(/['׳"״]/g, "");
  if (letters.length < (script === "la" ? 4 : 3)) return [];
  // A short word needs a longer key: a two-class key from a three-letter word joins too much.
  const minKey = letters.length >= (script === "la" ? 5 : 4) ? 2 : 3;
  if (script === "la") return expand(latinUnits(letters), minKey);
  const chars = [...word];
  const units: string[][] = [];
  let pos = 0;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (/['׳"״]/.test(ch)) continue;
    const last = !chars.slice(i + 1).some((c) => /[א-ת]/.test(c));
    units.push(hebrewReadings(ch, pos, last, chars[i + 1] ?? ""));
    pos++;
  }
  return expand(units, minKey);
}

/** True when two words of different scripts share a phonetic key ("Kohen" / "כהן"). */
export function isTransliteration(a: string, b: string): boolean {
  const sa = translitScript(a);
  const sb = translitScript(b);
  if (!sa || !sb || sa === sb) return false;
  const ka = new Set(phoneticKeys(a));
  return phoneticKeys(b).some((k) => ka.has(k));
}
