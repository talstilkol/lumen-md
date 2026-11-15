/**
 * Named entities in Hebrew notes (plan W11.H11), from DictaBERT-NER
 * (dicta-il/dictabert-ner, CC BY 4.0, 0.2B; ONNX int8 by the model-convert
 * workflow, W11.M3), for two features:
 *
 *  - the PII redactor (2.6): people and places are hidden before text leaves
 *    the device (ai/pii.ts alignNer, via ai/piiNer.ts);
 *  - unlinked mentions (4.6): the people, organisations and places a note
 *    names — those that already have a note are linkable, the others are
 *    candidates for one.
 *
 * DictaBERT-NER's labels (its model card): PER, ORG, GPE, LOC, FAC, EVE,
 * WOA, ANG, DUC, TIMEX, TTL, MISC (BIO).
 */
import type { NerToken } from "../pii";
import { noteKey } from "../../lib/slug";

export type EntityLabel = "PER" | "ORG" | "GPE" | "LOC" | "FAC" | "EVE" | "WOA" | "ANG" | "DUC" | "TIMEX" | "TTL" | "MISC";
export const LINKABLE: readonly EntityLabel[] = ["PER", "ORG", "GPE", "LOC", "FAC", "EVE", "WOA"];

export interface TextEntity {
  start: number;
  end: number;
  text: string;
  label: EntityLabel;
  score: number;
}

const KNOWN = new Set<string>(["PER", "ORG", "GPE", "LOC", "FAC", "EVE", "WOA", "ANG", "DUC", "TIMEX", "TTL", "MISC"]);

/**
 * Token output (B-/I- labels, WordPiece "##" pieces, no offsets) aligned
 * with the text and merged into entities, every label kept (alignNer keeps
 * only the PII types). Pieces are found in order; an unknown label or a low
 * score ends the open entity.
 */
export function alignEntities(text: string, tokens: readonly NerToken[], minScore = 0.5): TextEntity[] {
  const out: TextEntity[] = [];
  let cursor = 0;
  let cur: (TextEntity & { n: number; sum: number }) | null = null;
  const close = () => {
    if (cur) out.push({ start: cur.start, end: cur.end, text: text.slice(cur.start, cur.end), label: cur.label, score: cur.sum / cur.n });
    cur = null;
  };
  for (const tok of tokens) {
    const piece = tok.word.replace(/^##/, "").replace(/^▁/, "");
    if (!piece) continue;
    const at = text.indexOf(piece, cursor);
    if (at < 0) continue;
    const cont = tok.word.startsWith("##");
    cursor = at + piece.length;
    const [bio, raw] = tok.entity.includes("-") ? (tok.entity.split("-", 2) as [string, string]) : ["B", tok.entity];
    const label = raw.toUpperCase();
    if (!KNOWN.has(label) || tok.score < minScore) {
      if (cur && cont) cur.end = cursor;
      else close();
      continue;
    }
    const gap = cur ? text.slice(cur.end, at) : "";
    if (cur && cur.label === label && (cont || bio === "I") && /^[\s'״"־-]*$/.test(gap)) {
      cur.end = cursor;
      cur.n++;
      cur.sum += tok.score;
    } else {
      close();
      cur = { start: at, end: cursor, text: "", label: label as EntityLabel, score: tok.score, n: 1, sum: tok.score };
    }
  }
  close();
  return out;
}

const PREFIXES = ["וב", "וה", "של", "ו", "ה", "ב", "ל", "מ", "ש", "כ"];

/** The entity's text and, for Hebrew, the same without one prefix letter (or two): "ובירושלים" → "ירושלים". */
function forms(s: string): string[] {
  const out = [s];
  if (/^[א-ת]/.test(s)) for (const p of PREFIXES) if (s.startsWith(p) && s.length - p.length >= 2) out.push(s.slice(p.length));
  return out;
}

export interface EntitySuggestion {
  /** The name as the note writes it (first occurrence). */
  text: string;
  label: EntityLabel;
  /** The note this name already has, if any (its title). */
  note: string | null;
  count: number;
  first: number;
}

/**
 * The names a note mentions, for the unlinked-mentions panel: linkable
 * labels only, names already inside a [[link]] left out, one entry per name.
 * `note` is the existing note it can link to; null means "no note yet".
 */
export function entitySuggestions(text: string, ents: readonly TextEntity[], titles: readonly string[]): EntitySuggestion[] {
  const byKey = new Map(titles.map((t) => [noteKey(t), t]));
  const linked: [number, number][] = [...text.matchAll(/\[\[[^\]]*\]\]/g)].map((m) => [m.index!, m.index! + m[0].length]);
  const inLink = (e: TextEntity) => linked.some(([a, b]) => e.start >= a && e.end <= b);
  const out = new Map<string, EntitySuggestion>();
  for (const e of ents) {
    if (!LINKABLE.includes(e.label) || inLink(e) || e.text.trim().length < 2) continue;
    const note = forms(e.text.trim()).map((f) => byKey.get(noteKey(f))).find(Boolean) ?? null;
    const key = note ? `note:${noteKey(note)}` : `text:${noteKey(e.text.trim())}`;
    const cur = out.get(key);
    if (cur) cur.count++;
    else out.set(key, { text: e.text.trim(), label: e.label, note, count: 1, first: e.start });
  }
  return [...out.values()].sort((a, b) => a.first - b.first);
}
