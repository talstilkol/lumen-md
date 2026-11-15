/**
 * Timelines and the time checker (plan R12.7).
 *
 * - `buildTimeline`: one row per claim, each with its source; a claim with
 *   no date goes to a separate "undated" group and is never given one.
 * - Time is a range of days by precision: "2023" is 1 Jan–31 Dec 2023,
 *   "July 2023" the whole month (`TimeSpan`, from hebrewDates.ts).
 * - `checkTimeline`: impossible dates (an end before its start, an event
 *   after the subject's death or before its birth), overlapping roles (two
 *   holders of one exclusive position at once) and contradictory order (a
 *   claim said to come after another that ends before it starts). Each is a
 *   gap for the user to look at, "certain" when the ranges cannot be
 *   reconciled and "possible" when only their uncertainty allows it — never
 *   a finding, and never a change to a note.
 * - `knownOn`: "what did I know on date X": the claims recorded by then
 *   (`observed`), the latest record of each subject and predicate winning.
 *
 * Clean reimplementation (design reference only: israelconnect's timeline
 * builder and temporal reasoner, AGPL; no code taken).
 */
import { extractDates } from "../daily/hebrewDates";

export type Precision = "day" | "month" | "year";

export interface TimeSpan {
  /** Inclusive ISO days. */
  from: string;
  to: string;
  precision: Precision;
}

export interface ClaimSource {
  note: string;
  /** The paragraph's `^id`, when it has one. */
  anchor?: string | null;
  quote: string;
}

export interface TimelineClaim {
  id: string;
  /** The entity the claim is about. */
  subject: string;
  /** born · died · role · event, or any other predicate. */
  predicate: string;
  /** What the claim says (a role's position, an event's name). */
  value: string;
  /** When it was true in the world: a point (start only) or a period. */
  start?: TimeSpan;
  end?: TimeSpan;
  /** The day it was recorded (the note's date). */
  observed: string;
  source: ClaimSource;
  /** This claim's event comes after that claim's (the text says so). */
  after?: string;
  /** role: one holder at a time (a mayor, a chair). */
  exclusive?: boolean;
}

export interface TimelineRow {
  claim: TimelineClaim;
  /** The earliest day the claim can start, for ordering. */
  sortKey: string;
}

export interface Timeline {
  rows: TimelineRow[];
  undated: TimelineClaim[];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (s: string) => {
  if (!ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const validSpan = (t: TimeSpan | undefined) => !t || (validDay(t.from) && validDay(t.to) && t.from <= t.to);

export function buildTimeline(claims: readonly TimelineClaim[]): Timeline {
  const rows: TimelineRow[] = [];
  const undated: TimelineClaim[] = [];
  for (const c of claims) {
    const s = c.start ?? c.end;
    if (!s) undated.push(c);
    else rows.push({ claim: c, sortKey: s.from });
  }
  rows.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.claim.id < b.claim.id ? -1 : 1));
  return { rows, undated };
}

export type GapKind = "invalid-date" | "end-before-start" | "before-birth" | "after-death" | "role-overlap" | "order";
export type Certainty = "certain" | "possible";

export interface TimeGap {
  kind: GapKind;
  certainty: Certainty;
  /** The claims involved, in the order the message names them. */
  claims: string[];
  subject: string;
}

/** `a` is surely before `b` (all of a ends before any of b), possibly before, or not. */
function before(a: TimeSpan, b: TimeSpan): Certainty | null {
  if (a.to < b.from) return "certain";
  if (a.from < b.to) return "possible";
  return null;
}
/** The period of a claim: its start's earliest to its end's latest (open end: its start). */
const period = (c: TimelineClaim): { lo: TimeSpan; hi: TimeSpan } | null => {
  const lo = c.start ?? c.end;
  if (!lo) return null;
  return { lo, hi: c.end ?? c.start! };
};

export function checkTimeline(claims: readonly TimelineClaim[]): TimeGap[] {
  const gaps: TimeGap[] = [];
  const byId = new Map(claims.map((c) => [c.id, c]));
  const ok = claims.filter((c) => {
    if (validSpan(c.start) && validSpan(c.end)) return true;
    gaps.push({ kind: "invalid-date", certainty: "certain", claims: [c.id], subject: c.subject });
    return false;
  });
  for (const c of ok) {
    if (c.start && c.end) {
      // The end is surely before the start: impossible. Overlapping ranges are only uncertain, not a gap.
      if (c.end.to < c.start.from) gaps.push({ kind: "end-before-start", certainty: "certain", claims: [c.id], subject: c.subject });
    }
  }
  // Birth and death bound every other dated claim about the subject.
  const bySubject = new Map<string, TimelineClaim[]>();
  for (const c of ok) bySubject.set(c.subject, [...(bySubject.get(c.subject) ?? []), c]);
  for (const [subject, list] of bySubject) {
    const born = list.find((c) => c.predicate === "born" && c.start);
    const died = list.find((c) => c.predicate === "died" && c.start);
    for (const c of list) {
      if (c === born || c === died) continue;
      const p = period(c);
      if (!p) continue;
      if (born) {
        const v = before(p.lo, born.start!);
        if (v === "certain") gaps.push({ kind: "before-birth", certainty: "certain", claims: [c.id, born.id], subject });
      }
      if (died) {
        const v = before(died.start!, p.lo);
        if (v === "certain") gaps.push({ kind: "after-death", certainty: "certain", claims: [c.id, died.id], subject });
      }
    }
    if (born && died && before(died.start!, born.start!) === "certain") gaps.push({ kind: "after-death", certainty: "certain", claims: [born.id, died.id], subject });
  }
  // One holder of an exclusive position at a time.
  const roles = ok.filter((c) => c.predicate === "role" && c.exclusive && c.start);
  for (let i = 0; i < roles.length; i++)
    for (let j = i + 1; j < roles.length; j++) {
      const a = roles[i];
      const b = roles[j];
      if (a.value !== b.value || a.subject === b.subject) continue;
      const pa = period(a)!;
      const pb = period(b)!;
      // An open-ended role (no end) runs on: it overlaps anything after its start.
      const aEnd = a.end ?? { from: "9999-12-31", to: "9999-12-31", precision: "day" as Precision };
      const bEnd = b.end ?? { from: "9999-12-31", to: "9999-12-31", precision: "day" as Precision };
      // Surely overlapping: each starts surely before the other surely ends.
      if (pa.lo.to < bEnd.from && pb.lo.to < aEnd.from) gaps.push({ kind: "role-overlap", certainty: "certain", claims: [a.id, b.id], subject: a.value });
      else if (pa.lo.from <= bEnd.to && pb.lo.from <= aEnd.to) gaps.push({ kind: "role-overlap", certainty: "possible", claims: [a.id, b.id], subject: a.value });
    }
  // "after": this claim's event comes after another one's.
  for (const c of ok) {
    if (!c.after) continue;
    const o = byId.get(c.after);
    if (!o || !ok.includes(o)) continue;
    const pc = period(c);
    const po = period(o);
    if (!pc || !po) continue;
    if (pc.hi.to < po.lo.from) gaps.push({ kind: "order", certainty: "certain", claims: [c.id, o.id], subject: c.subject });
  }
  return gaps;
}

/**
 * What was known on `day`: the claims recorded on or before it; of several
 * records of one subject and predicate (and role value), the latest.
 */
export function knownOn(claims: readonly TimelineClaim[], day: string): TimelineClaim[] {
  const latest = new Map<string, TimelineClaim>();
  for (const c of claims) {
    if (c.observed > day) continue;
    const key = `${c.subject}\u0000${c.predicate}\u0000${c.predicate === "role" || c.predicate === "event" ? c.value : ""}`;
    const had = latest.get(key);
    if (!had || had.observed < c.observed || (had.observed === c.observed && had.id < c.id)) latest.set(key, c);
  }
  return claims.filter((c) => [...latest.values()].includes(c));
}

/** The words for a span's uncertainty: a day, a month, a year, or a range of them. */
export function spanWords(t: TimeSpan, lang: "he" | "en"): string {
  const [y, m, d] = t.from.split("-");
  const one = t.from === t.to || (t.precision === "month" && t.from.slice(0, 7) === t.to.slice(0, 7)) || (t.precision === "year" && t.from.slice(0, 4) === t.to.slice(0, 4));
  if (one) {
    if (t.precision === "day") return `${Number(d)}.${Number(m)}.${y}`;
    if (t.precision === "month") return `${Number(m)}.${y}`;
    return y;
  }
  const a = spanWords({ ...t, to: t.from }, lang);
  const lastOf = t.precision === "year" ? t.to.slice(0, 4) : t.precision === "month" ? `${Number(t.to.slice(5, 7))}.${t.to.slice(0, 4)}` : `${Number(t.to.slice(8, 10))}.${Number(t.to.slice(5, 7))}.${t.to.slice(0, 4)}`;
  return lang === "he" ? `בין ${a} ל־${lastOf}` : `between ${a} and ${lastOf}`;
}

/** The first date in a claim's quote, as a span (R12.6 dates), for building claims from notes. */
export function spanFromText(text: string, reference?: string): TimeSpan | undefined {
  const m = extractDates(text, { reference })[0];
  return m ? { from: m.from, to: m.to, precision: m.precision } : undefined;
}
