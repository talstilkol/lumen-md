/**
 * Inbox triage on this device (plan W10.C21, wiring W7.14): each entry of
 * the inbox note (capture/quickCapture: "- [[daily]] HH:MM text") is
 * classified by `generateStructured` into a task, an event, a reference or
 * a note, with the date it names (if any) and a few tags.
 *
 *   inboxEntries(text)        the entries, with their line spans
 *   triageEntry(text, today)  one entry → { kind, due, tags } (JSON checked against the schema)
 *   checkDue(due, today)      a date the model gave, kept only if it is a real day near today
 *   triagedEntry(entry, r)    the entry rewritten: a task becomes "- [ ] … 📅 YYYY-MM-DD", tags appended
 *   triageInbox(text, today)  the whole inbox rewritten, entry by entry, plus what changed
 *
 * Nothing is written here: the command stages the new inbox as one change
 * for the review panel (agents/staging), and only the user's approval writes.
 * Already triaged entries (a task checkbox, or tags at the end) are left.
 */
import { generateStructured, StructuredOutputError, type GenerateOptions, type StructuredEngineId } from "../ai/structured";
import { normalizeTags } from "../agents/defs/tagger";

export type TriageKind = "task" | "event" | "reference" | "note";

export interface TriageResult {
  kind: TriageKind;
  /** YYYY-MM-DD, checked by checkDue; null when the entry names no day. */
  due: string | null;
  tags: string[];
}

export interface InboxEntry {
  /** The entry's lines (first line with its "- " marker, continuation lines indented). */
  raw: string;
  /** The daily link and time prefix ("[[Daily/2026-11-15]] 09:30 "), kept as is. */
  prefix: string;
  /** The captured text (first line; continuation lines are kept untouched in `raw`). */
  text: string;
  /** Line numbers [start, end) in the inbox. */
  start: number;
  end: number;
}

export const TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["task", "event", "reference", "note"] },
    due: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    tags: { type: "array", items: { type: "string", minLength: 2, maxLength: 40 }, maxItems: 4 },
  },
  required: ["kind", "due", "tags"],
  additionalProperties: false,
} as const;

const ENTRY = /^- (\[\[[^\]]+\]\] \d{2}:\d{2} |\d{4}-\d{2}-\d{2} \d{2}:\d{2} )?(.*)$/;
const DONE_ALREADY = /^\[[ xX]\] |(?:^|\s)#[\p{L}\p{N}_-]+\s*$/u;

/** The inbox's capture entries, in order. Lines that are not entries (the heading, prose) are not touched. */
export function inboxEntries(text: string): InboxEntry[] {
  const lines = text.split("\n");
  const out: InboxEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = ENTRY.exec(lines[i]);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && /^ {2}\S/.test(lines[j])) j++;
    out.push({ raw: lines.slice(i, j).join("\n"), prefix: m[1] ?? "", text: m[2], start: i, end: j });
    i = j - 1;
  }
  return out;
}

const DAY_MS = 86_400_000;

/**
 * A date the model gave, kept only when it is a real calendar day within two
 * years of today (a model asked for "a date" can invent one; a day outside
 * that range is far more likely a mistake than a plan).
 */
export function checkDue(due: unknown, today: string): string | null {
  if (typeof due !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return null;
  const d = new Date(`${due}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== due) return null;
  const t = new Date(`${today}T00:00:00Z`).getTime();
  return Math.abs(d.getTime() - t) <= 2 * 366 * DAY_MS ? due : null;
}

/** The prompt for one entry: today's date and weekday, so "מחר" or "next Tuesday" can be resolved. */
export function triagePrompt(text: string, today: string): { system: string; prompt: string } {
  const weekday = new Date(`${today}T12:00:00Z`).toLocaleDateString("en", { weekday: "long", timeZone: "UTC" });
  return {
    system:
      "Classify one captured inbox line. kind: task (something to do), event (something happening at a time), reference (a link or fact to keep) or note. " +
      "due: the calendar day the line names, as YYYY-MM-DD, resolved against today; null when it names no day — never guess one. " +
      "tags: up to 4 short lowercase tags in the line's own language. Answer with JSON only.",
    prompt: `Today is ${weekday}, ${today}.\nLine: ${text.slice(0, 1000)}`,
  };
}

/** One entry, classified by a local structured engine. Throws StructuredOutputError when none answered. */
export async function triageEntry(text: string, today: string, opts: GenerateOptions & { signal?: AbortSignal } = {}): Promise<TriageResult & { engine: StructuredEngineId }> {
  const { system, prompt } = triagePrompt(text, today);
  const { signal, ...gen } = opts;
  const r = await generateStructured<{ kind: TriageKind; due: string | null; tags: string[] }>(
    { system, prompt, schema: TRIAGE_SCHEMA as unknown as Record<string, unknown>, temperature: 0, signal },
    { task: "short", ...gen },
  );
  return { kind: r.value.kind, due: checkDue(r.value.due, today), tags: normalizeTags(r.value.tags).slice(0, 4), engine: r.engine };
}

/** The entry with the triage applied: a task becomes a checkbox with its due date, tags go at the end. */
export function triagedEntry(entry: InboxEntry, r: TriageResult): string {
  const rest = entry.raw.split("\n").slice(1);
  let text = entry.text.trimEnd();
  if (r.kind === "task") text = `[ ] ${text}${r.due && !text.includes("📅") ? ` 📅 ${r.due}` : ""}`;
  else if (r.due && !text.includes(r.due)) text = `${text} (${r.due})`;
  const tags = r.tags.filter((t) => !new RegExp(`(?:^|\\s)#${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`, "u").test(text));
  if (tags.length) text = `${text} ${tags.map((t) => `#${t}`).join(" ")}`;
  return [`- ${entry.prefix}${text}`, ...rest].join("\n");
}

export interface InboxTriage {
  after: string;
  changed: number;
  /** Entries left alone because they were already triaged. */
  skipped: number;
  /** Entries no local engine could classify. */
  failed: number;
  engines: StructuredEngineId[];
}

/**
 * The inbox with every untriaged entry classified and rewritten. Lines that
 * are not entries stay byte for byte. Stops at the first entry no engine
 * answered for when it is the first one (no local model at all).
 */
export async function triageInbox(text: string, today: string, opts: GenerateOptions & { signal?: AbortSignal; classify?: typeof triageEntry } = {}): Promise<InboxTriage> {
  const classify = opts.classify ?? triageEntry;
  const lines = text.split("\n");
  const entries = inboxEntries(text);
  const replaced = new Map<number, InboxEntry & { next: string }>();
  const engines = new Set<StructuredEngineId>();
  let skipped = 0;
  let failed = 0;
  for (const e of entries) {
    if (DONE_ALREADY.test(e.text) || !e.text.trim()) {
      skipped++;
      continue;
    }
    try {
      const r = await classify(e.text, today, opts);
      engines.add(r.engine);
      const next = triagedEntry(e, r);
      if (next !== e.raw) replaced.set(e.start, { ...e, next });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err;
      if (err instanceof StructuredOutputError && replaced.size === 0 && failed === 0 && engines.size === 0) {
        // The very first entry found no engine: there is no local model; say so instead of failing entry by entry.
        if (err.skipped.every((s) => s.reason === "unavailable" || s.reason === "gate")) throw err;
      }
      failed++;
    }
  }
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const r = replaced.get(i);
    if (r) {
      out.push(r.next);
      i = r.end - 1;
    } else out.push(lines[i]);
  }
  return { after: out.join("\n"), changed: replaced.size, skipped, failed, engines: [...engines] };
}
