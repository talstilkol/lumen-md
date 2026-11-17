/**
 * Writing goals per note (plan W13.W14): a word or time target, a target
 * readability and a target tone, in the note's frontmatter —
 *
 *   ---
 *   goal:
 *     words: 1500
 *     minutes: 45
 *     readability: medium      # easy | medium | hard
 *     tone: formal             # formal | neutral | casual
 *   ---
 *
 * (also `goal: 1500`, flat `goal.words: 1500`, and Hebrew values: קל /
 * בינוני / קשה, רשמי / ניטרלי / יומיומי). Ulysses and Scrivener give word
 * targets; a readability and tone target is what this adds.
 *
 * The count is the W5.8 count (book/wordCount.ts) — the same number the
 * book view shows. Progress is logged per day on this device only
 * (localStorage, guarded), for a weekly report; nothing is sent and nothing
 * is compared with other people.
 */
import { countWords } from "../../../book/wordCount";
import { readabilityOf, toneOf, type Level, type Readability, type Tone, type ToneEstimate } from "./readability";

export interface NoteGoal {
  words?: number;
  minutes?: number;
  readability?: Level;
  tone?: Tone;
}

const LEVEL: Record<string, Level> = { easy: "easy", medium: "medium", hard: "hard", "קל": "easy", "קלה": "easy", "בינוני": "medium", "בינונית": "medium", "קשה": "hard" };
const TONE: Record<string, Tone> = { formal: "formal", neutral: "neutral", casual: "casual", informal: "casual", "רשמי": "formal", "ניטרלי": "neutral", "נייטרלי": "neutral", "יומיומי": "casual", "לא רשמי": "casual" };

const unq = (v: string) => v.trim().replace(/^["']|["']$/g, "").trim();
const posInt = (v: string) => {
  const n = Number(unq(v).replace(/[,_]/g, ""));
  return Number.isFinite(n) && n > 0 && n < 10_000_000 ? Math.round(n) : undefined;
};

/** The note's goal, or null when its frontmatter sets none. */
export function parseGoal(markdown: string): NoteGoal | null {
  const fm = /^﻿?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(markdown)?.[1];
  if (!fm) return null;
  const g: NoteGoal = {};
  const set = (key: string, value: string) => {
    const k = key.trim().toLowerCase();
    if (k === "words") g.words = posInt(value);
    else if (k === "minutes") g.minutes = posInt(value);
    else if (k === "readability") g.readability = LEVEL[unq(value).toLowerCase()];
    else if (k === "tone") g.tone = TONE[unq(value).toLowerCase()];
  };
  const lines = fm.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const flat = /^goal\.(\w+)\s*:\s*(.+)$/.exec(lines[i]);
    if (flat) set(flat[1], flat[2]);
    const top = /^goal\s*:\s*(.*)$/.exec(lines[i]);
    if (!top) continue;
    if (top[1].trim() && !top[1].trim().startsWith("{")) g.words = posInt(top[1]);
    const inline = /^\{(.*)\}$/.exec(top[1].trim());
    if (inline) for (const part of inline[1].split(",")) { const [k, ...v] = part.split(":"); if (v.length) set(k, v.join(":")); }
    for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) {
      const m = /^\s+(\w+)\s*:\s*(.+)$/.exec(lines[j]);
      if (m) set(m[1], m[2]);
    }
  }
  for (const k of Object.keys(g) as Array<keyof NoteGoal>) if (g[k] === undefined) delete g[k];
  return Object.keys(g).length ? g : null;
}

/** The note without its `goal` frontmatter key (and its indented lines). */
export function removeGoal(markdown: string): string {
  return markdown.replace(/^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n(?:---|\.\.\.))/, (_, open: string, body: string, close: string) => {
    const out: string[] = [];
    let skipping = false;
    for (const l of body.split(/\r?\n/)) {
      if (/^goal(\.\w+)?\s*:/.test(l)) {
        skipping = /^goal\s*:/.test(l);
        continue;
      }
      if (skipping && /^\s+\S/.test(l)) continue;
      skipping = false;
      out.push(l);
    }
    return `${open}${out.join("\n")}${close}`;
  });
}

export interface GoalProgress {
  goal: NoteGoal;
  words: number;
  /** 0–1 of the word goal (null without one). */
  wordsRatio: number | null;
  readability: Readability | null;
  readabilityMet: boolean | null;
  tone: ToneEstimate | null;
  toneMet: boolean | null;
}

export function goalProgress(markdown: string, goal: NoteGoal): GoalProgress {
  const words = countWords(markdown);
  const readability = goal.readability ? readabilityOf(markdown) : null;
  const tone = goal.tone ? toneOf(markdown) : null;
  return {
    goal,
    words,
    wordsRatio: goal.words ? Math.min(1, words / goal.words) : null,
    readability,
    // "easy" is met by easy text; "medium" by easy or medium; "hard" (a dense register) is always fine.
    readabilityMet: goal.readability && readability ? ORDER[readability.level] <= ORDER[goal.readability] : null,
    tone,
    toneMet: goal.tone && tone ? tone.tone === goal.tone : null,
  };
}
const ORDER: Record<Level, number> = { easy: 0, medium: 1, hard: 2 };

// ── The local log and the weekly report ─────────────────────────────────

/** Edits further apart than this are not counted as writing time. */
export const IDLE_MS = 60_000;
const KEEP_DAYS = 62;

export interface DayEntry {
  /** Words when the note was first seen that day, and now. */
  start: number;
  last: number;
  /** Active writing time, ms. */
  ms: number;
  /** The goal's word target that day, if any. */
  target?: number;
  /** Last edit time (for the idle rule). */
  at: number;
}
export type GoalLog = Record<string, Record<string, DayEntry>>;

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Record the note's count now (pure: returns the new log). */
export function recordProgress(log: GoalLog, note: string, words: number, now: Date, target?: number): GoalLog {
  const day = dayKey(now);
  const t = now.getTime();
  const days = { ...(log[day] ?? {}) };
  const prev = days[note];
  const ms = prev ? prev.ms + (t - prev.at > 0 && t - prev.at <= IDLE_MS && words !== prev.last ? t - prev.at : 0) : 0;
  days[note] = { start: prev?.start ?? words, last: words, ms, target, at: t };
  const next: GoalLog = { ...log, [day]: days };
  const cutoff = dayKey(new Date(t - KEEP_DAYS * 86_400_000));
  for (const d of Object.keys(next)) if (d < cutoff) delete next[d];
  return next;
}

export interface WeeklyReport {
  from: string;
  to: string;
  days: Array<{ day: string; words: number; minutes: number }>;
  totalWords: number;
  totalMinutes: number;
  /** Days with any words written, in a row up to the last day. */
  streak: number;
  notes: Array<{ note: string; words: number; minutes: number; reached: boolean }>;
}

/** The 7 days ending on `end` (inclusive), from the local log. Words written = growth of each note per day (deletions don't subtract below 0). */
export function weeklyReport(log: GoalLog, end: Date): WeeklyReport {
  const days: WeeklyReport["days"] = [];
  const perNote = new Map<string, { words: number; ms: number; reached: boolean }>();
  for (let i = 6; i >= 0; i--) {
    const d = dayKey(new Date(end.getFullYear(), end.getMonth(), end.getDate() - i));
    let words = 0;
    let ms = 0;
    for (const [note, e] of Object.entries(log[d] ?? {})) {
      const w = Math.max(0, e.last - e.start);
      words += w;
      ms += e.ms;
      const p = perNote.get(note) ?? { words: 0, ms: 0, reached: false };
      perNote.set(note, { words: p.words + w, ms: p.ms + e.ms, reached: p.reached || (e.target != null && e.last >= e.target) });
    }
    days.push({ day: d, words, minutes: Math.round(ms / 60_000) });
  }
  let streak = 0;
  for (let i = days.length - 1; i >= 0 && days[i].words > 0; i--) streak++;
  return {
    from: days[0].day,
    to: days[6].day,
    days,
    totalWords: days.reduce((a, d) => a + d.words, 0),
    totalMinutes: days.reduce((a, d) => a + d.minutes, 0),
    streak,
    notes: [...perNote].map(([note, p]) => ({ note, words: p.words, minutes: Math.round(p.ms / 60_000), reached: p.reached })).sort((a, b) => b.words - a.words),
  };
}
