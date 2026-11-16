/**
 * Yiddish spelling (plan W7.9), the pure part: which words of a paragraph
 * are Yiddish prose, the spellings a word may be written in (pointed alef
 * typed as a precomposed letter, ligature digraphs, YIVO's ייִ where the
 * word list has יי), and the matches for the words a Hunspell list does not
 * know. The list itself is never bundled (GPL-3.0); downloading it is off
 * pending the owner's licence decision (YIDDISH_DOWNLOAD_ENABLED below).
 */
import type { GrammarMatch } from "./grammar";
import { maskNonProse } from "./englishSpell";
import { normalizeYiddish } from "../text/yiddish";

export const YI_SPELL_RULE = "YI_SPELL";
export const YI_SPELL_MESSAGE_KEY = "yiddish.spell.unknown";

/**
 * The word list, pinned: its commit, and each file's SHA-256 and size (checked on the raw bytes after
 * download). Where it comes from is recorded in models/registry.json, not in the app.
 *
 * R8-M5: the download is OFF, pending the owner. The list is GPL-3.0 and the licence gate refuses a
 * forbidden-class model the app code fetches; #981 let it through with a warn entry in
 * licenses.allow.json, which a lane may not add (no loosening of an allow-list). A default-off flag
 * cannot satisfy the gate either: it reads the code, not a setting. So the entry is gone and so is
 * the upstream address. The owner may re-enable it by approving the licences.allow.json entry
 * (GPL-3.0-only vs -or-later checked upstream), putting the address back as `YIDDISH_DICT_SOURCE`,
 * and setting YIDDISH_DOWNLOAD_ENABLED to true; the pins are to be confirmed on the Mac first.
 */
export const YIDDISH_DOWNLOAD_ENABLED = false;
/**
 * Decision D1 §6 (16.11.2026): the Yiddish list Lumen offers must carry a licence from the licence
 * gate's own permissive set (scripts/lib/licenses.mjs OK_LICENCE_IDS), so no allow-list exception is
 * ever needed. hunspell-yi 1.1 (Finkel 2010, McNamara's conversion) is offered under
 * "LGPL-2.1-or-later OR GPL-2.0-or-later OR MPL-1.1" (Fedora's package), so it can be taken under
 * MPL-1.1; it replaces the GPL-3.0 pin below once a session that can reach it pins its files
 * (sha256 + size). Until then the download stays off, and the GPL-3.0 pin is refused even with an address.
 */
export const YIDDISH_LIST_LICENCES = Object.freeze(["MPL-1.1", "MPL-2.0", "MIT", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "ISC", "CC0-1.0", "CC-BY-4.0", "Unlicense"]);
export const yiddishListLicenceOk = (license: string): boolean => YIDDISH_LIST_LICENCES.includes(license);

export const YIDDISH_DICT = {
  commit: "9f537e5a46caf571c91d86e8a3cf5d0f4ac77192",
  license: "GPL-3.0",
  credit: "Raphael A. Finkel, Simche Taub, Andrey Rozenberg (hunspell-yi)",
  files: {
    aff: { name: "yi.aff", sha256: "5598c00cc3b467244e20f004350fa474a2d543621a6a77ec5378b39cdc9c8cb5", bytes: 338 },
    dic: { name: "yi.dic", sha256: "7c122babdcb20c47a87459ab3192c4c2f35900420b84bca35960a1a48de82ee0", bytes: 2400553 },
  },
} as const;


export interface SpellChecker {
  correct(word: string): boolean;
  suggest(word: string): string[];
}

/** A Hebrew-letter word with its points, and a geresh/gershayim inside (ס׳, ר״ל). */
const WORD = /[א-ת][א-ת\u0591-\u05C7\u05F0-\u05F4\uFB1D-\uFB4F]*/g;

export function yiddishWords(text: string): { word: string; offset: number }[] {
  const masked = maskNonProse(text);
  const out: { word: string; offset: number }[] = [];
  for (const m of masked.matchAll(WORD)) {
    const word = m[0].replace(/[\u05F3\u05F4]+$/, "");
    if (word.length >= 2) out.push({ word, offset: m.index! });
  }
  return out;
}

/**
 * The forms to look up. hunspell-yi writes YIVO without its two optional
 * points: no rafe (פֿ is written פ, since פּ carries a dagesh) and no khirek
 * yud (ייִדיש is יידיש). A word typed with them is looked up without them too.
 */
export function lookupForms(word: string): string[] {
  const n = normalizeYiddish(word);
  const plain = n.replace(/[\u05B4\u05BF]/g, "");
  return plain === n ? [n] : [n, plain];
}

/** A suggestion as YIVO writes it: the list's bare פ (not final, no dagesh) is פֿ. */
export function yivoForm(listWord: string): string {
  return normalizeYiddish(listWord).replace(/\u05E4(?![\u05BC\u05BF])/g, "\u05E4\u05BF");
}

/**
 * Lumen's own first guesses for the slips Yiddish typists make (MIT), tried
 * before Hunspell's generic suggestions: a point left off an alef (א → אַ,
 * אָ), a dagesh left off (פ → פּ), one vov for two, yud for ayin and back.
 * Each guess is a single change; only those the list knows are kept.
 */
export function yiddishSlipGuesses(spell: SpellChecker, word: string): string[] {
  const w = normalizeYiddish(word);
  const out = new Set<string>();
  const tryOne = (c: string) => {
    if (c !== w && lookupForms(c).some((f) => spell.correct(f))) out.add(yivoForm(c));
  };
  for (let i = 0; i < w.length; i++) {
    const c = w[i];
    const next = w[i + 1] ?? "";
    const marked = /[\u05B0-\u05C2]/.test(next);
    const at = (ins: string, drop = 1) => w.slice(0, i) + ins + w.slice(i + drop);
    if (c === "\u05D0" && !marked) {
      tryOne(at("\u05D0\u05B7"));
      tryOne(at("\u05D0\u05B8"));
    }
    if (c === "\u05E4" && !marked) tryOne(at("\u05E4\u05BC"));
    if (c === "\u05D5" && next !== "\u05D5" && w[i - 1] !== "\u05D5") tryOne(at("\u05D5\u05D5"));
    if (c === "\u05D9") tryOne(at("\u05E2"));
    if (c === "\u05E2") tryOne(at("\u05D9"));
  }
  return [...out];
}

export function isKnownYiddish(spell: SpellChecker, word: string): boolean {
  if (lookupForms(word).some((f) => spell.correct(f))) return true;
  // A compound with a maqaf (וואָרט־אוצרות): each part on its own.
  const parts = word.split("\u05BE").filter(Boolean);
  return parts.length > 1 && parts.every((p) => lookupForms(p).some((f) => spell.correct(f)));
}

export interface YiddishSpellOptions {
  /** Suggestions cost up to a second a word: only the first this many unknown words get them. */
  maxSuggest?: number;
  suggestCache?: Map<string, string[]>;
  personal?: ReadonlySet<string>;
}

export function yiddishSpelling(spell: SpellChecker, text: string, opts: YiddishSpellOptions = {}): GrammarMatch[] {
  const max = opts.maxSuggest ?? 10;
  const cache = opts.suggestCache ?? new Map<string, string[]>();
  let suggested = 0;
  const out: GrammarMatch[] = [];
  for (const tok of yiddishWords(text)) {
    if (opts.personal?.has(normalizeYiddish(tok.word))) continue;
    if (isKnownYiddish(spell, tok.word)) continue;
    const key = normalizeYiddish(tok.word);
    let replacements = cache.get(key);
    if (!replacements && suggested < max) {
      suggested++;
      const guesses = yiddishSlipGuesses(spell, key);
      replacements = [...new Set([...guesses, ...spell.suggest(lookupForms(key).pop()!).map(yivoForm)])].slice(0, 5);
      cache.set(key, replacements);
    }
    out.push({ offset: tok.offset, length: tok.word.length, message: YI_SPELL_MESSAGE_KEY, replacements: replacements ?? [], rule: { id: YI_SPELL_RULE, category: "TYPOS" } });
  }
  return out;
}
