/**
 * W13.W7 — the structure critic: heading hierarchy, opening and closing,
 * paragraph length and topic sentences. Grammarly's Proofreader talks about
 * "structure and flow"; our outliner builds structure, this one reviews it.
 *
 * Every finding is a comment (replacement null): the critic never rewrites.
 * Rules run on the outline's own line classification (text/outline.ts
 * `analyse`, what outlineExtension folds and moves by), so code fences,
 * front matter and lists are never mistaken for headings or paragraphs.
 *
 *   heading-skip       a heading deeper than its parent + 1 (H2 → H4)
 *   lone-subheading    a section with exactly one subsection
 *   duplicate-heading  two sibling headings with the same title
 *   empty-section      a heading with nothing under it
 *   no-intro           a section that opens straight into its subsections
 *   no-conclusion      a long document whose last section closes nothing
 *   long-paragraph     a paragraph over 200 words
 *   topic-sentence     a long paragraph without a sentence that says what it is about
 *
 * The topic-sentence question goes to a small local model when one is given
 * (`judge`, called through the agent runtime with the caller's AbortSignal);
 * without one, a conservative rule asks only the clear cases (a paragraph
 * that opens on a connective or a question, or whose first sentence shares
 * no content word with the rest).
 */
import { analyse } from "../../../text/outline";
import { RULES_MODEL, conf, type WritingSuggestion } from "../suggestionShape";
import { STOP, isHebrewText, plain, sentences, stem, throwIfAborted, wordCount, words } from "../textTools";

export const AGENT_ID = "structureCritic";
export const LONG_PARAGRAPH_WORDS = 200;
/**
 * A Hebrew text says the same in about three quarters of the English words
 * (prefixes and suffixes are part of the word), so the length thresholds
 * that are about "a long text" scale with it. The 200-word paragraph rule is
 * the plan's number and stays the same in both.
 */
export const CONCLUSION_MIN_WORDS = { he: 450, en: 600 } as const;
export const TOPIC_MIN_WORDS = { he: 40, en: 55 } as const;

export interface Heading {
  level: number;
  title: string;
  line: number;
  from: number;
  to: number;
}

export interface Para {
  line: number;
  from: number;
  to: number;
  text: string;
  /** The heading it is under (index in headings), -1 before the first. */
  section: number;
}

/** A small model's answer: does the paragraph have a topic sentence? null = no answer (fall back to the rule). */
export type TopicJudge = (paragraph: string, opts: { signal?: AbortSignal; lang: "he" | "en" }) => Promise<boolean | null>;

export interface StructureOptions {
  judge?: TopicJudge;
  /** The model behind `judge`, for the suggestion's `model`. */
  judgeModel?: string;
  signal?: AbortSignal;
  /** Which rules to run (default all). */
  rules?: readonly string[];
}

export interface Outline {
  headings: Heading[];
  paragraphs: Para[];
  words: number;
}

/** The heading tree and the paragraphs of a note. */
export function outlineOf(text: string): Outline {
  const lines = text.split("\n");
  const info = analyse(lines);
  const starts: number[] = [];
  let off = 0;
  for (const l of lines) {
    starts.push(off);
    off += l.length + 1;
  }
  const headings: Heading[] = [];
  const paragraphs: Para[] = [];
  let cur: Para | null = null;
  const close = () => {
    if (cur && cur.text.trim()) paragraphs.push(cur);
    cur = null;
  };
  lines.forEach((line, i) => {
    const k = info[i].kind;
    if (k === "heading") {
      close();
      const m = /^ {0,3}(#{1,6})[ \t]*(.*?)[ \t#]*$/.exec(line)!;
      headings.push({ level: m[1].length, title: m[2].trim(), line: i, from: starts[i], to: starts[i] + line.length });
      return;
    }
    // A paragraph is a run of text lines; a block quote, a table or an own-line block id is not prose.
    if (k === "text" && !/^\s*(?:>|\||\^[\w-]+\s*$|<)/.test(line)) {
      const clean = line.replace(/\s\^[\w-]+\s*$/, "");
      if (!cur) cur = { line: i, from: starts[i], to: starts[i] + clean.length, text: clean, section: headings.length - 1 };
      else {
        cur.text += `\n${clean}`;
        cur.to = starts[i] + clean.length;
      }
      return;
    }
    close();
  });
  close();
  const prose = paragraphs.map((p) => p.text).join("\n");
  return { headings, paragraphs, words: wordCount(prose) };
}

const CONCLUSION_TITLE = /(?:סיכום|לסיכום|מסקנ|סוף דבר|דברי סיכום|אחרית דבר|שורה תחתונה|conclusion|summary|wrap[- ]?up|takeaways|tl;?dr|closing|final thoughts|in short|epilogue|outlook)/i;
const CONCLUSION_OPENER = /^\s*(?:לסיכום|לסיום|בסופו של דבר|מכאן ש|בשורה התחתונה|in conclusion|to sum up|to conclude|overall|in summary|in short|all in all|ultimately)/i;
const CONNECTIVE_OPENER = /^\s*(?:בנוסף|כמו כן|יתר על כן|זאת ועוד|גם|לעומת זאת|אבל|אך|עם זאת|מנגד|ואז|אחר כך|לבסוף|למשל|לדוגמה|כך ש|also|additionally|in addition|moreover|furthermore|however|but|and|then|for example|for instance|besides|meanwhile|on the other hand|similarly|likewise)(?=[,\s])[,\s]*/iu;
/** Headings that are not sections of an argument (a reference list, notes, a table of contents). */
const BACKMATTER = /^(?:מקורות|ביבליוגרפיה|הערות|נספח|נספחים|קישורים|ראו גם|תוכן עניינים|references|bibliography|sources|notes|appendix|see also|links|further reading|contents|toc|footnotes)(?![\p{L}])/iu;

const MSG = {
  he: {
    skip: (a: number, b: number) => `קפיצה מכותרת רמה ${a} לרמה ${b}`,
    skipWhy: (a: number, b: number) => `כותרת ברמה ${b} באה ישר אחרי רמה ${a}, ורמה ${a + 1} חסרה. קורא מסך ותוכן העניינים מציגים את העץ לפי הרמות, ורמה חסרה נראית כמו פרק שנעלם. כדאי להוריד את הכותרת לרמה ${a + 1} או להוסיף כותרת ביניים.`,
    lone: (t: string) => `לפרק ״${t}״ יש תת־פרק אחד בלבד`,
    loneWhy: (t: string, c: string) => `תת־פרק יחיד (״${c}״) לא מחלק את ״${t}״ לשום דבר: או שיש לפחות שני תת־פרקים, או שהתוכן שלו שייך לפרק עצמו בלי כותרת נוספת.`,
    dup: (t: string) => `שתי כותרות אחיות בשם ״${t}״`,
    dupWhy: (t: string) => `שני פרקים באותה רמה נקראים ״${t}״. קשה להבחין ביניהם בתוכן העניינים ובקישורים לכותרת; כדאי לתת לכל אחד שם שאומר במה הוא שונה.`,
    empty: (t: string) => `הפרק ״${t}״ ריק`,
    emptyWhy: (t: string) => `אחרי הכותרת ״${t}״ אין טקסט ואין תת־פרקים. אם זה מקום שמור לכתיבה, אפשר להשאיר; אחרת כדאי למחוק את הכותרת או לכתוב תחתיה.`,
    intro: (t: string) => `״${t}״ נפתח ישר בתת־פרקים`,
    introWhy: (t: string) => `בין הכותרת ״${t}״ לתת־הפרק הראשון אין אף משפט. משפט או שניים שאומרים מה יבוא עוזרים לקורא לדעת למה לצפות.`,
    docIntro: () => `המסמך נפתח בלי פסקת פתיחה`,
    docIntroWhy: () => `לפני הפרק הראשון אין פסקה שאומרת על מה המסמך ומה יש בו. פתיחה קצרה עוזרת לקורא להחליט מה לקרוא.`,
    concl: () => `אין סיכום בסוף`,
    conclWhy: (n: number) => `מסמך של ${n} מילים עם כמה פרקים נגמר בלי פרק או פסקה מסכמים. סיכום של שלוש־ארבע שורות אומר לקורא מה לקחת איתו.`,
    long: (n: number) => `פסקה של ${n} מילים`,
    longWhy: (n: number) => `הפסקה ארוכה מ-${LONG_PARAGRAPH_WORDS} מילים (${n}). פסקה ארוכה מסתירה את המבנה; כדאי לחלק אותה במקום שבו הרעיון מתחלף.`,
    topic: () => `לפסקה אין משפט נושא`,
    topicWhyModel: () => `המודל המקומי לא מצא משפט שאומר על מה הפסקה. משפט נושא בתחילתה מאפשר לקורא לרפרף ולהבין את המבנה.`,
    topicWhyRule: (why: string) => `${why} משפט נושא בתחילת הפסקה אומר לקורא על מה היא, לפני הפרטים.`,
    opensConnective: (w: string) => `הפסקה נפתחת ב״${w}״ — מילת קישור שממשיכה רעיון קודם, לא מציגה רעיון חדש.`,
    opensQuestion: () => `הפסקה נפתחת בשאלה, והתשובה לא מנוסחת כמשפט נושא.`,
    noOverlap: () => `המשפט הראשון לא חולק אף מילת תוכן עם שאר הפסקה.`,
  },
  en: {
    skip: (a: number, b: number) => `Heading level jumps from ${a} to ${b}`,
    skipWhy: (a: number, b: number) => `A level-${b} heading comes straight after level ${a}; level ${a + 1} is missing. Screen readers and the table of contents show the tree by level, so a missing level looks like a lost section. Make it level ${a + 1}, or add the heading in between.`,
    lone: (t: string) => `"${t}" has a single subsection`,
    loneWhy: (t: string, c: string) => `One subsection ("${c}") divides "${t}" into nothing: either there are at least two, or its text belongs to the section itself without another heading.`,
    dup: (t: string) => `Two sibling headings named "${t}"`,
    dupWhy: (t: string) => `Two sections at the same level are both called "${t}". They are hard to tell apart in the outline and in heading links; give each a name that says how it differs.`,
    empty: (t: string) => `Section "${t}" is empty`,
    emptyWhy: (t: string) => `There is no text and no subsection under "${t}". If it is a placeholder, keep it; otherwise write under it or remove it.`,
    intro: (t: string) => `"${t}" opens straight into its subsections`,
    introWhy: (t: string) => `There is no sentence between "${t}" and its first subsection. A line or two on what follows tells the reader what to expect.`,
    docIntro: () => `The document has no opening paragraph`,
    docIntroWhy: () => `Before the first section there is no paragraph saying what the document is about and what is in it. A short opening helps the reader decide what to read.`,
    concl: () => `No conclusion at the end`,
    conclWhy: (n: number) => `A ${n}-word document with several sections ends without a closing section or paragraph. Three or four lines of summary tell the reader what to take away.`,
    long: (n: number) => `${n}-word paragraph`,
    longWhy: (n: number) => `The paragraph is over ${LONG_PARAGRAPH_WORDS} words (${n}). A long paragraph hides its structure; split it where the idea changes.`,
    topic: () => `No topic sentence`,
    topicWhyModel: () => `The local model found no sentence that says what the paragraph is about. A topic sentence up front lets the reader skim and see the structure.`,
    topicWhyRule: (why: string) => `${why} A topic sentence at the start says what the paragraph is about before the details.`,
    opensConnective: (w: string) => `The paragraph opens on "${w}", a connective that continues an earlier idea rather than stating a new one.`,
    opensQuestion: () => `The paragraph opens on a question, and no sentence states the answer as its topic.`,
    noOverlap: () => `Its first sentence shares no content word with the rest of the paragraph.`,
  },
};

const contentStems = (s: string): Set<string> =>
  new Set(
    words(s)
      .filter((w) => w.script !== "num")
      .map((w) => plain(w.text))
      .filter((p) => p.length > 2 && !STOP.has(p))
      .map(stem),
  );

/** The rule's answer on a topic sentence: a reason it lacks one, or null (has one, or unclear). */
export function topicRule(paragraph: string, lang: "he" | "en"): string | null {
  const t = MSG[lang];
  const ss = sentences(paragraph);
  const first = ss[0]?.text ?? "";
  const conn = CONNECTIVE_OPENER.exec(first);
  if (conn) return t.opensConnective(conn[0].replace(/[,\s]+$/, "").trim());
  if (/[?؟]\s*$/.test(first)) return t.opensQuestion();
  const a = contentStems(first);
  const rest = contentStems(ss.slice(1).map((s) => s.text).join(" "));
  if (a.size >= 3 && rest.size >= 6 && [...a].every((x) => !rest.has(x))) return t.noOverlap();
  return null;
}

/** Whether a paragraph is long enough to need a topic sentence. */
export const needsTopic = (p: string, lang: "he" | "en" = isHebrewText(p) ? "he" : "en"): boolean => sentences(p).length >= 4 && wordCount(p) >= TOPIC_MIN_WORDS[lang];

export async function critiqueStructure(text: string, opts: StructureOptions = {}): Promise<WritingSuggestion[]> {
  const out = structureRules(text, opts.rules);
  if (opts.rules && !opts.rules.includes("topic-sentence")) return out;
  const o = outlineOf(text);
  for (const p of o.paragraphs) {
    throwIfAborted(opts.signal);
    if (!needsTopic(p.text)) continue;
    const lang = isHebrewText(p.text) ? "he" : "en";
    const t = MSG[lang];
    let verdict: boolean | null = null;
    if (opts.judge) verdict = await opts.judge(p.text, { signal: opts.signal, lang });
    throwIfAborted(opts.signal);
    if (verdict === true) continue;
    const ruleWhy = topicRule(p.text, lang);
    if (verdict === false || ruleWhy) {
      out.push(
        mk(p.from, Math.min(p.to, p.from + (sentences(p.text)[0]?.text.length ?? 1)), "topic-sentence", t.topic(), verdict === false && !ruleWhy ? t.topicWhyModel() : t.topicWhyRule(ruleWhy ?? t.noOverlap()), verdict === false ? (ruleWhy ? 0.85 : 0.7) : 0.6, verdict === false ? (opts.judgeModel ?? "local") : RULES_MODEL),
      );
    }
  }
  return out.sort((a, b) => a.range.from - b.range.from);
}

function mk(from: number, to: number, kind: string, message: string, rationale: string, c: number, model = RULES_MODEL): WritingSuggestion {
  return { range: { from, to: Math.max(to, from + 1) }, kind, message, rationale, confidence: conf(c), replacement: null, agentId: AGENT_ID, model };
}

/** Every rule but the topic sentence, synchronously (no model). */
export function structureRules(text: string, rules?: readonly string[]): WritingSuggestion[] {
  const on = (r: string) => !rules || rules.includes(r);
  const o = outlineOf(text);
  const { headings: hs, paragraphs } = o;
  const lang = isHebrewText(text) ? "he" : "en";
  const t = MSG[lang];
  const out: WritingSuggestion[] = [];
  const parentOf = (i: number): number => {
    for (let j = i - 1; j >= 0; j--) if (hs[j].level < hs[i].level) return j;
    return -1;
  };
  const children = (i: number): number[] => {
    const kids: number[] = [];
    for (let j = i + 1; j < hs.length && hs[j].level > hs[i].level; j++) if (parentOf(j) === i) kids.push(j);
    return kids;
  };
  const textUnder = (i: number, until: number) => paragraphs.some((p) => p.section === i && p.from < until);
  // Anything at all under a heading before the next one (lists, code, quotes count as content).
  const contentAfter = (i: number) => {
    const end = i + 1 < hs.length ? hs[i + 1].from : text.length;
    return text.slice(hs[i].to, end).trim().length > 0;
  };

  // The smallest level used is the top: a note may start at H2 under a title in front matter.
  const top = hs.length ? Math.min(...hs.map((h) => h.level)) : 1;
  // One H1 first is the document's title; its H2s are the main sections.
  const docTitle = hs.length > 0 && hs[0].level === 1 && hs.filter((h) => h.level === 1).length === 1;
  hs.forEach((h, i) => {
    const prev = i > 0 ? hs[i - 1].level : top - 1;
    if (on("heading-skip") && h.level > prev + 1 && !(i === 0 && h.level === top)) {
      out.push(mk(h.from, h.to, "heading-skip", t.skip(prev, h.level), t.skipWhy(prev, h.level), 0.95));
    }
    const kids = children(i);
    if (on("lone-subheading") && kids.length === 1 && !BACKMATTER.test(h.title) && !BACKMATTER.test(hs[kids[0]].title)) {
      out.push(mk(h.from, h.to, "lone-subheading", t.lone(h.title), t.loneWhy(h.title, hs[kids[0]].title), h.level === top && i === 0 ? 0.7 : 0.85));
    }
    if (on("empty-section") && !kids.length && !contentAfter(i)) out.push(mk(h.from, h.to, "empty-section", t.empty(h.title), t.emptyWhy(h.title), 0.85));
    if (on("no-intro") && kids.length >= 2 && !(docTitle && i === 0) && !textUnder(i, hs[kids[0]].from)) {
      out.push(mk(h.from, h.to, "no-intro", t.intro(h.title), t.introWhy(h.title), 0.75));
    }
  });
  if (on("duplicate-heading")) {
    const seen = new Map<string, number>();
    hs.forEach((h, i) => {
      const key = `${parentOf(i)}\u0000${h.level}\u0000${plain(h.title).replace(/\s+/g, " ").trim()}`;
      if (!h.title) return;
      if (seen.has(key)) out.push(mk(h.from, h.to, "duplicate-heading", t.dup(h.title), t.dupWhy(h.title), 0.9));
      else seen.set(key, i);
    });
  }
  // The document as a whole: several top sections need an opening, a long one a close.
  const mainLevel = docTitle ? 2 : top;
  const mains = hs.filter((h) => h.level === mainLevel && !BACKMATTER.test(h.title));
  if (on("no-intro") && mains.length >= 3) {
    const firstMain = mains[0];
    const before = paragraphs.some((p) => p.to <= firstMain.from);
    if (!before) {
      out.push(mk(firstMain.from, firstMain.to, "no-intro", t.docIntro(), t.docIntroWhy(), 0.7));
    }
  }
  if (on("no-conclusion") && mains.length >= 3 && o.words >= CONCLUSION_MIN_WORDS[lang]) {
    const last = mains[mains.length - 1];
    const lastPara = [...paragraphs].reverse().find((p) => p.from > last.from && !BACKMATTER.test(sectionTitle(hs, p.section)));
    const closes = CONCLUSION_TITLE.test(last.title) || (lastPara && (CONCLUSION_OPENER.test(lastPara.text) || CONCLUSION_OPENER.test(sentences(lastPara.text).slice(-1)[0]?.text ?? "")));
    if (!closes) out.push(mk(last.from, last.to, "no-conclusion", t.concl(), t.conclWhy(o.words), 0.65));
  }
  if (on("long-paragraph")) {
    for (const p of paragraphs) {
      const n = wordCount(p.text);
      if (n > LONG_PARAGRAPH_WORDS) out.push(mk(p.from, p.from + (sentences(p.text)[0]?.text.length ?? 1), "long-paragraph", t.long(n), t.longWhy(n), 0.9));
    }
  }
  return out.sort((a, b) => a.range.from - b.range.from);
}

const sectionTitle = (hs: Heading[], i: number) => (i >= 0 ? hs[i].title : "");
