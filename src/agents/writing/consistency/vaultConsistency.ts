/**
 * W13.W6 — the vault consistency checker: one entity, one spelling; one
 * fact, one value; one term, the user's term. ProWritingAid checks one
 * document; this checks the whole vault against the entity graph.
 *
 * Three checks, all rules (no model, no network), all suggest-and-approve:
 *
 * 1. **Name variants** (entity resolution, W12.E3): every mention of a known
 *    entity is found with its prefix cut ("בירושלים" → "ירושלים"), its
 *    ktiv male / haser and its niqqud. When one name of one entity is
 *    written two ways across the vault ("חנוכה" / "חנוכּה", "ירושלים" /
 *    "ירושלם"), the minority spelling is flagged with the preferred one (the
 *    entity's own name when the vault uses it, else the most common) as the
 *    replacement. A Latin name inside a Hebrew paragraph ("Hanukkah") is
 *    flagged with the Hebrew name, except right after it or in brackets.
 *    Different aliases are different names, never variants (״רמב״ם״ and
 *    ״משה בן מימון״ are both fine). Fully pointed paragraphs (poetry, prayer)
 *    are skipped.
 * 2. **Fact conflicts**: a date or a number said of the same entity in the
 *    same frame (the content words around it) differs between two
 *    paragraphs. No replacement — we cannot know which is right — but a
 *    comment with both values and links to both paragraphs. Bounds ("more
 *    than") are never compared, approximations ("כ-", "about") within 10%
 *    are equal, and two values with different time qualifiers ("in 2010" /
 *    "in 2020") are two facts.
 * 3. **The user's terms**: a glossary note in the vault ("glossary.md",
 *    "מילון מונחים.md", or front matter `lumen: glossary`) lists
 *    `- preferred: variant, variant` (or a two-column table); each variant
 *    in the vault is flagged with the preferred term, prefixes kept.
 *
 * Every suggestion carries two paragraph links (`path#^id` or `path#p-hash`,
 * W12.A1's anchors, nothing written to the note): where it is, and the other
 * source (the other fact, the preferred spelling, the glossary line).
 */
import type { Entity } from "../../../entities/model";
import { EntityIndex, haserKey, normName, prefixSplits } from "../../../entities/resolve";
import { phoneticKeys } from "../../../text/translit";
import { noteParagraphs, type Paragraph } from "../../../ai/paragraphAnchors";
import { RULES_MODEL, conf, type WritingSuggestion } from "../suggestionShape";
import { STOP, breathe, isHebrewText, niqqudShare, plain, sentences, stem, throwIfAborted, words, type Word } from "../textTools";
import { disagree, showValue, valuesOf, type Value } from "./values";

export const AGENT_ID = "consistency";

export interface VaultNote {
  path: string;
  content: string;
}

export interface GlossaryTerm {
  preferred: string;
  variants: string[];
  /** Where the term is defined, for the second link. */
  link?: string;
}

export interface ConsistencyInput {
  notes: readonly VaultNote[];
  entities: ReadonlyArray<Pick<Entity, "id" | "name" | "aliases">>;
  /** Terms; when absent, read from the vault's glossary note. */
  glossary?: readonly GlossaryTerm[];
}

export interface ConsistencyOptions {
  signal?: AbortSignal;
  /** Which checks to run (default all). */
  checks?: ReadonlyArray<"names" | "facts" | "terms">;
}

/* ─── Glossary ───────────────────────────────────────────────────────── */

const GLOSSARY_NAMES = /(?:^|\/)(?:glossary|מילון[ -]מונחים|מונחים)\.md$/i;

export function isGlossaryNote(n: VaultNote): boolean {
  if (GLOSSARY_NAMES.test(n.path)) return true;
  const fm = /^---\n([\s\S]*?)\n---/.exec(n.content);
  return !!fm && /^\s*lumen\s*:\s*glossary\s*$/m.test(fm[1]);
}

/** `- preferred: v1, v2` / `- preferred = v1, v2` / `| preferred | v1, v2 |` → terms. */
export function parseGlossary(markdown: string, path = ""): GlossaryTerm[] {
  const out: GlossaryTerm[] = [];
  const paras = noteParagraphs(markdown);
  const linkAt = (offset: number) => {
    const p = paras.find((q) => q.start <= offset && offset <= q.end);
    return p ? `${path}#${p.anchor}` : undefined;
  };
  let off = 0;
  for (const line of markdown.split("\n")) {
    const at = off;
    off += line.length + 1;
    let m = /^\s*[-*+]\s+(.+?)\s*(?::|=|←|->|→)\s*(.+)$/.exec(line);
    if (!m) {
      const cells = /^\s*\|(.+)\|\s*$/.exec(line)?.[1].split("|").map((c) => c.trim());
      if (cells && cells.length >= 2 && !/^:?-{2,}:?$/.test(cells[0]) && !/^(?:term|מונח|preferred|מועדף)$/i.test(cells[0])) m = ["", cells[0], cells[1]] as unknown as RegExpExecArray;
    }
    if (!m) continue;
    const preferred = m[1].replace(/\*\*/g, "").trim();
    const variants = m[2]
      .split(/[,،;/]|\s+או\s+/)
      .map((v) => v.replace(/\*\*/g, "").trim())
      .filter((v) => v && v !== preferred);
    if (preferred && variants.length) out.push({ preferred, variants, link: linkAt(at) });
  }
  return out;
}

/* ─── Entity mentions ────────────────────────────────────────────────── */

interface Mention {
  entity: string;
  /** haser key of the name it matched: one name, many spellings. */
  nameKey: string;
  start: number;
  end: number;
  /** The written name after the prefix, niqqud kept. */
  written: string;
  prefix: string;
  script: "he" | "la";
}

const QUOTE_FOLD = (s: string) => s.replace(/״/g, '"').replace(/׳/g, "'").replace(/[־‐‑–]/g, "-").replace(/[ \t]+/g, " ");
/**
 * The spelling a variant check compares: niqqud kept, quotes folded (״/" and ׳/' are one key), the article ה off.
 * Audit r4 A2.10: a maqaf or hyphen is NOT a space — "Tel-Aviv" / "Tel Aviv" and "בן־גוריון" / "בן גוריון" are two
 * spellings of one name (maqaf and hyphen are one typing, as the quotes are).
 */
const formKey = (w: string) => QUOTE_FOLD(w.normalize("NFC")).replace(/^ה(?=[א-ת])/, "");

class Scanner {
  readonly index: EntityIndex;
  private names = new Map<string, string>(); // normName(name) → haser key of the name
  private heName = new Map<string, string>(); // entity → its Hebrew display name
  private phon = new Map<string, Set<string>>(); // phonetic key of a one-word Hebrew name → entities
  readonly maxWords: number;

  constructor(entities: ReadonlyArray<Pick<Entity, "id" | "name" | "aliases">>) {
    this.index = new EntityIndex(entities);
    let max = 1;
    for (const e of entities) {
      for (const n of [e.name, ...e.aliases]) {
        const k = normName(n);
        if (!k) continue;
        this.names.set(k, haserKey(n));
        max = Math.max(max, k.split(" ").length);
        if (/[א-ת]/.test(n) && !this.heName.has(e.id)) this.heName.set(e.id, n);
        if (/[א-ת]/.test(n) && !k.includes(" ")) for (const p of phoneticKeys(k)) (this.phon.get(p) ?? this.phon.set(p, new Set()).get(p)!).add(e.id);
      }
      if (/[א-ת]/.test(e.name)) this.heName.set(e.id, e.name);
    }
    this.maxWords = Math.min(max, 5);
  }

  hebrewName(id: string): string | undefined {
    return this.heName.get(id);
  }

  private nameKeyOf(key: string): string {
    return this.names.get(key) ?? haserKey(key);
  }

  /** Mentions in `text` (offsets + `base`). */
  scan(text: string, base: number, hebrewParagraph: boolean): Mention[] {
    const ws = words(text).filter((w) => w.script !== "num");
    const out: Mention[] = [];
    for (let i = 0; i < ws.length; ) {
      let hit: Mention | null = null;
      for (let n = Math.min(this.maxWords, ws.length - i); n >= 1 && !hit; n--) {
        const span = ws.slice(i, i + n);
        // Words of one name are separated by spaces or a maqaf only.
        if (span.some((w, k) => k > 0 && !/^[ \t־-]+$/.test(text.slice(span[k - 1].end, w.start)))) continue;
        hit = this.match(text, span, base);
      }
      if (!hit && hebrewParagraph && ws[i].script === "la") hit = this.translit(ws[i], base);
      if (hit) {
        out.push(hit);
        i += Math.max(1, words(text.slice(hit.start - base, hit.end - base)).length);
      } else i++;
    }
    return out;
  }

  private match(text: string, span: Word[], base: number): Mention | null {
    const raw = text.slice(span[0].start, span[span.length - 1].end);
    const key = normName(raw);
    if (!key) return null;
    const script = span[0].script === "la" ? "la" : "he";
    const make = (entity: string, nameKey: string, prefixLetters: number, how: string): Mention => {
      // Cut the prefix letters as written (niqqud after a letter goes with it).
      let cut = 0;
      for (let letters = 0; cut < raw.length && letters < prefixLetters; ) {
        if (/[א-ת]/.test(raw[cut])) letters++;
        cut++;
        while (cut < raw.length && /[֑-ׇ]/.test(raw[cut])) cut++;
      }
      const prefix = raw.slice(0, cut).replace(/[-־]$/, "");
      if (raw[cut] === "-" || raw[cut] === "־") cut++;
      void how;
      return { entity, nameKey, start: base + span[0].start + cut, end: base + span[span.length - 1].end, written: raw.slice(cut), prefix, script };
    };
    const exact = this.index.lookup(key);
    if (exact) return make(exact, this.nameKeyOf(key), 0, "exact");
    if (script === "la") return null;
    const [first, ...rest] = key.split(" ");
    const tail = rest.length ? ` ${rest.join(" ")}` : "";
    const splits = prefixSplits(first);
    for (const [p, s] of splits) {
      for (const f of "בכל".includes(p.slice(-1)) ? [s, `ה${s}`] : [s]) {
        const id = this.index.lookup(f + tail);
        if (id) return make(id, this.nameKeyOf(f + tail), p.length, "prefix");
      }
    }
    // Ktiv male / haser: only for names of four letters or more (short keys collide).
    if (key.replace(/ /g, "").length >= 4) {
      const h = this.index.lookupHaser(key);
      if (h) return make(h, haserKey(key), 0, "haser");
      for (const [p, s] of splits) {
        if ((s + tail).replace(/ /g, "").length < 4) continue;
        for (const f of "בכל".includes(p.slice(-1)) ? [s, `ה${s}`] : [s]) {
          const id = this.index.lookupHaser(f + tail);
          if (id) return make(id, haserKey(f + tail), p.length, "haser");
        }
      }
    }
    return null;
  }

  /** A capitalised Latin word in a Hebrew paragraph that sounds like a one-word Hebrew name ("Chanukah"). */
  private translit(w: Word, base: number): Mention | null {
    if (w.text.length < 5 || !/^[A-Z]/.test(w.text)) return null;
    const hits = new Set<string>();
    for (const k of phoneticKeys(w.text.toLowerCase())) for (const id of this.phon.get(k) ?? []) hits.add(id);
    if (hits.size !== 1) return null;
    const id = [...hits][0];
    return { entity: id, nameKey: `la:${plain(w.text)}`, start: base + w.start, end: base + w.end, written: w.text, prefix: "", script: "la" };
  }
}

/* ─── The run ────────────────────────────────────────────────────────── */

interface ParaCtx {
  note: VaultNote;
  para: Paragraph;
  link: string;
  hebrew: boolean;
  pointed: boolean;
  mentions: Mention[];
}

interface Fact {
  id: number;
  ctx: ParaCtx;
  entity: string;
  value: Value;
  frame: Set<string>;
  qualifiers: Set<number>;
}

const MSG = {
  he: {
    variant: (w: string, p: string) => `״${w}״ — בשאר הכספת כתוב ״${p}״`,
    variantWhy: (w: string, p: string, n: number, m: number) => `אותה ישות נכתבת בשתי צורות: ״${p}״ (${m} פעמים) ו״${w}״ (${n}). כדאי לבחור צורה אחת. מקור הצורה המועדפת בקישור השני.`,
    foreign: (w: string, p: string) => `״${w}״ בטקסט עברי — בגרף הישויות: ״${p}״`,
    foreignWhy: (w: string, p: string) => `השם הלועזי ״${w}״ מופיע באמצע פסקה בעברית; לישות יש שם עברי, ״${p}״. אם הלועזי נחוץ, כדאי לכתוב אותו בסוגריים אחרי השם העברי.`,
    fact: (a: string, b: string) => `כאן ${a}, ובפתק אחר ${b}`,
    factWhy: (ent: string, a: string, b: string, other: string) => `שני פתקים אומרים דברים שונים על אותה עובדה של ״${ent}״: ${a} כאן, ו-${b} ב-${other}. רק אחד מהם יכול להיות נכון — בדקו מול המקור. שני הקישורים מובילים לשתי הפסקאות.`,
    term: (w: string, p: string) => `״${w}״ → ״${p}״ (מילון המונחים שלך)`,
    termWhy: (w: string, p: string) => `במילון המונחים של הכספת ״${p}״ הוא המונח המועדף, ו״${w}״ רשום כחלופה. הקישור השני מוביל לשורה במילון.`,
  },
  en: {
    variant: (w: string, p: string) => `"${w}" — the rest of the vault writes "${p}"`,
    variantWhy: (w: string, p: string, n: number, m: number) => `The same entity is written two ways: "${p}" (${m}×) and "${w}" (${n}×). Pick one. The second link shows the preferred form.`,
    foreign: (w: string, p: string) => `"${w}" in Hebrew text — the entity graph has "${p}"`,
    foreignWhy: (w: string, p: string) => `The Latin name "${w}" sits inside a Hebrew paragraph; the entity has a Hebrew name, "${p}". If the Latin form is needed, put it in brackets after the Hebrew name.`,
    fact: (a: string, b: string) => `${a} here, ${b} in another note`,
    factWhy: (ent: string, a: string, b: string, other: string) => `Two notes disagree on the same fact about "${ent}": ${a} here and ${b} in ${other}. Only one can be right — check the source. Both links lead to the two paragraphs.`,
    term: (w: string, p: string) => `"${w}" → "${p}" (your glossary)`,
    termWhy: (w: string, p: string) => `Your vault glossary lists "${p}" as the preferred term and "${w}" as a variant. The second link leads to the glossary line.`,
  },
};

const msgs = (hebrew: boolean) => (hebrew ? MSG.he : MSG.en);

/** Spans that are not prose: code, link targets, front matter keys. */
function maskNonProse(text: string): string {
  return text
    .replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length))
    .replace(/\]\([^)]*\)/g, (m) => " ".repeat(m.length))
    .replace(/https?:\/\/\S+/g, (m) => " ".repeat(m.length));
}

function frameOf(sentence: string, base: number, vals: Value[], i: number, skip: Array<[number, number]>): Set<string> {
  const v = vals[i];
  const lo = i > 0 ? vals[i - 1].end : base;
  const hi = i + 1 < vals.length ? vals[i + 1].start : base + sentence.length;
  const pick = (from: number, to: number) =>
    words(sentence)
      .filter((w) => w.script !== "num")
      .filter((w) => base + w.start >= from && base + w.end <= to)
      .filter((w) => !skip.some(([a, b]) => base + w.start < b && base + w.end > a))
      .map((w) => plain(w.text))
      .filter((p) => p.length > 1 && !STOP.has(p) && !STOP.has(p.replace(/^[ובהלמשכ]/, "")))
      .map((p) => stem(p));
  if (vals.length === 1) return new Set(pick(base, base + sentence.length));
  const before = pick(lo, v.start);
  return new Set(before.length ? before : pick(v.end, hi));
}

const overlap = <T,>(a: ReadonlySet<T>, b: ReadonlySet<T>) => {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
};

/** The whole check, synchronously (for tests and workers). */
export function checkVaultConsistency(input: ConsistencyInput, opts: ConsistencyOptions = {}): WritingSuggestion[] {
  const it = consistencySteps(input, opts);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/** The same, yielding to the UI every 200 notes; rejects with AbortError when `signal` aborts. */
export async function runVaultConsistency(input: ConsistencyInput, opts: ConsistencyOptions = {}): Promise<WritingSuggestion[]> {
  const it = consistencySteps(input, opts);
  for (;;) {
    throwIfAborted(opts.signal);
    const r = it.next();
    if (r.done) return r.value;
    await breathe();
  }
}

function* consistencySteps(input: ConsistencyInput, opts: ConsistencyOptions): Generator<void, WritingSuggestion[]> {
  const checks = new Set(opts.checks ?? ["names", "facts", "terms"]);
  const glossaryNotes = input.notes.filter(isGlossaryNote);
  const glossary = input.glossary ?? glossaryNotes.flatMap((n) => parseGlossary(n.content, n.path));
  const scanner = new Scanner(input.entities);
  const nameOf = new Map(input.entities.map((e) => [e.id, e.name]));
  const ctxs: ParaCtx[] = [];
  const out: WritingSuggestion[] = [];
  let count = 0;

  for (const note of input.notes) {
    if (glossaryNotes.includes(note)) continue;
    if (++count % 200 === 0) {
      throwIfAborted(opts.signal);
      yield;
    }
    for (const para of noteParagraphs(note.content)) {
      if (/^\s*(?:```|~~~|#{1,6}\s)/.test(para.text)) continue; // code and headings are not prose
      const prose = maskNonProse(para.text);
      const hebrew = isHebrewText(prose);
      const ctx: ParaCtx = { note, para, link: `${note.path}#${para.anchor}`, hebrew, pointed: niqqudShare(prose) > 0.5, mentions: [] };
      if (input.entities.length && (checks.has("names") || checks.has("facts"))) ctx.mentions = scanner.scan(prose, para.start, hebrew);
      ctxs.push(ctx);
      if (checks.has("terms")) out.push(...termSuggestions(ctx, prose, glossary));
    }
  }
  if (checks.has("names")) out.push(...nameSuggestions(ctxs, scanner, input));
  if (checks.has("facts")) {
    throwIfAborted(opts.signal);
    yield;
    out.push(...factSuggestions(ctxs, nameOf));
  }
  return out.sort((a, b) => (a.path ?? "").localeCompare(b.path ?? "") || a.range.from - b.range.from);
}

/* ─── 1. names ───────────────────────────────────────────────────────── */

function nameSuggestions(ctxs: ParaCtx[], scanner: Scanner, input: ConsistencyInput): WritingSuggestion[] {
  const out: WritingSuggestion[] = [];
  const groups = new Map<string, Array<{ m: Mention; ctx: ParaCtx }>>();
  for (const ctx of ctxs) {
    for (const m of ctx.mentions) {
      if (m.script === "la" && ctx.hebrew) {
        const he = scanner.hebrewName(m.entity);
        const content = ctx.note.content;
        const around = content.slice(Math.max(0, m.start - 2), m.end + 1);
        const justBefore = content.slice(Math.max(0, m.start - 40), m.start);
        // "ירושלים (Jerusalem)" or "ירושלים, Jerusalem" is a gloss, not a variant.
        const glossed = /[([]\s*$/.test(content.slice(Math.max(0, m.start - 2), m.start)) || /^\s*[)\]]/.test(content.slice(m.end)) || (he && normName(justBefore).endsWith(normName(he)));
        if (he && !glossed && !/[([].*[)\]]/.test(around)) {
          out.push({
            range: { from: m.start, to: m.end },
            kind: "foreign-script-name",
            message: msgs(true).foreign(m.written, he),
            rationale: msgs(true).foreignWhy(m.written, he),
            confidence: conf(0.75),
            replacement: he,
            agentId: AGENT_ID,
            model: RULES_MODEL,
            path: ctx.note.path,
            links: [ctx.link, entityLink(m.entity, input)],
          });
        }
        continue;
      }
      if (ctx.pointed) continue;
      const g = `${m.entity}\u0000${m.nameKey}\u0000${m.script}`;
      (groups.get(g) ?? groups.set(g, []).get(g)!).push({ m, ctx });
    }
  }
  const entityName = new Map(input.entities.map((e) => [e.id, e.name]));
  for (const list of groups.values()) {
    const byForm = new Map<string, Array<{ m: Mention; ctx: ParaCtx }>>();
    for (const x of list) {
      const f = formKey(x.m.written);
      (byForm.get(f) ?? byForm.set(f, []).get(f)!).push(x);
    }
    if (byForm.size < 2) continue;
    const own = formKey(entityName.get(list[0].m.entity) ?? "");
    const ranked = [...byForm.entries()].sort((a, b) => b[1].length - a[1].length || Number(b[0] === own) - Number(a[0] === own) || a[0].localeCompare(b[0]));
    const preferred = byForm.has(own) && byForm.get(own)!.length >= ranked[0][1].length / 2 ? own : ranked[0][0];
    const pref = byForm.get(preferred)!;
    const sample = pref[0];
    const prefWritten = sample.m.written.normalize("NFC");
    for (const [form, xs] of byForm) {
      if (form === preferred) continue;
      for (const { m, ctx } of xs) {
        // A niqqud-only difference is a softer finding than a different spelling.
        const niqqudOnly = plain(m.written) === plain(prefWritten);
        let replacement = prefWritten;
        if (!m.written.startsWith("ה") && replacement.startsWith("ה") && "בכל".includes(m.prefix.slice(-1))) replacement = replacement.slice(1);
        if (m.written.startsWith("ה") && !replacement.startsWith("ה") && !m.prefix) replacement = `ה${replacement}`;
        const t = msgs(ctx.hebrew);
        out.push({
          range: { from: m.start, to: m.end },
          kind: "name-variant",
          message: t.variant(m.written, prefWritten),
          rationale: t.variantWhy(m.written, prefWritten, xs.length, pref.length),
          confidence: conf(niqqudOnly ? 0.65 : 0.8),
          replacement,
          agentId: AGENT_ID,
          model: RULES_MODEL,
          path: ctx.note.path,
          links: [ctx.link, sample.ctx.link],
        });
      }
    }
  }
  return out;
}

function entityLink(id: string, input: ConsistencyInput): string {
  const e = input.entities.find((x) => x.id === id);
  return `entity:${e?.id ?? id}`;
}

/* ─── 2. facts ───────────────────────────────────────────────────────── */

function factSuggestions(ctxs: ParaCtx[], nameOf: Map<string, string>): WritingSuggestion[] {
  const facts: Fact[] = [];
  for (const ctx of ctxs) {
    if (!ctx.mentions.length) continue;
    const text = maskNonProse(ctx.para.text);
    for (const s of sentences(text, ctx.para.start)) {
      const local = s.text;
      const vals = valuesOf(local, s.start);
      if (!vals.length) continue;
      const ments = ctx.mentions.filter((m) => m.start >= s.start && m.end <= s.end);
      if (!ments.length) continue;
      const skip: Array<[number, number]> = ments.map((m) => [m.start - m.prefix.length, m.end]);
      const measured = vals.some((v) => v.type === "number");
      const years = new Set(vals.filter((v) => v.type === "year").map((v) => v.value));
      vals.forEach((v, i) => {
        // A year next to a measured number qualifies it ("in 2010 the population was …"); it is not a fact of its own.
        if (v.type === "year" && measured) return;
        // A bare number ("on day 5", "chapter 3") names no quantity: never compared.
        if (v.type === "number" && v.unit === "") return;
        const before = ments.filter((m) => m.end <= v.start);
        const ent = (before.length ? before[before.length - 1] : ments[0]).entity;
        const frame = frameOf(local, s.start, vals, i, skip);
        for (const mo of ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"]) frame.delete(stem(mo));
        if (!frame.size) return;
        facts.push({ id: facts.length, ctx, entity: ent, value: v, frame, qualifiers: v.type === "number" ? years : new Set() });
      });
    }
  }
  // Candidate pairs: same entity, sharing a frame word (an inverted index, so 10k notes stay linear-ish).
  const byKey = new Map<string, Fact[]>();
  for (const f of facts) {
    const temporal = f.value.type !== "number";
    for (const w of f.frame) {
      const k = `${f.entity}\u0000${temporal ? "t" : `n:${f.value.unit}`}\u0000${w}`;
      (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(f);
    }
  }
  const seen = new Set<string>();
  const pairs: Array<{ a: Fact; b: Fact; sim: number }> = [];
  for (const list of byKey.values()) {
    if (list.length < 2 || list.length > 400) continue; // a frame word on 400 facts of one entity says nothing
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (a.ctx === b.ctx) continue;
        if (!disagree(a.value, b.value)) continue;
        if (a.qualifiers.size && b.qualifiers.size && overlap(a.qualifiers, b.qualifiers) === 0) continue;
        const sim = overlap(a.frame, b.frame) / Math.min(a.frame.size, b.frame.size);
        if (sim < 0.5) continue;
        pairs.push({ a, b, sim });
      }
    }
  }
  // How many facts back each value of a fact: the minority side is the one flagged.
  const disputes = new Map<number, number>();
  for (const p of pairs) for (const f of [p.a, p.b]) disputes.set(f.id, (disputes.get(f.id) ?? 0) + 1);
  const support = (f: Fact) => disputes.get(f.id) ?? 0;
  const best = new Map<number, { f: Fact; other: Fact; sim: number }>();
  for (const p of pairs) {
    const sa = support(p.a);
    const sb = support(p.b);
    const [f, other] = sa > sb ? [p.a, p.b] : sb > sa ? [p.b, p.a] : p.a.ctx.note.path <= p.b.ctx.note.path ? [p.b, p.a] : [p.a, p.b];
    const prev = best.get(f.id);
    if (!prev || p.sim > prev.sim) best.set(f.id, { f, other, sim: p.sim });
  }
  // One suggestion per disagreeing pair of paragraphs.
  const done = new Set<string>();
  const out: WritingSuggestion[] = [];
  for (const { f, other, sim } of best.values()) {
    const k = [f.ctx.link, other.ctx.link].sort().join("|") + f.entity;
    if (done.has(k)) continue;
    done.add(k);
    const t = msgs(f.ctx.hebrew);
    const a = showValue(f.value);
    const b = showValue(other.value);
    out.push({
      range: { from: f.value.start, to: f.value.end },
      kind: "fact-conflict",
      message: t.fact(a, b),
      rationale: t.factWhy(nameOf.get(f.entity) ?? f.entity, a, b, other.ctx.note.path),
      confidence: conf(0.5 + 0.4 * sim),
      replacement: null,
      agentId: AGENT_ID,
      model: RULES_MODEL,
      path: f.ctx.note.path,
      links: [f.ctx.link, other.ctx.link],
    });
  }
  return out;
}

/* ─── 3. terms ───────────────────────────────────────────────────────── */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A variant as a pattern: geresh and gershayim in any typing, an optional Hebrew prefix run, whole words only. */
function termPattern(v: string): RegExp {
  const body = escapeRe(v.normalize("NFC"))
    .replace(/(?:״|")/g, `(?:״|"|'')`)
    .replace(/(?:׳|')/g, `(?:׳|')`)
    .replace(/\s+/g, "[\\s־-]+");
  const hebrew = /^[א-ת]/.test(v);
  return new RegExp(`(?<![\\p{L}\\p{M}])(${hebrew ? "[ובהלמשכ]{0,3}[-־]?" : ""})(${body})(?![\\p{L}\\p{M}])`, hebrew ? "gu" : "giu");
}

function termSuggestions(ctx: ParaCtx, prose: string, glossary: readonly GlossaryTerm[]): WritingSuggestion[] {
  const out: WritingSuggestion[] = [];
  for (const term of glossary) {
    for (const v of term.variants) {
      for (const m of prose.matchAll(termPattern(v))) {
        const from = ctx.para.start + (m.index ?? 0) + m[1].length;
        const to = from + m[2].length;
        const t = msgs(ctx.hebrew);
        out.push({
          range: { from, to },
          kind: "term-variant",
          message: t.term(m[2], term.preferred),
          rationale: t.termWhy(m[2], term.preferred),
          confidence: conf(0.9),
          replacement: term.preferred,
          agentId: AGENT_ID,
          model: RULES_MODEL,
          path: ctx.note.path,
          links: [ctx.link, term.link ?? "glossary"],
        });
      }
    }
  }
  return out;
}
