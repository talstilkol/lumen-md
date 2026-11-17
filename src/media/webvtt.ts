/**
 * Transcript tracks for audio and video (plan W12.F8): WebVTT (W3C,
 * https://www.w3.org/TR/webvtt1/) and SubRip (.srt), written from the timed
 * transcripts the app already makes and read back for the player.
 *
 * Nothing here transcribes: the cues come from an existing transcript
 * (the meeting flow's sentences) or from a .vtt / .srt file in the vault.
 * Speakers are WebVTT voice spans (`<v דנה>…`); text is escaped as the spec
 * requires (`&`, `<`, `>`).
 */

export interface Cue {
  /** Seconds. */
  start: number;
  end: number;
  text: string;
  /** The speaker, written as a `<v>` voice span. */
  voice?: string | null;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** `hh:mm:ss.ttt` (WebVTT) or `hh:mm:ss,ttt` (SRT). */
export function timestamp(seconds: number, sep: "." | "," = "."): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

const escapeCue = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** A cue's text may not contain "-->" nor a blank line (either would end or break the cue). */
const cueText = (s: string) => escapeCue(s.replace(/-->/g, "→").replace(/\r?\n\s*\r?\n/g, "\n").trim());

/** Cues as a WebVTT file. Cues are sorted by start; an end before its start is moved to the start. */
export function toWebVtt(cues: readonly Cue[], opts: { language?: string } = {}): string {
  const sorted = [...cues].filter((c) => c.text.trim()).sort((a, b) => a.start - b.start);
  const out = ["WEBVTT", ...(opts.language ? [`Language: ${opts.language}`] : []), ""];
  sorted.forEach((c, i) => {
    const end = Math.max(c.end, c.start);
    const voice = c.voice?.replace(/[>\n]/g, "").trim();
    out.push(String(i + 1), `${timestamp(c.start)} --> ${timestamp(end)}`, voice ? `<v ${escapeCue(voice)}>${cueText(c.text)}` : cueText(c.text), "");
  });
  return out.join("\n");
}

/** Cues as a SubRip file (the speaker as a "Name: " prefix, SRT's usual way). */
export function toSrt(cues: readonly Cue[]): string {
  const sorted = [...cues].filter((c) => c.text.trim()).sort((a, b) => a.start - b.start);
  return sorted
    .map((c, i) => `${i + 1}\n${timestamp(c.start, ",")} --> ${timestamp(Math.max(c.end, c.start), ",")}\n${c.voice ? `${c.voice}: ` : ""}${c.text.replace(/-->/g, "→").replace(/\r?\n\s*\r?\n/g, "\n").trim()}\n`)
    .join("\n");
}

const TIME = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)[.,](\d{3})$/;

function seconds(t: string): number | null {
  const m = TIME.exec(t.trim());
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&lrm;/g, "‎").replace(/&rlm;/g, "‏").replace(/&amp;/g, "&");

export interface ParsedTrack {
  cues: Cue[];
  /** Problems a WebVTT validator would report (empty for a valid file). */
  errors: string[];
}

/**
 * Parse a WebVTT file, checking the parts of the spec a player depends on:
 * the `WEBVTT` signature, the timing line (`start --> end`, with valid
 * timestamps, end not before start), cue starts in order, and no "-->" in
 * a cue's text. Also reads SubRip (`,` before the milliseconds, numbered
 * cues, no signature) when `format` is "srt".
 */
export function parseTrack(text: string, format: "vtt" | "srt" = "vtt"): ParsedTrack {
  const errors: string[] = [];
  const lines = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  if (format === "vtt") {
    if (!/^WEBVTT(?:[ \t].*)?$/.test(lines[0] ?? "")) errors.push('line 1: the file must start with "WEBVTT"');
    // The header runs to the first blank line.
    while (i < lines.length && lines[i].trim() !== "") i++;
  }
  const cues: Cue[] = [];
  let lastStart = -1;
  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === "") i++;
    if (i >= lines.length) break;
    const blockStart = i;
    // NOTE, STYLE and REGION blocks carry no cue.
    if (format === "vtt" && /^(NOTE|STYLE|REGION)(\s|$)/.test(lines[i])) {
      while (i < lines.length && lines[i].trim() !== "") i++;
      continue;
    }
    // An optional identifier line before the timing line.
    if (!lines[i].includes("-->")) i++;
    const timing = lines[i] ?? "";
    const m = /^(\S+)[ \t]+-->[ \t]+(\S+)(?:[ \t]+.*)?$/.exec(timing);
    if (!m) {
      errors.push(`line ${i + 1}: expected a cue timing "start --> end"`);
      while (i < lines.length && lines[i].trim() !== "") i++;
      continue;
    }
    const start = seconds(format === "srt" ? m[1] : m[1].replace(",", "!"));
    const end = seconds(format === "srt" ? m[2] : m[2].replace(",", "!"));
    if (start === null || end === null) errors.push(`line ${i + 1}: bad timestamp in "${timing}"`);
    else {
      if (end < start) errors.push(`line ${i + 1}: the cue ends before it starts`);
      if (start < lastStart) errors.push(`line ${i + 1}: cues must be in order of their start time`);
      lastStart = start;
    }
    i++;
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      if (lines[i].includes("-->")) errors.push(`line ${i + 1}: "-->" in the text of the cue that starts on line ${blockStart + 1}`);
      body.push(lines[i++]);
    }
    if (start === null || end === null) continue;
    let raw = body.join("\n");
    let voice: string | null = null;
    const v = /^<v(?:\.[^\s>]*)?[ \t]+([^>]*)>/.exec(raw);
    if (v) {
      voice = unescape(v[1].trim());
      raw = raw.slice(v[0].length);
    } else if (format === "srt") {
      const sp = /^([^:\n]{1,40}): /.exec(raw);
      if (sp) {
        voice = sp[1];
        raw = raw.slice(sp[0].length);
      }
    }
    // Markup inside the cue (<b>, <i>, <c.x>, </v>, timestamps) is not text.
    const plain = unescape(raw.replace(/<\/?[a-z][^>]*>|<\d[^>]*>/gi, "")).trim();
    cues.push({ start, end, text: plain, voice });
  }
  return { cues, errors };
}

/** Timed sentences (the meeting flow's, with their speakers) as cues. */
export function cuesFromSentences(sentences: ReadonlyArray<{ start: number; end: number; text: string; speaker?: string | null }>): Cue[] {
  return sentences.map((s) => ({ start: s.start, end: s.end, text: s.text, voice: s.speaker ?? null }));
}

/** The cue playing at `time`, as an index, or -1. */
export function cueAt(cues: readonly Cue[], time: number): number {
  let found = -1;
  for (let k = 0; k < cues.length; k++) if (cues[k].start <= time + 1e-6 && time < cues[k].end) found = k;
  return found;
}

/** The transcript file beside a media file by its stem: `rec.m4a` → `rec.vtt` (and `.srt`), as other apps name it. */
export const sidecarPath = (media: string, ext: "vtt" | "srt" = "vtt") => media.replace(/\.[^./]+$/, "") + `.${ext}`;
/**
 * The track the app writes for a media file, by its full name: `rec.m4a` → `rec.m4a.vtt` (review Z7-M5). Two
 * recordings with one stem (`rec.m4a`, `rec.wav`) get two tracks. The player reads this one first, then the stem's.
 */
export const trackPath = (media: string, ext: "vtt" | "srt" = "vtt") => `${media}.${ext}`;

export { MEDIA_EXT, VIDEO_EXT } from "./mediaExt";
