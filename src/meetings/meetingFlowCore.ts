/**
 * The local meeting flow (W11.I19–I21), the pure part (no app imports):
 *
 *   live finals / timed segments → sentences, none longer than 60 s, so the
 *                                  note has a ▶ time at least once a minute
 *   model notes                  → each decision, task and question checked
 *                                  against the transcript; an item with no
 *                                  source sentence is dropped, a kept one
 *                                  links to its sentence's moment
 *   tasks                        → obsidian-tasks lines with the ▶ link;
 *                                  ⏳ the meeting's day when no due date was
 *                                  said, so the Today view lists them
 *   the note                     → frontmatter `type: meeting` (the team-
 *                                  meeting Base lists it), summary,
 *                                  decisions, tasks, questions, transcript
 *
 * Speaker labels appear only when real diarization gave them (`speakers`);
 * nothing here invents one.
 */
import { contentWords, type MeetingNotes, type MeetingTask } from "./meetingCore";
import { clock, sentencesOf, timeFragment, type Sentence } from "../ai/dictation/longform";

/** The longest a transcript line may span: the note has a time at least this often. */
export const STAMP_EVERY_SEC = 60;

/** A finished sentence of the live engine and when it closed (seconds from the start of the recording). */
export interface TimedFinal {
  at: number;
  text: string;
}

/** Live finals → segments: each runs from the previous final's close to its own. */
export function segmentsOfFinals(finals: readonly TimedFinal[], durationSec: number): Sentence[] {
  const out: Sentence[] = [];
  let from = 0;
  for (const f of [...finals].sort((a, b) => a.at - b.at)) {
    const text = f.text.replace(/\s+/g, " ").trim();
    const end = Math.min(Math.max(f.at, from), durationSec > 0 ? durationSec : f.at);
    if (text) out.push({ start: from, end, text });
    from = end;
  }
  return out;
}

/** Split any sentence longer than `max` seconds into word runs with proportional times. */
export function capSentences(sentences: readonly Sentence[], max = STAMP_EVERY_SEC): Sentence[] {
  const out: Sentence[] = [];
  for (const s of sentences) {
    const span = s.end - s.start;
    if (span <= max) {
      out.push(s);
      continue;
    }
    // Time is shared out by length (a word and its space); a run closes before it would pass `max`.
    const words = s.text.split(/\s+/).filter(Boolean);
    const total = words.reduce((n, w) => n + w.length + 1, 0) || 1;
    const secs = (w: string) => (span * (w.length + 1)) / total;
    let at = s.start;
    let run: string[] = [];
    let len = 0;
    const flush = (last: boolean) => {
      if (!run.length) return;
      const end = last ? s.end : Math.min(s.end, at + len);
      out.push({ start: at, end, text: run.join(" ") });
      at = end;
      run = [];
      len = 0;
    };
    for (const w of words) {
      if (run.length && len + secs(w) > max) flush(false);
      run.push(w);
      len += secs(w);
    }
    flush(true);
  }
  return out;
}

/** Timed segments → the note's sentences: split at sentence ends, none over `max` seconds. */
export function meetingSentences(segments: readonly Sentence[], max = STAMP_EVERY_SEC): Sentence[] {
  return capSentences(sentencesOf(segments, max), max);
}

/** The longest stretch one transcript line covers (the "a time at least every minute" check). */
export function longestLine(sentences: readonly Sentence[]): number {
  return sentences.reduce((m, s) => Math.max(m, s.end - s.start), 0);
}

/* ─── Grounding: every item needs a source sentence ─────────────────── */

/** Share of an item's content words a sentence must hold to be its source. */
export const GROUND_MIN = 0.5;

function coverage(item: Set<string>, text: string): number {
  if (!item.size) return 0;
  const w = contentWords(text);
  let n = 0;
  for (const x of item) if (w.has(x)) n++;
  return n / item.size;
}

/**
 * The transcript sentence an item comes from, or -1. A lexical check: at
 * least half of the item's content words are in one sentence, or in two
 * adjacent ones (then the one holding more of them). Not an entailment
 * check: an item that reuses the transcript's words in a sense it did not
 * have would pass. Items with no content words never pass.
 */
export function sourceOf(item: string, sentences: readonly Sentence[]): number {
  const w = contentWords(item);
  if (!w.size) return -1;
  let best = -1;
  let bestC = 0;
  sentences.forEach((s, i) => {
    const c = coverage(w, s.text);
    if (c > bestC) [best, bestC] = [i, c];
  });
  if (bestC >= GROUND_MIN) return best;
  for (let i = 0; i + 1 < sentences.length; i++) {
    if (coverage(w, `${sentences[i].text} ${sentences[i + 1].text}`) >= GROUND_MIN) return coverage(w, sentences[i + 1].text) > coverage(w, sentences[i].text) ? i + 1 : i;
  }
  return -1;
}

export interface Sourced<T> {
  item: T;
  /** Index of the source sentence. */
  at: number;
}

export interface CheckedNotes {
  decisions: Sourced<string>[];
  tasks: Sourced<MeetingTask>[];
  questions: Sourced<string>[];
  /** Items the model wrote with no source in the transcript: left out of the note. */
  rejected: string[];
}

/** Keep the items with a source sentence; the rest are rejected. */
export function checkNotes(notes: MeetingNotes, sentences: readonly Sentence[]): CheckedNotes {
  const rejected: string[] = [];
  const keep = <T>(items: readonly T[], text: (x: T) => string): Sourced<T>[] =>
    items.flatMap((item) => {
      const at = sourceOf(text(item), sentences);
      if (at < 0) {
        rejected.push(text(item));
        return [];
      }
      return [{ item, at }];
    });
  return { decisions: keep(notes.decisions, (s) => s), tasks: keep(notes.tasks, (x) => x.text), questions: keep(notes.questions, (s) => s), rejected };
}

/* ─── The note ──────────────────────────────────────────────────────── */

const FIELD = /[📅⏳🛫➕✅❌🔁🏁⛔🆔🔺⏫🔼🔽⏬]️?/gu;

/** `[▶ 3:12](<audio#t=192,197>)`, or a plain `3:12` without the audio. */
export function stamp(s: Sentence, audioLink: string | null): string {
  return audioLink ? `[▶ ${clock(s.start)}](<${audioLink}${timeFragment(s)}>)` : `\`${clock(s.start)}\``;
}

/** One task: `- [ ] text [▶ 3:12](<…>) (@owner) ⏳ YYYY-MM-DD` (⏳ only without a due date) `📅 due`. */
export function meetingTaskLine(task: MeetingTask, source: Sentence, audioLink: string | null, date: string): string {
  const text = task.text.replace(FIELD, "").replace(/\s+/g, " ").trim();
  const owner = task.owner ? ` (@${task.owner.replace(/\s+/g, "_")})` : "";
  const when = task.due ? ` 📅 ${task.due}` : ` ⏳ ${date}`;
  return `- [ ] ${text} ${stamp(source, audioLink)}${owner}${when}`;
}

export interface MeetingNoteLabels {
  recording: string;
  summary: string;
  summaryKind: string;
  decisions: string;
  tasks: string;
  questions: string;
  none: string;
  transcript: string;
  /** "{n} items had no source in the transcript and were left out." (already filled in) */
  rejected: string | null;
}

export interface MeetingDraft {
  title: string;
  /** YYYY-MM-DD */
  date: string;
  audioLink: string | null;
  durationSec: number;
  sentences: Sentence[];
  /** Summary sentence indices. */
  summary: number[];
  notes: CheckedNotes;
  /** One per sentence, from real diarization only; omitted otherwise. */
  speakers?: ReadonlyArray<string | null>;
  /** The transcript came from (engine names, for the frontmatter). */
  engine: string;
}

const yamlStr = (s: string) => JSON.stringify(s);
const plain = (s: string) => s.replace(/::/g, ":");

export function meetingNote(d: MeetingDraft, L: MeetingNoteLabels): string {
  const at = (i: number) => d.sentences[i];
  const items = (xs: Sourced<string>[]) => (xs.length ? xs.map((x) => `- ${plain(x.item)} ${stamp(at(x.at), d.audioLink)}`) : [`_${L.none}_`]);
  const named = d.speakers?.some(Boolean) ? [...new Set(d.speakers.filter((s): s is string => !!s))] : [];
  const open = d.notes.tasks.length;
  return [
    "---",
    "type: meeting",
    `date: ${d.date}`,
    ...(named.length ? [`participants: [${named.map(yamlStr).join(", ")}]`] : []),
    ...(d.audioLink ? [`meeting-audio: ${yamlStr(d.audioLink)}`] : []),
    `meeting-duration: ${yamlStr(clock(d.durationSec))}`,
    `meeting-transcript: ${yamlStr(d.engine)}`,
    `tasks-open: ${open}`,
    "tags: [meeting]",
    "---",
    "",
    `# ${d.title}`,
    "",
    ...(d.audioLink ? [`${L.recording}: [▶ 0:00–${clock(d.durationSec)}](<${d.audioLink}>)`, ""] : []),
    `## ${L.summary}`,
    "",
    `_${L.summaryKind}_`,
    "",
    ...(d.summary.length ? d.summary.map((i) => `- ${plain(at(i).text)} ${stamp(at(i), d.audioLink)}`) : [`_${L.none}_`]),
    "",
    `## ${L.decisions}`,
    "",
    ...items(d.notes.decisions),
    "",
    `## ${L.tasks}`,
    "",
    ...(open ? d.notes.tasks.map((x) => meetingTaskLine(x.item, at(x.at), d.audioLink, d.date)) : [`_${L.none}_`]),
    "",
    `## ${L.questions}`,
    "",
    ...items(d.notes.questions),
    "",
    ...(L.rejected ? [`> ${L.rejected}`, ""] : []),
    `## ${L.transcript}`,
    "",
    ...d.sentences.map((s, i) => `${stamp(s, d.audioLink)} ${d.speakers?.[i] ? `**${d.speakers[i]}:** ` : ""}${plain(s.text)}`),
    "",
  ].join("\n");
}

/** `Meetings/2026-11-15 0930 Title.md`, the audio beside it in `Meetings/audio/`. */
export function meetingPaths(when: Date, title: string, mime: string): { note: string; audio: string; audioLink: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}${pad(when.getMinutes())}`;
  const safe = title.replace(/[\\/:*?"<>|#^[\]]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Meeting";
  const ext = /mp4/.test(mime) ? "m4a" : /ogg/.test(mime) ? "ogg" : "webm";
  const file = `meeting-${stamp.replace(" ", "-")}.${ext}`;
  return { note: `Meetings/${stamp} ${safe}.md`, audio: `Meetings/audio/${file}`, audioLink: `audio/${file}` };
}
