/**
 * Time blocks in the daily note (plan W12.H7): a list line that starts with
 * a time range is a block, as in Obsidian's Day Planner plugin:
 *
 *   - 09:00–10:30 Write the chapter
 *   - [ ] 14:00-15:00 Call the bank
 *
 * (en dash or hyphen; a task box is allowed). The timeline (ui/DayTimeline)
 * draws them and moves them; moving rewrites only the times on that line.
 *
 * Shabbat and yom tov are blocked time (daily/shabbatTimes, from candle
 * lighting to the end): a block that falls in them is marked, with a
 * suggestion to move it, never refused or moved by itself.
 */
import { fixedOf, gregorianOf, type GDay } from "./hebrewCalendar";
import { BLOCK_END as CAL_END, BLOCK_START as CAL_START } from "../calendar/dailyEvents";
import { localMidnight, restWindowOn, type City, type RestWindow, type ShabbatOptions } from "./shabbatTimes";

export interface Block {
  /** 0-based line in the note. */
  line: number;
  /** Minutes after local midnight. */
  start: number;
  end: number;
  text: string;
  /** "- [ ] " / "- " etc.: what comes before the times, kept as written. */
  prefix: string;
  /** The separator as written ("–" or "-"). */
  dash: string;
}

const BLOCK = /^(\s*[-*+]\s+(?:\[[ xX]\]\s+)?)(\d{1,2}):(\d{2})\s*([–—-])\s*(\d{1,2}):(\d{2})\s+(.*)$/;
const fence = /^\s*(```|~~~)/;

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * The note's blocks, in note order. Lines inside a code fence are not
 * blocks, nor are the lines of the calendar subscriptions' block
 * (calendar/dailyEvents, `<!-- lumen-calendar:start -->`): those are the
 * calendars' events, read by calendarEvents().
 */
export function parseBlocks(note: string): Block[] {
  return scan(note).blocks;
}

/** The events the calendar subscriptions wrote into the note (W7.20), for the timeline; read-only. */
export function calendarEvents(note: string): Array<{ time: string; endTime: string; summary: string }> {
  return scan(note).events.map((b) => ({ time: hhmm(b.start), endTime: hhmm(b.end % (24 * 60)), summary: b.text }));
}

function scan(note: string): { blocks: Block[]; events: Block[] } {
  const blocks: Block[] = [];
  const events: Block[] = [];
  let inFence = false;
  let inCalendar = false;
  note.split(/\r?\n/).forEach((l, line) => {
    if (l.includes(CAL_START)) inCalendar = true;
    if (l.includes(CAL_END)) {
      inCalendar = false;
      return;
    }
    if (fence.test(l)) inFence = !inFence;
    if (inFence) return;
    const m = BLOCK.exec(l);
    if (!m) return;
    const start = Number(m[2]) * 60 + Number(m[3]);
    let end = Number(m[5]) * 60 + Number(m[6]);
    if (Number(m[2]) > 23 || Number(m[3]) > 59 || Number(m[5]) > 24 || Number(m[6]) > 59) return;
    if (end <= start) end += 24 * 60; // past midnight: 23:00–01:00
    (inCalendar ? events : blocks).push({ line, start, end, text: m[7], prefix: m[1], dash: m[4] });
  });
  return { blocks, events };
}

/** Snap to `step` minutes and keep within the day (an end may reach 24:00). */
export const snap = (m: number, step = 15) => Math.round(m / step) * step;

/**
 * The note with the block on `line` set to `start`–`end` (minutes). Only
 * the times on that line change; the rest of the note is byte-identical.
 */
export function moveBlock(note: string, line: number, start: number, end: number): string {
  const nl = note.includes("\r\n") ? "\r\n" : "\n";
  const lines = note.split(/\r?\n/);
  const m = BLOCK.exec(lines[line] ?? "");
  if (!m) return note;
  const s = Math.max(0, Math.min(start, 24 * 60 - 5));
  const e = Math.max(s + 5, Math.min(end, 24 * 60));
  lines[line] = `${m[1]}${hhmm(s)}${m[4]}${hhmm(e)} ${m[7]}`;
  return lines.join(nl);
}

export interface BlockConflict {
  block: Block;
  rest: RestWindow;
  /** A suggestion: the same length, ending before the rest starts that day, or the same time on the next working day. */
  suggest: { day: GDay; start: number; end: number };
}

/** Blocks of `day` that fall in Shabbat or yom tov in `city`, each with a suggestion. */
export function restConflicts(blocks: readonly Block[], day: GDay, city: City, opts: ShabbatOptions = {}): BlockConflict[] {
  const rest = restWindowOn(day, city, opts);
  if (!rest) return [];
  const midnight = localMidnight(day, city.tz);
  const at = (min: number) => midnight + min * 60_000;
  const restStartMin = Math.max(0, Math.floor((rest.start - midnight) / 60_000));
  const out: BlockConflict[] = [];
  for (const b of blocks) {
    if (!(at(b.start) < rest.end && at(b.end) > rest.start)) continue;
    const len = b.end - b.start;
    let suggest: BlockConflict["suggest"];
    if (restStartMin - len >= 6 * 60) {
      // Earlier the same day, ending a quarter of an hour before candle lighting.
      const end = Math.floor((restStartMin - 15) / 15) * 15;
      suggest = { day, start: end - len, end };
    } else {
      let f = fixedOf(day) + 1;
      while (restWindowOn(gregorianOf(f), city, opts)) f++;
      suggest = { day: gregorianOf(f), start: b.start, end: b.end };
    }
    out.push({ block: b, rest, suggest });
  }
  return out;
}
