/**
 * Study plans (plan W12.H4): the day's reading of each cycle as a line of
 * the daily note (`{{learning}}`), a plan's progress, and a reading marked
 * for review as a flashcard (the FSRS queue, W3.3).
 *
 * The plans live in `.lumen/learning.json` in the vault: which cycles the
 * user follows, from when, and the days marked learned. Nothing is sent
 * anywhere; the links open sefaria.org only when clicked.
 */
import { fixedOf, gregorianOf, type GDay } from "../daily/hebrewCalendar";
import { gematria } from "../daily/gematria";
import { hash, type Source } from "../srs/cards";
import { dafYomi, dailyRambam, mishnahYomit, sefariaUrl } from "./cycles";

export const LEARNING_PATH = ".lumen/learning.json";

export type CycleId = "dafYomi" | "mishnahYomit" | "rambam1" | "rambam3";
export const CYCLES: readonly CycleId[] = ["dafYomi", "mishnahYomit", "rambam1", "rambam3"];

export interface Plan {
  cycle: CycleId;
  /** The first day the user follows it (YYYY-MM-DD). */
  started: string;
  /** Days marked learned (YYYY-MM-DD). */
  done: string[];
  /** Days marked for review (a flashcard each). */
  review?: string[];
}

export interface LearningFile {
  version: 1;
  plans: Plan[];
}

export interface Reading {
  cycle: CycleId;
  /** "Daf Yomi" / "דף יומי". */
  name: string;
  /** "ברכות ב׳" / "Berakhot 2". */
  label: string;
  /** Sefaria references (one or two). */
  refs: string[];
  url: string;
}

const NAMES: Record<CycleId, { he: string; en: string }> = {
  dafYomi: { he: "דף יומי", en: "Daf Yomi" },
  mishnahYomit: { he: "משנה יומית", en: "Mishnah Yomit" },
  rambam1: { he: "רמב״ם יומי", en: "Daily Rambam" },
  rambam3: { he: "רמב״ם (3 פרקים)", en: "Daily Rambam (3 chapters)" },
};

const pad2 = (n: number) => String(n).padStart(2, "0");
export const iso = (d: GDay) => `${d.y}-${pad2(d.m)}-${pad2(d.d)}`;
export const parseDay = (s: string): GDay | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
};

/** The day's reading of one cycle, named in Hebrew (`he`) or English. */
export function readingOf(cycle: CycleId, day: GDay, lang: "he" | "en"): Reading | null {
  const name = NAMES[cycle][lang];
  if (cycle === "dafYomi") {
    const d = dafYomi(day);
    if (!d) return null;
    return { cycle, name, label: lang === "he" ? `${d.he} ${gematria(d.daf)}` : `${d.tractate} ${d.daf}`, refs: [d.ref], url: sefariaUrl(d.ref) };
  }
  if (cycle === "mishnahYomit") {
    const m = mishnahYomit(day);
    if (!m) return null;
    const [a, b] = m.mishnayot;
    const he = (p: typeof a) => `${gematria(p.chapter)}:${gematria(p.mishnah)}`;
    const label =
      lang === "he"
        ? a.tractate === b.tractate
          ? `${a.he} ${he(a)}–${a.chapter === b.chapter ? gematria(b.mishnah) : he(b)}`
          : `${a.he} ${he(a)} · ${b.he} ${he(b)}`
        : m.refs.join(" · ");
    return { cycle, name, label, refs: m.refs, url: sefariaUrl(m.refs[0]) };
  }
  const r = dailyRambam(day, cycle === "rambam1" ? 1 : 3);
  if (!r) return null;
  const label =
    lang === "he"
      ? groupBy(r.units).map((g) => (g[0].intro ? g[0].he : `${g[0].he} ${g.map((u) => u.span.split("-").map((c) => gematria(Number(c))).join("–")).join(", ")}`)).join(" · ")
      : r.refs.map((x) => x.replace(/^Mishneh Torah, /, "")).join(" · ");
  return { cycle, name, label, refs: r.refs, url: sefariaUrl(r.refs[0]) };
}

function groupBy<T extends { title: string }>(xs: readonly T[]): T[][] {
  const out: T[][] = [];
  for (const x of xs) {
    const last = out.at(-1);
    if (last && last[0].title === x.title) last.push(x);
    else out.push([x]);
  }
  return out;
}

const mdText = (s: string) => s.replace(/([\\`*_[\]<>#|])/g, "\\$1");

/**
 * `{{learning}}`: one line per followed cycle, `- דף יומי: [ברכות ב׳](https://www.sefaria.org/Berakhot.2)`.
 * Nothing when no cycle is followed.
 */
export function learningLines(day: GDay, cycles: readonly CycleId[], lang: "he" | "en"): string[] {
  return cycles.flatMap((c) => {
    const r = readingOf(c, day, lang);
    return r ? [`- ${r.name}: [${mdText(r.label)}](${r.url})`] : [];
  });
}

// ── Plans and progress ──────────────────────────────────────────────────

export const emptyLearningFile = (): LearningFile => ({ version: 1, plans: [] });

export function parseLearningFile(text: string | null): LearningFile {
  if (!text) return emptyLearningFile();
  try {
    const f = JSON.parse(text) as Partial<LearningFile>;
    if (f.version !== 1 || !Array.isArray(f.plans)) return emptyLearningFile();
    const plans = f.plans.filter((p): p is Plan => !!p && CYCLES.includes(p.cycle) && !!parseDay(String(p.started)) && Array.isArray(p.done));
    return { version: 1, plans: plans.map((p) => ({ ...p, done: p.done.filter((d) => parseDay(d)), review: (p.review ?? []).filter((d) => parseDay(d)) })) };
  } catch {
    return emptyLearningFile();
  }
}
export const serializeLearningFile = (f: LearningFile) => JSON.stringify(f, null, 1) + "\n";

/** Follow a cycle from `day` (a second call keeps the first start). */
export function follow(f: LearningFile, cycle: CycleId, day: GDay): LearningFile {
  if (f.plans.some((p) => p.cycle === cycle)) return f;
  return { ...f, plans: [...f.plans, { cycle, started: iso(day), done: [], review: [] }] };
}

/** Stop following a cycle (its days marked learned go with it). */
export function unfollow(f: LearningFile, cycle: CycleId): LearningFile {
  return { ...f, plans: f.plans.filter((p) => p.cycle !== cycle) };
}

/** Mark a day learned (or not). */
export function markDone(f: LearningFile, cycle: CycleId, day: GDay, done = true): LearningFile {
  const d = iso(day);
  return {
    ...f,
    plans: f.plans.map((p) => (p.cycle !== cycle ? p : { ...p, done: done ? [...new Set([...p.done, d])].sort() : p.done.filter((x) => x !== d) })),
  };
}

/** Mark a day's reading for review: it becomes a flashcard (reviewCards). */
export function markForReview(f: LearningFile, cycle: CycleId, day: GDay): LearningFile {
  const d = iso(day);
  return { ...f, plans: f.plans.map((p) => (p.cycle !== cycle ? p : { ...p, review: [...new Set([...(p.review ?? []), d])].sort() })) };
}

export interface Progress {
  /** Days from the start to `today`, inclusive. */
  due: number;
  done: number;
  /** Days due and not marked, oldest first (at most 30). */
  behind: string[];
}

export function progress(p: Plan, today: GDay): Progress {
  const start = parseDay(p.started)!;
  const a = fixedOf(start);
  const b = fixedOf(today);
  const due = Math.max(0, b - a + 1);
  const done = new Set(p.done);
  const behind: string[] = [];
  for (let f = a; f <= b && behind.length < 30; f++) {
    const d = iso(gregorianOf(f));
    if (!done.has(d)) behind.push(d);
  }
  return { due, done: p.done.filter((d) => fixedOf(parseDay(d)!) >= a && fixedOf(parseDay(d)!) <= b).length, behind };
}

/**
 * The readings marked for review as flashcard sources (src/srs/cards.ts):
 * the front names the reading, the back links to its text. They join the
 * FSRS queue like any question::answer card.
 */
export function reviewCards(f: LearningFile, lang: "he" | "en"): Source[] {
  const out: Source[] = [];
  for (const p of f.plans)
    for (const d of p.review ?? []) {
      const day = parseDay(d);
      const r = day && readingOf(p.cycle, day, lang);
      if (!r) continue;
      out.push({ id: `learn-${hash(`${p.cycle}|${d}`)}`, kind: "qa", front: `${r.name} · ${r.label}`, back: r.url, link: LEARNING_PATH, source: LEARNING_PATH });
    }
  return out;
}
