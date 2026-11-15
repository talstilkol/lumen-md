/**
 * "גרסה אחרת" — where the user's notes disagree (plan R12.10).
 *
 * Two searches over the vault, with no model:
 * - conflicts: the same statement about the same entities with a different
 *   value (a number with its unit, a date whose ranges cannot meet) or the
 *   opposite direction ("A replaced B" / "B replaced A") in two places;
 * - counter-evidence: a sentence about the same entities that carries a
 *   denial or a correction word (הכחיש, לא נכון, תיקון, denied, …).
 *
 * Every result is a candidate: two exact quotes, each at offsets that are
 * checked against the note's text (`alignQuote`), shown side by side and
 * never decided. A note of outside origin (a clipped page, an import, a
 * note marked untrusted: agents/provenance.ts) is flagged and gets no
 * weight. Nothing here writes: the report goes through the approval queue
 * (agents/contradictor.ts), never into a note directly.
 *
 * Clean reimplementation (design reference only: israelconnect's
 * counter-evidence and conflict detectors, AGPL; no code taken).
 */
import { extractDates } from "../daily/hebrewDates";

export interface Quote {
  note: string;
  start: number;
  end: number;
  text: string;
}

export type CandidateKind = "value" | "date" | "direction" | "denial" | "correction";

export interface Candidate {
  kind: CandidateKind;
  /** The entities both quotes are about. */
  subjects: string[];
  a: Quote;
  b: Quote;
  /** Notes of outside origin among the two, with why (provenance). */
  untrusted: Array<{ note: string; why: string[] }>;
  /** 1 when both notes are the user's own, 0 when either is outside content. */
  weight: 0 | 1;
}

export interface FindOptions {
  /** Entity names to look for (note titles, entity names); [[links]] in the text are added. */
  names?: readonly string[];
  /** Why a note is outside content (agents/provenance.untrustedSourcesOfNote); [] for the user's own. */
  untrusted?: (path: string, content: string) => string[];
  /** Each note's date (for relative dates in it). */
  noteDate?: (path: string) => string | undefined;
  /** At most this many candidates (default 200). */
  limit?: number;
}

/* ─── Text ───────────────────────────────────────────────────────────── */

interface Sentence {
  note: string;
  start: number;
  end: number;
  text: string;
}

const FRONTMATTER = /^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/;

/** Sentences with their offsets in the note (frontmatter and code fences skipped). */
export function sentences(note: string, text: string): Sentence[] {
  const out: Sentence[] = [];
  const fm = FRONTMATTER.exec(text);
  let body = text;
  if (fm) body = " ".repeat(fm[0].length) + text.slice(fm[0].length);
  body = body.replace(/```[\s\S]*?```/g, (m) => " ".repeat(m.length));
  // A sentence ends at a line break, or at . ! ? followed by a space or the end; a "." between digits (10.7.2023) does not end it.
  let start = 0;
  const push = (from: number, to: number) => {
    while (from < to && /\s/.test(body[from])) from++;
    while (to > from && /[\s.!?]/.test(body[to - 1])) to--;
    if (to - from >= 3) out.push({ note, start: from, end: to, text: text.slice(from, to) });
  };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\n" || ((ch === "." || ch === "!" || ch === "?") && (i + 1 >= body.length || /\s/.test(body[i + 1])))) {
      push(start, i + 1);
      start = i + 1;
    }
  }
  push(start, body.length);
  return out;
}

const NIQQUD = /[\u0591-\u05C7]/g;
const norm = (s: string) => s.normalize("NFC").replace(NIQQUD, "").replace(/[״"׳'`]/g, "").toLowerCase();
const PREFIX = "[ובלמהשכ]{0,3}[-־]?";
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The entities a sentence names: a [[link]], or a known name with up to three Hebrew prefix letters, as a whole word. */
function subjectsIn(text: string, names: readonly string[]): Array<{ name: string; start: number; end: number }> {
  const out: Array<{ name: string; start: number; end: number }> = [];
  for (const n of names) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:\\[\\[)?${PREFIX}(${escape(n)})(?:\\|[^\\]]*)?(?:\\]\\])?(?![\\p{L}\\p{N}])`, "gu");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) out.push({ name: n, start: m.index, end: m.index + m[0].length });
  }
  // The longest name wins where two overlap ("דנה לוי" over "דנה").
  out.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const kept: typeof out = [];
  for (const s of out) if (!kept.some((k) => s.start < k.end && k.start < s.end)) kept.push(s);
  return kept.sort((a, b) => a.start - b.start);
}

/** Words of a span, normalised, each with its Hebrew prefix letters dropped when what remains is a word. */
const words = (s: string) =>
  norm(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/* ─── Values ─────────────────────────────────────────────────────────── */

interface Value {
  kind: "number" | "date";
  start: number;
  end: number;
  /** number: the value and its unit word; date: the day range. */
  n?: number;
  unit?: string;
  from?: string;
  to?: string;
}

function valuesIn(text: string, reference?: string): Value[] {
  const out: Value[] = [];
  for (const d of extractDates(text, { reference })) if (d.kind !== "relative") out.push({ kind: "date", start: d.start, end: d.end, from: d.from, to: d.to });
  const re = /(?<![\p{L}\p{N}.,])(\d+(?:[.,]\d+)?)\s*(%|₪|[\p{L}]+)?/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const s = m.index;
    const e = s + m[1].length;
    if (out.some((v) => s < v.end && v.start < e)) continue;
    out.push({ kind: "number", start: s, end: s + m[0].length, n: Number(m[1].replace(",", ".")), unit: m[2] ? norm(m[2]) : "" });
  }
  return out.sort((a, b) => a.start - b.start);
}

const disagree = (x: Value, y: Value) => (x.kind === "date" ? x.to! < y.from! || y.to! < x.from! : x.unit === y.unit && x.n !== y.n);

/* ─── Cues ───────────────────────────────────────────────────────────── */

const DENIAL = /(?<![\p{L}])(?:[ושה]?)(?:הכחיש|הכחישה|הכחישו|מכחיש|מכחישה|מכחישים|הכחשה|הכחשת|לא\s+נכון|אינו\s+נכון|אינה\s+נכונה|שקר|הופרך|הופרכה|מעולם\s+לא|denied|denies|deny|not\s+true|never|false|refuted)(?![\p{L}])/iu;
const CORRECTION = /(?<![\p{L}])(?:[ושה]?)(?:תיקון|תוקן|תוקנה|טעות|בטעות|שגוי|שגויה|נפלה\s+טעות|בניגוד\s+ל|ולא\s+כפי|correction|corrected|incorrect|wrongly|mistakenly|contrary\s+to|erratum)(?![\p{L}])/iu;

/* ─── Quotes ─────────────────────────────────────────────────────────── */

/** A quote is kept only when the note holds exactly that text at those offsets. */
export function alignQuote(notes: ReadonlyMap<string, string>, q: Quote): boolean {
  const text = notes.get(q.note);
  return text !== undefined && q.start >= 0 && q.end <= text.length && text.slice(q.start, q.end) === q.text && q.text.trim().length > 0;
}

/* ─── Search ─────────────────────────────────────────────────────────── */

interface Parsed {
  s: Sentence;
  subjects: Array<{ name: string; start: number; end: number }>;
  values: Value[];
}

const quoteOf = (s: Sentence): Quote => ({ note: s.note, start: s.start, end: s.end, text: s.text });

/** The words just before a value, with the entities taken out: the statement's "key". */
function keyBefore(p: Parsed, v: Value): string {
  let pre = p.s.text.slice(0, v.start);
  for (const sub of [...p.subjects].reverse()) if (sub.end <= v.start) pre = pre.slice(0, sub.start) + " " + pre.slice(sub.end);
  return words(pre).slice(-2).join(" ");
}

export function findContradictions(notes: ReadonlyMap<string, string>, opts: FindOptions = {}): Candidate[] {
  const limit = opts.limit ?? 200;
  const linkNames = new Set<string>();
  for (const text of notes.values()) for (const m of text.matchAll(/\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g)) linkNames.add(m[1].trim());
  const names = [...new Set([...(opts.names ?? []), ...linkNames])].filter((n) => n.length >= 2);
  const parsed: Parsed[] = [];
  for (const [note, text] of notes) {
    if (!/\.md$/i.test(note)) continue;
    for (const s of sentences(note, text)) {
      const subjects = subjectsIn(s.text, names);
      if (!subjects.length) continue;
      parsed.push({ s, subjects, values: valuesIn(s.text, opts.noteDate?.(note)) });
    }
  }
  const untrustedCache = new Map<string, string[]>();
  const why = (note: string) => {
    let w = untrustedCache.get(note);
    if (!w) untrustedCache.set(note, (w = opts.untrusted?.(note, notes.get(note) ?? "") ?? []));
    return w;
  };
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const add = (kind: CandidateKind, subjects: string[], x: Sentence, y: Sentence) => {
    if (x.note === y.note && x.start === y.start) return;
    const [a, b] = x.note < y.note || (x.note === y.note && x.start < y.start) ? [x, y] : [y, x];
    const key = `${kind}|${a.note}:${a.start}|${b.note}:${b.start}`;
    if (seen.has(key)) return;
    const qa = quoteOf(a);
    const qb = quoteOf(b);
    if (!alignQuote(notes, qa) || !alignQuote(notes, qb)) return;
    seen.add(key);
    const untrusted = [a.note, b.note].filter((n, i, arr) => arr.indexOf(n) === i).map((n) => ({ note: n, why: why(n) })).filter((u) => u.why.length);
    out.push({ kind, subjects: [...subjects].sort(), a: qa, b: qb, untrusted, weight: untrusted.length ? 0 : 1 });
  };
  const subjKey = (p: Parsed) => [...new Set(p.subjects.map((x) => x.name))].sort().join("|");

  // 1. Same statement, different value.
  const byStatement = new Map<string, Array<{ p: Parsed; v: Value }>>();
  for (const p of parsed)
    for (const v of p.values) {
      const k = `${subjKey(p)}#${v.kind}#${keyBefore(p, v)}#${v.kind === "number" ? v.unit : ""}`;
      if (!keyBefore(p, v)) continue;
      byStatement.set(k, [...(byStatement.get(k) ?? []), { p, v }]);
    }
  for (const list of byStatement.values())
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const x = list[i];
        const y = list[j];
        // Two values in one sentence ("on 5.5, not 4.5") are a correction, found below, not a conflict with itself.
        if (x.p.s === y.p.s) continue;
        if (x.p.s.note === y.p.s.note) continue;
        if (disagree(x.v, y.v)) add(x.v.kind === "date" ? "date" : "value", [...new Set(x.p.subjects.map((s) => s.name))], x.p.s, y.p.s);
      }

  // 2. Opposite direction: the same words with two entities in swapped order.
  const byShape = new Map<string, Array<{ p: Parsed; order: string }>>();
  for (const p of parsed) {
    const uniq = [...new Map(p.subjects.map((s) => [s.name, s])).values()];
    if (uniq.length !== 2 || p.values.length) continue;
    let shape = p.s.text;
    for (const sub of [...p.subjects].reverse()) shape = shape.slice(0, sub.start) + " \u0001 " + shape.slice(sub.end);
    const k = `${[uniq[0].name, uniq[1].name].sort().join("|")}#${words(shape.replace(/\u0001/g, "xslotx")).join(" ")}`;
    byShape.set(k, [...(byShape.get(k) ?? []), { p, order: `${p.subjects[0].name}>${p.subjects[p.subjects.length - 1].name}` }]);
  }
  for (const list of byShape.values())
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++)
        if (list[i].order !== list[j].order && list[i].p.s.note !== list[j].p.s.note) add("direction", list[i].p.subjects.map((s) => s.name), list[i].p.s, list[j].p.s);

  // 3. Counter-evidence: a denial or a correction about the same entities, against a sentence that states something about them.
  const cues = parsed.filter((p) => DENIAL.test(p.s.text) || CORRECTION.test(p.s.text));
  for (const c of cues) {
    const kind: CandidateKind = CORRECTION.test(c.s.text) ? "correction" : "denial";
    const mine = new Set(c.subjects.map((s) => s.name));
    for (const p of parsed) {
      if (p === c || p.s.note === c.s.note || DENIAL.test(p.s.text) || CORRECTION.test(p.s.text)) continue;
      const shared = [...new Set(p.subjects.map((s) => s.name))].filter((n) => mine.has(n));
      if (!shared.length) continue;
      // They must share a content word besides the names, so a denial of one thing is not matched to everything about the person.
      const strip = (x: Parsed) => {
        let t = x.s.text;
        for (const sub of [...x.subjects].reverse()) t = t.slice(0, sub.start) + " " + t.slice(sub.end);
        return new Set(words(t).filter((w) => w.length >= 3).map((w) => w.replace(/^[ובלמהשכ]{1,2}(?=[\p{L}]{3,})/u, "")));
      };
      const cw = strip(c);
      if (![...strip(p)].some((w) => cw.has(w))) continue;
      add(kind, shared, p.s, c.s);
    }
  }
  // The user's own notes first, then by kind and place.
  const rank: Record<CandidateKind, number> = { date: 0, value: 1, direction: 2, correction: 3, denial: 4 };
  out.sort((x, y) => y.weight - x.weight || rank[x.kind] - rank[y.kind] || (x.a.note < y.a.note ? -1 : x.a.note > y.a.note ? 1 : x.a.start - y.a.start));
  return out.slice(0, limit);
}
