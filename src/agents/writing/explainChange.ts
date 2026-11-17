/**
 * "Explain my change" (plan W13.W13): what changed between two versions of a
 * note and why it matters — without reading a diff.
 *
 *  1. The diff: word level, right for bidi text and Hebrew prefixes — the
 *     W13.R8 compare view's (reading/wordDiffBidi.ts; one word diff for
 *     reading and writing, INT7) — grouped into hunks with their offsets in
 *     both versions.
 *  2. Meaning changes, found by rules BEFORE any model: a number that
 *     changed, appeared or disappeared (digits, percentages, Hebrew and
 *     English number words); a negation added or removed (לא, אין, אינו,
 *     בלי, ללא, not, never, no, n't, without… — with Hebrew prefix letters:
 *     "ולא", "שאין"); a name, link or date that changed. These are never left
 *     to the model: 100% of number and negation changes are reported.
 *  3. A 3–5 line summary from a local model (`explainChangeAgent`, run by
 *     the caller through the agent runtime with an AbortSignal, no tools),
 *     then a grounding check: a line whose numbers or content words are not
 *     in what actually changed is dropped, so the summary never mentions a
 *     change that did not happen. Without a model, the summary is written
 *     from the hunks by rules.
 *
 * Pure (no I/O); the command (commands/domains/writingChecks.ts) picks the
 * older version from the note's history.
 */
import { wordDiff as bidiWordDiff } from "../../reading/wordDiffBidi";
import { normalizeForMatch, stripNiqqud } from "../../text/hebrew";
import { englishStem } from "./repetition";
import type { AgentDefinition, AgentInput } from "../types";
import { registerAgent } from "../registry";
import { fail, ok } from "../defs/shared";

export interface ChangeHunk {
  /** Offsets in the older and the newer version. */
  old: { from: number; to: number; text: string };
  new: { from: number; to: number; text: string };
  /** The newer sentence the hunk is in (the older one when it was deleted whole). */
  context: string;
  /** The older sentence it is in. */
  oldContext: string;
}

export type MeaningKind = "number" | "negation" | "entity";

export interface MeaningChange {
  kind: MeaningKind;
  /** What it was and what it is now ("" = absent). */
  before: string;
  after: string;
  hunk: number;
}

export interface ChangeExplanation {
  hunks: ChangeHunk[];
  meaning: MeaningChange[];
  /** 3–5 lines (fewer when little changed). */
  summary: string[];
  /** Lines of the model's summary dropped by the grounding check. */
  dropped: string[];
  engine: "model" | "rules";
  stats: { added: number; removed: number };
}

type Op = { type: "equal" | "insert" | "delete"; text: string; oldText?: string };

/** R8's word diff as equal / delete / insert runs: a prefix-only or niqqud-only change of a word is that word deleted and inserted. */
export function wordOps(older: string, newer: string): Op[] {
  const out: Op[] = [];
  for (const p of bidiWordDiff(older, newer)) {
    if (p.type === "prefix") out.push({ type: "delete", text: p.oldPrefix + p.oldStem }, { type: "insert", text: p.newPrefix + p.stem });
    else if (p.type === "niqqud") out.push({ type: "delete", text: p.oldText }, { type: "insert", text: p.text });
    else out.push(p);
  }
  return out;
}

/** Hunks of a word diff: runs of insertions / deletions, joined across a single space. */
export function changeHunks(older: string, newer: string): ChangeHunk[] {
  const ops = wordOps(older, newer);
  const hunks: ChangeHunk[] = [];
  let oi = 0;
  let ni = 0;
  let cur: ChangeHunk | null = null;
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    if (op.type === "equal") {
      // A lone space or punctuation mark between two changes keeps one hunk.
      const bridge = cur && /^[\s,;:]{1,2}$/.test(op.text) && ops[k + 1] && ops[k + 1].type !== "equal";
      if (bridge && cur) {
        cur.old.to += op.text.length;
        cur.new.to += op.text.length;
      } else if (cur) {
        hunks.push(cur);
        cur = null;
      }
      oi += (op.oldText ?? op.text).length;
      ni += op.text.length;
      continue;
    }
    cur ??= { old: { from: oi, to: oi, text: "" }, new: { from: ni, to: ni, text: "" }, context: "", oldContext: "" };
    if (op.type === "delete") {
      oi += op.text.length;
      cur.old.to = oi;
    } else {
      ni += op.text.length;
      cur.new.to = ni;
    }
  }
  if (cur) hunks.push(cur);
  for (const h of hunks) {
    // A number is one unit: "3.5" → "3.7" is that, not "5" → "7".
    [h.old.from, h.old.to] = numberBounds(older, h.old.from, h.old.to);
    [h.new.from, h.new.to] = numberBounds(newer, h.new.from, h.new.to);
    h.old.text = older.slice(h.old.from, h.old.to);
    h.new.text = newer.slice(h.new.from, h.new.to);
    h.oldContext = sentenceAround(older, h.old.from, h.old.to);
    h.context = h.new.text.trim() ? sentenceAround(newer, h.new.from, h.new.to) : h.oldContext;
  }
  return hunks.filter((h) => h.old.text.trim() || h.new.text.trim());
}

const NUMCH = /[\d.,%]/;
function numberBounds(text: string, from: number, to: number): [number, number] {
  const digitNear = (i: number) => /\d/.test(text[i] ?? "") || /\d/.test(text[i - 1] ?? "") || /\d/.test(text[i + 1] ?? "");
  while (from > 0 && NUMCH.test(text[from - 1]) && digitNear(from - 1) && (/\d/.test(text[from] ?? "") || /\d/.test(text[from - 1]))) from--;
  while (to < text.length && NUMCH.test(text[to]) && digitNear(to) && (/\d/.test(text[to - 1] ?? "") || /\d/.test(text[to]))) to++;
  // A trailing sentence period is not part of the number.
  while (to > from && /[.,]/.test(text[to - 1]) && !/\d/.test(text[to] ?? "")) to--;
  return [from, to];
}

function sentenceAround(text: string, from: number, to: number): string {
  const before = text.slice(0, from);
  // The sentence starts after the last line break or end mark + space before the change (or at the start).
  const s = Math.max(0, before.lastIndexOf("\n") + 1, ...[". ", "! ", "? "].map((m) => (before.lastIndexOf(m) < 0 ? 0 : before.lastIndexOf(m) + 2)));
  const after = text.slice(to).search(/[.!?](\s|$)|\n/);
  const e = after < 0 ? text.length : to + after + 1;
  return text.slice(Math.max(0, s), e).trim().slice(0, 300);
}

// ── Rules: numbers, negation, entities ──────────────────────────────────

const HE_NUM = "אפס אחד אחת שניים שתיים שני שתי שלושה שלוש שלושת ארבעה ארבע ארבעת חמישה חמש חמשת שישה שש ששת שבעה שבע שבעת שמונה שמונת תשעה תשע תשעת עשרה עשר עשרים שלושים ארבעים חמישים שישים שבעים שמונים תשעים מאה מאות מאתיים אלף אלפים אלפיים מיליון מיליארד חצי רבע שליש כפול פי".split(" ");
const EN_NUM = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion half quarter third double twice triple once".split(" ");
const NUM_WORDS = new Set([...HE_NUM, ...EN_NUM].map((w) => normalizeForMatch(w)));
const NEG = new Set(["לא", "אין", "אינו", "אינה", "אינם", "אינן", "אינני", "איננו", "אינך", "בלי", "ללא", "אל", "מעולמ", "אף", "שום", "not", "never", "no", "none", "nobody", "nothing", "neither", "nor", "without", "cannot", "nowhere"].map((w) => normalizeForMatch(w)));
const PREFIX = /^[והבלמשכ]{1,3}/;

const tokens = (s: string) => s.match(/[\p{L}\p{M}\p{N}]+(?:['’׳״"\-־.,][\p{L}\p{M}\p{N}]+)*%?/gu) ?? [];
const norm = (w: string) => normalizeForMatch(w).replace(/['"]/g, "");

function bare(w: string): string[] {
  const n = norm(w);
  const out = [n];
  const m = PREFIX.exec(n);
  if (m) for (let i = 1; i <= m[0].length && n.length - i >= 2; i++) out.push(n.slice(i));
  if (/^[a-z]+$/.test(n)) out.push(englishStem(n));
  return out;
}

/** The word as written without the prefix letters that `bare` took off (niqqud dropped). */
const asWritten = (t: string, b: string) => {
  const w = stripNiqqud(t);
  return w.length >= b.length ? w.slice(w.length - b.length) : b;
};

/** Numbers of a text: digits (1,000 · 3.5 · 40%) and number words, in order. */
export function numbersIn(s: string): string[] {
  const out: string[] = [];
  for (const t of tokens(s)) {
    if (/\p{N}/u.test(t)) out.push(t.replace(/^[והבלמשכ]+-?(?=\d)/, "").replace(/[,]/g, ""));
    else
      for (const part of t.split(/[-־]/)) {
        const b = bare(part).find((x) => NUM_WORDS.has(x));
        if (b) out.push(asWritten(part, b));
      }
  }
  return out;
}

/** Negation words of a text (comparison form, prefix letters off). */
export function negationsIn(s: string): string[] {
  const out: string[] = [];
  for (const t of tokens(s.replace(/n['’]t\b/gi, " not"))) {
    const b = bare(t).find((x) => NEG.has(x));
    if (b) out.push(asWritten(t, b));
  }
  return out;
}

/** Names, links and dates of a text: [[links]], @mentions, capitalised words inside a sentence, dates, Hebrew names after a title. */
export function entitiesIn(s: string, known: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/\[\[([^\]|#\n]+)/g)) out.push(m[1].trim());
  for (const m of s.matchAll(/@[\p{L}\p{N}_-]+/gu)) out.push(m[0]);
  for (const m of s.matchAll(/\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g)) out.push(m[0]);
  for (const m of s.matchAll(/\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)*/gu)) {
    // A capital at the start of a sentence says nothing; inside one it is a name.
    const before = s.slice(0, m.index).trimEnd();
    if (before && !/[.!?:\n]$/.test(before)) out.push(m[0]);
  }
  for (const m of s.matchAll(/(?:מר|גב['׳]|ד["״]ר|פרופ['׳]|עו["״]ד|הרב|השר|השרה|ח["״]כ)\s+([א-ת][א-ת'׳-]+(?:\s+[א-ת][א-ת'׳-]+)?)/g)) out.push(m[1]);
  const lower = norm(s);
  for (const k of known) if (k.length >= 2 && lower.includes(norm(k))) out.push(k);
  return out;
}

/** Audit r4 A2.8: the value of a simple number word, so "3" → "three" is the same number (not a change). */
const WORD_VALUE: Record<string, number> = Object.fromEntries(
  [
    ...["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"].map((w, i) => [w, i] as const),
    ...["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"].map((w, i) => [w, (i + 2) * 10] as const),
    ["hundred", 100], ["thousand", 1000], ["million", 1e6], ["billion", 1e9], ["half", 0.5], ["quarter", 0.25], ["twice", 2], ["once", 1], ["double", 2], ["triple", 3],
    ["אפס", 0], ["אחד", 1], ["אחת", 1], ["שניים", 2], ["שתיים", 2], ["שני", 2], ["שתי", 2], ["שלושה", 3], ["שלוש", 3], ["שלושת", 3], ["ארבעה", 4], ["ארבע", 4], ["ארבעת", 4],
    ["חמישה", 5], ["חמש", 5], ["חמשת", 5], ["שישה", 6], ["שש", 6], ["ששת", 6], ["שבעה", 7], ["שבע", 7], ["שבעת", 7], ["שמונה", 8], ["שמונת", 8], ["תשעה", 9], ["תשע", 9], ["תשעת", 9],
    ["עשרה", 10], ["עשר", 10], ["עשרים", 20], ["שלושים", 30], ["ארבעים", 40], ["חמישים", 50], ["שישים", 60], ["שבעים", 70], ["שמונים", 80], ["תשעים", 90], ["מאה", 100], ["מאתיים", 200], ["אלף", 1000], ["אלפיים", 2000], ["מיליון", 1e6], ["מיליארד", 1e9], ["חצי", 0.5], ["רבע", 0.25],
  ].map(([w, v]) => [normalizeForMatch(String(w)), Number(v)]),
);
/** A number's comparison key: its value for digits and simple number words ("3", "three", "שלושה" → "3"), else the text. */
export function numberKey(n: string): string {
  const d = /^-?\d+(?:\.\d+)?%?$/.test(n) ? n : null;
  if (d) return d.endsWith("%") ? d : String(Number(d));
  const b = bare(n).find((x) => x in WORD_VALUE);
  return b !== undefined ? String(WORD_VALUE[b]) : n;
}

const diffMulti = (a: string[], b: string[], key: (x: string) => string = (x) => x): { gone: string[]; added: string[] } => {
  const left = [...b];
  const gone: string[] = [];
  for (const x of a) {
    const i = left.findIndex((y) => key(y) === key(x));
    if (i >= 0) left.splice(i, 1);
    else gone.push(x);
  }
  return { gone, added: left };
};

/** Meaning changes of the hunks, by rule. `known`: entity names the vault knows (W12.E3), optional. */
export function meaningChanges(hunks: readonly ChangeHunk[], known: readonly string[] = []): MeaningChange[] {
  const out: MeaningChange[] = [];
  hunks.forEach((h, i) => {
    // Numbers and negations are read on the whole words around the change, so "15" → "150" (a changed token) and "יבוא" → "לא יבוא" are both seen.
    const n = diffMulti(numbersIn(h.old.text), numbersIn(h.new.text), numberKey);
    for (let k = 0; k < Math.max(n.gone.length, n.added.length); k++) out.push({ kind: "number", before: n.gone[k] ?? "", after: n.added[k] ?? "", hunk: i });
    const g = diffMulti(negationsIn(h.old.text), negationsIn(h.new.text));
    for (const x of g.gone) out.push({ kind: "negation", before: x, after: "", hunk: i });
    for (const x of g.added) out.push({ kind: "negation", before: "", after: x, hunk: i });
    // Names are read on the whole sentences: a capital is a name only inside one.
    const e = diffMulti(entitiesIn(h.oldContext, known), entitiesIn(h.context, known));
    for (let k = 0; k < Math.max(e.gone.length, e.added.length); k++) out.push({ kind: "entity", before: e.gone[k] ?? "", after: e.added[k] ?? "", hunk: i });
  });
  // Two hunks in one sentence see the same names: one report per change.
  const seen = new Set<string>();
  return out.filter((m) => {
    const k = `${m.kind}|${m.before}|${m.after}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ── Grounding: a summary line must be about something that changed ──────

const STOP = new Set(
  "the a an of to in and or is are was were be been it its that this for on with as by at from which now changed change changes changing text note version sentence paragraph word words removed added replaced instead into longer shorter new old previously before after than also has have had was".split(" ")
    .concat("של את על עם זה זו זאת הוא היא הם הן מה מי כי גם או אם אך אבל כל יש עוד כמו בין שינוי שונה השתנה הוחלף הוסף נוסף נמחק הוסר במקום עכשיו כעת קודם לפני אחרי הטקסט הפתק המשפט הגרסה מילה מילים".split(" "))
    .map((w) => normalizeForMatch(w)),
);

/** Does a summary line speak only of what changed? Numbers must be changed numbers; most content words must come from the changed text. */
export function lineGrounded(line: string, hunks: readonly ChangeHunk[]): boolean {
  const changed = hunks.map((h) => `${h.old.text} ${h.new.text}`).join(" ");
  const around = hunks.map((h) => `${h.oldContext} ${h.context}`).join(" ");
  const changedNums = new Set(numbersIn(changed));
  const aroundNums = new Set(numbersIn(around));
  const lineNums = numbersIn(line);
  // A number in the line is a changed one, or one the sentence around the change already had ("million").
  for (const n of lineNums) if (!changedNums.has(n) && !aroundNums.has(n)) return false;
  // A line that states changed numbers is about the change.
  if (lineNums.some((n) => changedNums.has(n))) return true;
  const negChanged = hunks.some((h) => negationsIn(h.old.text).join() !== negationsIn(h.new.text).join());
  const pool = new Set(tokens(`${changed} ${around}`).flatMap(bare));
  const content = tokens(line).filter((t) => !/\p{N}/u.test(t)).map(norm).filter((w) => w.length > 2 && !STOP.has(w) && !bare(w).some((b) => STOP.has(b) || NEG.has(b)));
  if (!content.length) return true;
  const hit = content.filter((w) => bare(w).some((b) => pool.has(b))).length;
  // Something of the line must touch the changed words themselves, not just the sentence around them.
  const changedPool = new Set(tokens(changed).flatMap(bare));
  const touches = content.some((w) => bare(w).some((b) => changedPool.has(b))) || (negChanged && negationsIn(line).length > 0);
  return touches && hit / content.length >= 0.6;
}

// ── The rules-only summary and the model's ──────────────────────────────

const clip = (s: string, n = 60) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export function rulesSummary(hunks: readonly ChangeHunk[], meaning: readonly MeaningChange[], lang: "he" | "en"): string[] {
  const he = lang === "he";
  const lines: string[] = [];
  for (const m of meaning) {
    if (lines.length >= 5) break;
    if (m.kind === "number") lines.push(he ? (m.before && m.after ? `המספר ${m.before} שונה ל-${m.after}.` : m.after ? `נוסף המספר ${m.after}.` : `הוסר המספר ${m.before}.`) : m.before && m.after ? `The number ${m.before} became ${m.after}.` : m.after ? `The number ${m.after} was added.` : `The number ${m.before} was removed.`);
    else if (m.kind === "negation") lines.push(he ? (m.after ? `נוספה שלילה (״${m.after}״): ״${clip(hunks[m.hunk].context)}״.` : `הוסרה שלילה (״${m.before}״): ״${clip(hunks[m.hunk].context)}״.`) : m.after ? `A negation was added ("${m.after}"): "${clip(hunks[m.hunk].context)}".` : `A negation was removed ("${m.before}"): "${clip(hunks[m.hunk].context)}".`);
    else lines.push(he ? (m.before && m.after ? `${m.before} הוחלף ב-${m.after}.` : m.after ? `נוסף: ${m.after}.` : `הוסר: ${m.before}.`) : m.before && m.after ? `${m.before} was replaced by ${m.after}.` : m.after ? `Added: ${m.after}.` : `Removed: ${m.before}.`);
  }
  const used = new Set(meaning.map((m) => m.hunk));
  for (let i = 0; i < hunks.length && lines.length < 5; i++) {
    if (used.has(i)) continue;
    const h = hunks[i];
    const o = clip(h.old.text, 50);
    const n = clip(h.new.text, 50);
    lines.push(he ? (o && n ? `״${o}״ ← ״${n}״.` : n ? `נוסף: ״${n}״.` : `נמחק: ״${o}״.`) : o && n ? `"${o}" → "${n}".` : n ? `Added: "${n}".` : `Deleted: "${o}".`);
  }
  if (hunks.length > lines.length && lines.length === 5) lines[4] = he ? `ועוד ${hunks.length - 4} שינויים.` : `And ${hunks.length - 4} more changes.`;
  return lines;
}

export interface ExplainChangeInput extends AgentInput {
  text: string;
  extra: { lang: "he" | "en"; meaning: string };
}

/** The prompt's view of the change: numbered hunks, before → after, with the sentence. */
export function hunksForPrompt(hunks: readonly ChangeHunk[], max = 40): string {
  return hunks
    .slice(0, max)
    .map((h, i) => `${i + 1}. BEFORE: «${clip(h.old.text, 300)}»\n   AFTER: «${clip(h.new.text, 300)}»\n   SENTENCE NOW: «${clip(h.context, 300)}»`)
    .join("\n");
}

export const explainChangeAgent: AgentDefinition<ExplainChangeInput, string> = registerAgent<ExplainChangeInput, string>({
  id: "explainChange",
  commandId: "writing.explainChange",
  description: "Explain what changed between two versions of a note (grounded, on this device)",
  system: (input) =>
    `You explain an edit to a writer, in ${input.extra.lang === "he" ? "Hebrew" : "English"}. Write 3 to 5 short lines, one per line, no bullets: what changed and why it matters for the meaning. ` +
    "Speak ONLY of the changes listed. Never mention a change that is not in the list. Quote numbers exactly as they appear in the change. " +
    `These meaning changes were found by rules and MUST be mentioned: ${input.extra.meaning || "none"}.`,
  user: (input) => input.text,
  validators: [
    {
      name: "lines",
      check: (out) => {
        const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
        return lines.length >= 1 && lines.length <= 7 ? ok : fail(`${lines.length} lines`, "Write 3 to 5 short lines.");
      },
    },
  ],
  // Local models only: a note's edits never go to a cloud provider; and no tools.
  executorPreference: ["ollama", "webllm"],
  loopbackOnly: true,
  language: "any",
  maxRetries: 1,
  tier: "small",
  temperature: 0,
  maxTokens: 400,
});

/** Run the explanation. `model` (optional) gets the prompt input and returns the model's text; it is the caller's runAgent with its AbortSignal. */
export async function explainChange(
  older: string,
  newer: string,
  opts: { lang: "he" | "en"; known?: readonly string[]; model?: (input: ExplainChangeInput) => Promise<string>; signal?: AbortSignal },
): Promise<ChangeExplanation> {
  const hunks = changeHunks(older, newer);
  const meaning = meaningChanges(hunks, opts.known);
  const stats = { added: hunks.reduce((a, h) => a + tokens(h.new.text).length, 0), removed: hunks.reduce((a, h) => a + tokens(h.old.text).length, 0) };
  const base = { hunks, meaning, stats };
  if (!hunks.length) return { ...base, summary: [], dropped: [], engine: "rules" };
  const rules = rulesSummary(hunks, meaning, opts.lang);
  if (!opts.model) return { ...base, summary: rules, dropped: [], engine: "rules" };
  opts.signal?.throwIfAborted();
  const meaningText = meaning.map((m) => `${m.kind}: «${m.before}» → «${m.after}»`).join("; ");
  const text = await opts.model({ text: hunksForPrompt(hunks), extra: { lang: opts.lang, meaning: meaningText } });
  const lines = text.split("\n").map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean);
  const kept = lines.filter((l) => lineGrounded(l, hunks)).slice(0, 5);
  const dropped = lines.filter((l) => !kept.includes(l));
  // Every rule-found meaning change is in the summary: a missed one is added from the rules.
  const summary = [...kept];
  meaning.forEach((m, i) => {
    const said = summary.some((l) => (m.after && norm(l).includes(norm(m.after))) || (m.before && norm(l).includes(norm(m.before))));
    if (!said && summary.length < 5 + meaning.length) summary.push(rules[i] ?? rulesSummary(hunks, [m], opts.lang)[0]);
  });
  if (!summary.length) return { ...base, summary: rules, dropped, engine: "rules" };
  return { ...base, summary, dropped, engine: "model" };
}
