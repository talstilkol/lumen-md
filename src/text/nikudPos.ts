/**
 * Partial niqqud by part of speech (plan W2.5, W10.E42): "nouns only" and
 * "verbs only", beside "ambiguous only" (nikudRun's softmax margin).
 *
 * The text is pointed in full first. Then a part-of-speech tagger names each
 * word's class, and only the words of the chosen class keep their points.
 * The tagger is a seam (`PosTagger`). The one shipped here reads the offline
 * Hebrew lexicon (W5.26, Hebrew Wiktionary's "חלק דיבר" field). When a word
 * has senses of more than one class, the sense whose pointing matches the
 * model's reading decides. A model tagger (DictaBERT-joint) can replace it
 * behind the same signature.
 *
 * A word the tagger cannot place (not in the lexicon, or still ambiguous)
 * is left plain. Pointing a word as the wrong class would mislead a reader;
 * leaving it plain only matches the plain text.
 */
import { removeNikud } from "./nikud";
import type { DetailedNikud } from "./nikudRun";
import { candidates, type LexiconIndex } from "../lexicon/lexicon";

/** The partial modes: `ambiguous` keeps the words the model is unsure of; `nouns` / `verbs` keep one part of speech. */
export type PartialMode = "ambiguous" | "nouns" | "verbs";
export const PARTIAL_MODES: readonly PartialMode[] = ["ambiguous", "nouns", "verbs"];

/** A word's class. `null`: the tagger cannot tell. */
export type WordClass = "noun" | "verb" | "other" | null;

/** One word as the model pointed it, and its plain letters. */
export interface TaggedWord {
  plain: string;
  pointed: string;
}

/** The seam: one class per word, in order. */
export type PosTagger = (words: readonly TaggedWord[]) => WordClass[] | Promise<WordClass[]>;

/** The class of a Hebrew Wiktionary part-of-speech name ("שם עצם", "פועל", "שם תואר", …). */
export function posClass(pos: string): WordClass {
  const p = pos.replace(/־/g, " ").replace(/\s+/g, " ").trim();
  if (!p) return null;
  if (/^(שם עצם|שם פרטי)/.test(p)) return "noun";
  if (/^פועל/.test(p)) return "verb";
  return "other";
}

const POINTED_WORD = /[א-ת][א-תְ-ׇ'"״׳]*/g;
// Vowels and the shin/sin dots: what tells two readings apart. Dagesh and meteg are dropped
// (a prefix letter adds or removes a dagesh lene: בַּיִת / בְּבַיִת).
const DROP = /[֑-ּֽֿ֯׀׃-׆]/g;
const vowels = (w: string) => w.normalize("NFD").replace(DROP, "").normalize("NFC");

/** The pointed word without its first `letters` letters (and their marks). */
function dropLetters(pointed: string, letters: number): string {
  let seen = 0;
  for (let i = 0; i < pointed.length; i++) {
    if (/[א-ת]/.test(pointed[i])) {
      if (seen === letters) return pointed.slice(i);
      seen++;
    }
  }
  return "";
}

/**
 * The lexicon tagger. A headword's senses give its classes. With one class,
 * that is the word's. With several, the sense whose pointing matches the
 * model's reading (prefix letters peeled the same way) decides. Otherwise null.
 */
export function lexiconTagger(index: LexiconIndex): PosTagger {
  return (words) =>
    words.map(({ plain, pointed }) => {
      for (const c of candidates(plain)) {
        const senses = index.senses.get(c.word);
        if (!senses?.length) continue;
        const classes = new Set(senses.map((s) => posClass(s.pos)).filter((x): x is Exclude<WordClass, null> => x !== null));
        if (classes.size === 1) return [...classes][0];
        if (classes.size === 0) return null;
        const own = vowels(dropLetters(pointed, plain.length - c.word.length));
        const matching = new Set(senses.filter((s) => vowels(s.pointed) === own).map((s) => posClass(s.pos)));
        return matching.size === 1 ? [...matching][0] : null;
      }
      return null;
    });
}

/**
 * `pointed` (a fully pointed result) with points kept only on the words of
 * `mode`'s class; the alternatives list keeps the same words, with offsets in
 * the new text.
 */
export async function keepWordsOfClass(pointed: DetailedNikud, mode: "nouns" | "verbs", tagger: PosTagger): Promise<DetailedNikud> {
  const want: WordClass = mode === "nouns" ? "noun" : "verb";
  const matches = [...pointed.text.matchAll(POINTED_WORD)];
  const words = matches.map((m) => ({ pointed: m[0], plain: removeNikud(m[0]) }));
  const classes = await tagger(words);
  if (classes.length !== words.length) throw new Error(`niqqud: the tagger returned ${classes.length} classes for ${words.length} words`);
  let text = "";
  let last = 0;
  const moved = new Map<number, number>(); // a kept word's start: old offset → new offset
  matches.forEach((m, i) => {
    const a = m.index!;
    text += pointed.text.slice(last, a);
    const keep = classes[i] === want;
    if (keep) moved.set(a, text.length);
    text += keep ? m[0] : words[i].plain;
    last = a + m[0].length;
  });
  text += pointed.text.slice(last);
  const kept = pointed.words.filter((w) => moved.has(w.from)).map((w) => ({ ...w, from: moved.get(w.from)!, to: moved.get(w.from)! + (w.to - w.from) }));
  return { text, words: kept };
}
