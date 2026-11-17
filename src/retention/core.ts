import { compareCodePoints } from "../i18n/collate";
/**
 * Retention loops (plan W11.P15), the pure part: "On this day" and the
 * weekly summary, built from the notes on this device. Nothing is sent, and
 * each loop is a flag the user can turn off (src/flags/flags.json:
 * retention.onThisDay, retention.weeklySummary). ./retention.ts reads the
 * vault and writes the blocks into the daily note.
 */

export interface RetentionNote {
  path: string;
  modified: number;
  content: string;
}

export interface Ymd {
  y: number;
  m: number;
  d: number;
}

export const OTD_START = "<!-- lumen:onthisday:start -->";
export const OTD_END = "<!-- lumen:onthisday:end -->";
export const WEEK_START = "<!-- lumen:weekly:start -->";
export const WEEK_END = "<!-- lumen:weekly:end -->";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Ymd) => `${d.y}-${pad(d.m)}-${pad(d.d)}`;
const FRONTMATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const CREATED = /^(?:created|date|created_at|creation date)\s*:\s*["']?(\d{4})-(\d{2})-(\d{2})/im;

/** The body without its frontmatter, the first line that says something (for an excerpt). */
export function excerpt(content: string, max = 80): string {
  const body = content.replace(FRONTMATTER, "");
  const line = body.split(/\r?\n/).map((l) => l.replace(/^#+\s*|^[-*+]\s+(\[[ xX]\]\s+)?|<!--.*?-->/g, "").trim()).find((l) => l && !l.startsWith("<!--")) ?? "";
  return [...line].length > max ? `${[...line].slice(0, max - 1).join("")}…` : line;
}

export interface OnThisDayEntry {
  year: number;
  path: string;
  excerpt: string;
  /** "daily": that day's daily note; "created": a note whose frontmatter says it was written that day. */
  why: "daily" | "created";
}

/**
 * Notes from this day in earlier years (up to `years` back): that day's daily
 * note, and notes created on that day. A daily note for 29 February shows
 * on 28 February in other years.
 */
export function onThisDay(notes: readonly RetentionNote[], today: Ymd, dailyPathOf: (d: Ymd) => string, years = 10): OnThisDayEntry[] {
  const byPath = new Map(notes.map((n) => [n.path, n]));
  const out: OnThisDayEntry[] = [];
  const seen = new Set<string>();
  const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  for (let back = 1; back <= years; back++) {
    const y = today.y - back;
    const days: Ymd[] = [{ y, m: today.m, d: today.d }];
    if (today.m === 2 && today.d === 28 && leap(y)) days.push({ y, m: 2, d: 29 });
    if (today.m === 2 && today.d === 29 && !leap(y)) days[0] = { y, m: 2, d: 28 };
    for (const day of days) {
      const p = dailyPathOf(day);
      const n = byPath.get(p);
      if (n && !seen.has(p)) {
        seen.add(p);
        out.push({ year: y, path: p, excerpt: excerpt(n.content), why: "daily" });
      }
    }
  }
  for (const n of notes) {
    if (seen.has(n.path)) continue;
    const fm = FRONTMATTER.exec(n.content)?.[1];
    const m = fm ? CREATED.exec(fm) : null;
    if (!m) continue;
    const y = +m[1];
    if (+m[2] === today.m && +m[3] === today.d && y < today.y && y >= today.y - years) {
      seen.add(n.path);
      out.push({ year: y, path: n.path, excerpt: excerpt(n.content), why: "created" });
    }
  }
  return out.sort((a, b) => b.year - a.year || compareCodePoints(a.path, b.path));
}

export interface WeekData {
  from: string;
  to: string;
  edited: Array<{ path: string; modified: number }>;
  editedMore: number;
  done: Array<{ path: string; text: string; date: string }>;
  doneMore: number;
  tags: Array<{ tag: string; count: number }>;
  words: number;
}

const DONE = /^\s*(?:[-*+]|\d+[.)])\s+\[[xX]\]\s+(.+?)\s*✅\s*(\d{4}-\d{2}-\d{2})/u;
const TAG = /(?:^|[\s(])#([\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)/gu;
const DAY = 86_400_000;

/**
 * The past week from the notes: what was edited, the tasks done (Obsidian
 * Tasks' `✅ date`), the tags used most in those notes, and their words. The
 * week is the 7 days before `end` (local midnight of the day the summary is
 * for).
 */
export function weekData(notes: readonly RetentionNote[], end: Date, skip: (path: string) => boolean = () => false, limits = { edited: 10, done: 10, tags: 5 }): WeekData {
  const to = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const from = new Date(to.getTime() - 7 * DAY);
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const inWeek = (n: RetentionNote) => n.modified >= from.getTime() && n.modified < to.getTime() && !skip(n.path);
  const edited = notes.filter(inWeek).sort((a, b) => b.modified - a.modified);
  const fromIso = ymd(from);
  const toIso = ymd(to);
  const done: WeekData["done"] = [];
  const tags = new Map<string, number>();
  let words = 0;
  for (const n of notes) {
    if (skip(n.path)) continue;
    let fence = false;
    for (const line of n.content.split("\n")) {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence;
      if (fence) continue;
      const m = DONE.exec(line);
      if (m && m[2] >= fromIso && m[2] < toIso) done.push({ path: n.path, text: m[1].trim(), date: m[2] });
    }
  }
  for (const n of edited) {
    const body = n.content.replace(FRONTMATTER, "").replace(/^(```|~~~)[\s\S]*?^\1/gm, "");
    words += (body.match(/[\p{L}\p{N}]+(?:['’׳"״-][\p{L}\p{N}]+)*/gu) ?? []).length;
    for (const t of body.matchAll(TAG)) tags.set(t[1].toLowerCase(), (tags.get(t[1].toLowerCase()) ?? 0) + 1);
  }
  done.sort((a, b) => compareCodePoints(a.date, b.date) || compareCodePoints(a.path, b.path));
  return {
    from: fromIso,
    to: ymd(new Date(to.getTime() - DAY)),
    edited: edited.slice(0, limits.edited).map((n) => ({ path: n.path, modified: n.modified })),
    editedMore: Math.max(0, edited.length - limits.edited),
    done: done.slice(0, limits.done),
    doneMore: Math.max(0, done.length - limits.done),
    tags: [...tags].sort((a, b) => b[1] - a[1] || compareCodePoints(a[0], b[0])).slice(0, limits.tags).map(([tag, count]) => ({ tag, count })),
    words,
  };
}

export interface RetentionWords {
  onThisDay: string;
  created: string;
  week: (from: string, to: string) => string;
  edited: (n: number) => string;
  nothingEdited: string;
  done: (n: number) => string;
  tags: string;
  words: (n: number) => string;
  more: (n: number) => string;
  turnOff: string;
}

const link = (path: string) => `[[${path.replace(/\.md$/i, "")}]]`;

export function renderOnThisDay(entries: readonly OnThisDayEntry[], w: RetentionWords): string | null {
  if (!entries.length) return null;
  const lines = [OTD_START, `### ${w.onThisDay}`, ""];
  for (const e of entries) lines.push(`- **${e.year}** ${link(e.path)}${e.excerpt ? ` — ${e.excerpt}` : ""}${e.why === "created" ? ` (${w.created})` : ""}`);
  lines.push("", `<small>${w.turnOff}</small>`, OTD_END);
  return lines.join("\n");
}

export function renderWeek(d: WeekData, w: RetentionWords): string {
  const lines = [WEEK_START, `### ${w.week(d.from, d.to)}`, ""];
  if (!d.edited.length) lines.push(`- ${w.nothingEdited}`);
  else {
    lines.push(`**${w.edited(d.edited.length + d.editedMore)}** · ${w.words(d.words)}`, "");
    for (const e of d.edited) lines.push(`- ${link(e.path)}`);
    if (d.editedMore) lines.push(`- ${w.more(d.editedMore)}`);
  }
  if (d.done.length) {
    lines.push("", `**${w.done(d.done.length + d.doneMore)}**`, "");
    for (const t of d.done) lines.push(`- ✅ ${t.text} — ${link(t.path)}`);
    if (d.doneMore) lines.push(`- ${w.more(d.doneMore)}`);
  }
  if (d.tags.length) lines.push("", `${w.tags}: ${d.tags.map((t) => `#${t.tag} (${t.count})`).join(", ")}`);
  lines.push("", `<small>${w.turnOff}</small>`, WEEK_END);
  return lines.join("\n");
}

/** Put `block` in place of the previous one between `start` and `end`, or after `after` (another block's end), or after the note's first paragraph; `null` removes it. */
export function upsertBlock(note: string, start: string, end: string, block: string | null, after?: string): string {
  const a = note.indexOf(start);
  const b = note.indexOf(end);
  if (a >= 0 && b > a) {
    if (block === null) {
      // Take the block and the blank line put before it; the rest stays byte for byte.
      const from = note.slice(0, a).endsWith("\n\n") ? a - 2 : a;
      return note.slice(0, from) + note.slice(b + end.length);
    }
    return note.slice(0, a) + block + note.slice(b + end.length);
  }
  if (block === null) return note;
  // After another block (the week's summary goes after "On this day").
  const at = after ? note.indexOf(after) : -1;
  if (at >= 0) return `${note.slice(0, at + after!.length)}\n\n${block}${note.slice(at + after!.length)}`;
  const firstBlank = note.search(/\n\s*\n/);
  if (firstBlank < 0) return `${note.replace(/\s*$/, "")}\n\n${block}\n`;
  return `${note.slice(0, firstBlank)}\n\n${block}${note.slice(firstBlank)}`;
}

/** The first day of the week: Sunday in Israel (and the Hebrew locale), Monday elsewhere. */
export function isWeekStart(date: Date, israel: boolean): boolean {
  return date.getDay() === (israel ? 0 : 1);
}

export { iso as isoDay };
