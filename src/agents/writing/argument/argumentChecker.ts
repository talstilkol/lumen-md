/**
 * W13.W8 — the argument and logic checker: claims without support, logical
 * leaps and common fallacies, linked to the argument map.
 *
 * 1. **Unsupported claims.** The sentences claim extraction (R12.11,
 *    `selectCheckable`) would keep — not questions, not hedged opinions —
 *    and that assert something a reader would want backed (a number, a
 *    cause, a comparison, "studies show", a sweeping word) are checked for
 *    support: a citation in the sentence or the one next to it
 *    (`[@key]`, `[^1]`, `[[note]]`, a link, "(Author, 2020)", "לפי…" /
 *    "according to…"), or a source note in the vault whose text supports it
 *    (the citation gate's `supportOf`, R12.9). A claim backed by a vault
 *    source that the note does not cite gets that source named.
 * 2. **Logical leaps.** A "therefore" sentence ("לכן", "מכאן ש", "thus")
 *    that shares no content word with the two sentences before it.
 * 3. **Fallacies** (./fallacies): hasty generalization, straw man, slippery
 *    slope, ad hominem, false dilemma, appeal to popularity, post hoc.
 * 4. **The argument map** (W12.V4): when the note is a claim node that no
 *    source reaches, that is said too; `mapFindings` gives the map the
 *    findings per node, for its badges.
 *
 * Every suggestion explains why (the rule, what it saw, an example and how
 * to fix it). All are comments: replacement null.
 */
import { selectCheckable } from "../../defs/claimExtractor";
import { DEFAULT_MIN_SUPPORT, contentWords, supportOf } from "../../cite/gate";
import { argumentGraph, unsupportedClaims, type ArgNoteInput } from "../../../argument/argumentMap";
import { noteParagraphs } from "../../../ai/paragraphAnchors";
import { RULES_MODEL, conf, type WritingSuggestion } from "../suggestionShape";
import { isHebrewText, sentences, throwIfAborted } from "../textTools";
import { BENIGN, FALLACIES } from "./fallacies";

export const AGENT_ID = "argumentChecker";

export interface SourceNote {
  path: string;
  text: string;
}

export interface ArgumentInput {
  text: string;
  path?: string;
  /** Source notes of the vault (type: source / evidence, or any the caller picks). */
  sources?: readonly SourceNote[];
  /** The vault's notes for the argument map (W12.V4). */
  mapNotes?: readonly ArgNoteInput[];
}

const CITATION = /\[@[\w:.-]+|\[\^[^\]]+\]|\[\[[^\]]+\]\]|\]\([^)]+\)|https?:\/\/|\(\s*[\p{L}][\p{L} .&-]{1,60},?\s+(?:\d{4}|ת[שר]["״]?\p{L})\s*\)|(?:^|[\s(])(?:לפי|על פי|על-פי|כפי שמראה|כפי שכתב|כפי שמצא|בדוח של|במחקר של|מחקר של|נתוני|according to|as reported by|a study by|data from|cited in|source:|מקור:)\s/iu;
const CLAIMY = new RegExp(
  [
    "\\d|%",
    // Words that must stand alone.
    "(?:^|[\\s(])(?:גורם|גורמת|גורמים|בגלל|עקב|הוכח|מוכח|מחקרים מראים|מחקרים הוכיחו|ידוע ש|הכי|ביותר|תמיד|אף פעם|לעולם|אחוז|אחוזים|בממוצע|הגורם העיקרי|causes?|because of|due to|proven|studies show|research shows|it is known|most|best|worst|all|always|never|every|percent|on average|the main cause|tripled|doubled|halved)(?=$|[\\s,.!?;:])",
    // Words a preposition or the article joins in Hebrew ("מובילה לירידה", "יותר מחצי", "כל התלמידים", "פי שלושה").
    "(?:^|[\\s(])(?:מוביל|מובילה|מובילים|מובילות)\\s+ל|(?:^|[\\s(])(?:יותר|פחות)\\s+מ|(?:^|[\\s(])כל ה|(?:^|[\\s(])פי\\s+\\S|(?:^|[\\s(])(?:leads?|led) to|(?:^|[\\s(])(?:more|less|fewer) than",
  ].join("|"),
  "iu",
);
const THEREFORE = /^\s*(?:לכן|ולכן|מכאן ש|מכאן|על כן|אשר על כן|לפיכך|משום כך|כתוצאה מכך|therefore|thus|hence|consequently|so it follows|it follows that|as a result)[,\s]/iu;
const QUOTED = /^\s*[>"“„«]/;

const MSG = {
  he: {
    unsupported: () => `טענה בלי מקור`,
    unsupportedWhy: (cue: string) =>
      `המשפט קובע עובדה (${cue}) ואין לידו מקור: לא ציטוט, לא קישור לפתק ולא ״לפי…״. קורא לא יכול לבדוק אותו. כדאי להוסיף מקור, או לכתוב אותו כדעה (״לדעתי…״).`,
    vaultHas: (p: string) => ` בכספת יש מקור שתומך בו: [[${p.replace(/\.md$/i, "")}]] — אפשר לצטט אותו.`,
    leap: () => `קפיצה לוגית`,
    leapWhy: (w: string) => `המשפט נפתח ב״${w}״ כאילו הוא נובע ממה שנאמר קודם, אבל אין לו אף מילת תוכן משותפת עם שני המשפטים שלפניו. כדאי להראות את הצעד שמחבר ביניהם.`,
    fallacyWhy: (name: string, why: string, seen: string, ex: string, fix: string) => `${name}: ${why} כאן: ״${seen}״. דוגמה: ${ex} איך לתקן: ${fix}`,
    map: () => `במפת הטיעונים: טענה שאף מקור לא תומך בה`,
    mapWhy: () => `הפתק הזה הוא טענה במפת הטיעונים, ואף מקור לא מגיע אליו דרך ״תומך״ או ״מסייג״ (ישירות או דרך טענה אחרת). כדאי לקשר אליו מקור, או לסמן אותו כהשערה.`,
  },
  en: {
    unsupported: () => `Claim without a source`,
    unsupportedWhy: (cue: string) =>
      `The sentence states a fact (${cue}) with no source next to it: no citation, no link to a note, no "according to". A reader cannot check it. Add a source, or write it as an opinion ("I think…").`,
    vaultHas: (p: string) => ` The vault has a source that supports it: [[${p.replace(/\.md$/i, "")}]] — you can cite it.`,
    leap: () => `Logical leap`,
    leapWhy: (w: string) => `The sentence opens on "${w}" as if it followed from what came before, but it shares no content word with the two sentences before it. Show the step that connects them.`,
    fallacyWhy: (name: string, why: string, seen: string, ex: string, fix: string) => `${name}: ${why} Here: "${seen}". Example: ${ex} How to fix it: ${fix}`,
    map: () => `Argument map: a claim no source supports`,
    mapWhy: () => `This note is a claim in the argument map, and no source reaches it through "supports" or "qualifies" (directly or through another claim). Link a source to it, or mark it as a hypothesis.`,
  },
};

const HEDGED = /(?:^|[\s"(])(?:אני חושב|אני חושבת|לדעתי|נראה לי|אולי|כנראה|ייתכן|I think|I believe|in my (?:view|opinion)|maybe|perhaps|probably|might|it seems)(?=$|[\s,.!?"])/iu;

interface Sent {
  text: string;
  start: number;
  end: number;
  para: number;
}

function sentencesOf(text: string): Sent[] {
  const out: Sent[] = [];
  noteParagraphs(text).forEach((p, i) => {
    if (/^\s*(?:#{1,6}\s|```|~~~|\|)/.test(p.text)) return;
    for (const s of sentences(p.text.replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, (m) => " ".repeat(m.length)), p.start)) out.push({ ...s, para: i });
  });
  return out;
}

const shared = (a: string, b: string) => {
  const A = new Set(contentWords(a));
  return contentWords(b).some((w) => A.has(w) || A.has(w.replace(/^[ובהלמשכ]/, "")) || A.has(`ה${w}`));
};

export function checkArgument(input: ArgumentInput, opts: { signal?: AbortSignal } = {}): WritingSuggestion[] {
  const out: WritingSuggestion[] = [];
  const ss = sentencesOf(input.text);
  const lang = isHebrewText(input.text) ? "he" : "en";
  const t = MSG[lang];
  const mk = (s: Sent, kind: string, message: string, rationale: string, c: number): WritingSuggestion => ({
    range: { from: s.start, to: s.end },
    kind,
    message,
    rationale,
    confidence: conf(c),
    replacement: null,
    agentId: AGENT_ID,
    model: RULES_MODEL,
    ...(input.path ? { path: input.path } : {}),
  });

  ss.forEach((s, i) => {
    throwIfAborted(opts.signal);
    if (QUOTED.test(s.text) || /[?؟]\s*$/.test(s.text)) return;
    const hedge = HEDGED.exec(s.text);
    const hedged = !!hedge;
    // Fallacies: an assertive sentence that is not a benign idiom. A hedge before the cue ("I think all…") makes it an
    // opinion; one inside the cue's conclusion ("so probably he brings luck") does not.
    let fallacy = false;
    if (!BENIGN.test(s.text)) {
      for (const f of FALLACIES) {
        const m = f.patterns.map((p) => p.exec(s.text)).find(Boolean);
        if (!m || (hedge && (hedge.index ?? 0) < (m.index ?? 0))) continue;
        const L = f[lang];
        out.push(mk(s, f.kind, L.name, t.fallacyWhy(L.name, L.why, m[0].trim(), L.example, L.fix), f.confidence));
        fallacy = true;
        break;
      }
    }
    // A leap: "therefore" with nothing in common with the two sentences before.
    const th = THEREFORE.exec(s.text);
    const prev = ss.slice(Math.max(0, i - 2), i).filter((p) => p.para >= s.para - 1);
    if (th && !fallacy && prev.length && !prev.some((p) => shared(p.text, s.text.slice(th[0].length)))) {
      out.push(mk(s, "logical-leap", t.leap(), t.leapWhy(th[0].replace(/[,\s]+$/, "").trim()), 0.6));
      return;
    }
    if (fallacy || hedged) return;
    // An unsupported claim: checkable (R12.11 stage 1), claim-like, no citation here or next door.
    const sel = selectCheckable(s.text);
    if (!sel.length || !sel.every((x) => x.checkable)) return;
    const cue = CLAIMY.exec(s.text.replace(new RegExp(BENIGN.source, "giu"), (x) => " ".repeat(x.length)));
    if (!cue) return;
    const near = ss.filter((p) => p.para === s.para && Math.abs(ss.indexOf(p) - i) <= 1);
    if (near.some((p) => CITATION.test(p.text))) return;
    let backed: SourceNote | null = null;
    for (const src of input.sources ?? []) {
      if (src.path === input.path) continue;
      const sup = supportOf(s.text, src.text);
      if (!sup.reject && sup.score >= DEFAULT_MIN_SUPPORT) {
        backed = src;
        break;
      }
    }
    out.push(mk(s, "unsupported-claim", t.unsupported(), t.unsupportedWhy(cue[0].trim()) + (backed ? t.vaultHas(backed.path) : ""), backed ? 0.6 : 0.7));
  });

  // The argument map: this note as a claim no source reaches.
  if (input.path && input.mapNotes?.length) {
    const g = argumentGraph(input.mapNotes);
    if (unsupportedClaims(g).has(input.path)) {
      const end = input.text.indexOf("\n") >= 0 ? input.text.indexOf("\n") : input.text.length;
      out.push({ range: { from: 0, to: Math.max(1, end) }, kind: "map-unsupported", message: t.map(), rationale: t.mapWhy(), confidence: conf(0.9), replacement: null, agentId: AGENT_ID, model: RULES_MODEL, path: input.path });
    }
  }
  return out.sort((a, b) => a.range.from - b.range.from);
}

/** Findings per argument-map node (note path), for the map's badges. */
export function mapFindings(notes: ReadonlyArray<{ path: string; text: string }>, mapNotes: readonly ArgNoteInput[], sources: readonly SourceNote[] = []): Map<string, { count: number; kinds: string[] }> {
  const g = argumentGraph(mapNotes);
  const out = new Map<string, { count: number; kinds: string[] }>();
  for (const n of g.nodes) {
    if (n.kind === "source") continue;
    const note = notes.find((x) => x.path === n.id);
    if (!note) continue;
    const f = checkArgument({ text: note.text, path: note.path, sources, mapNotes });
    if (f.length) out.set(n.id, { count: f.length, kinds: [...new Set(f.map((x) => x.kind))] });
  }
  return out;
}
