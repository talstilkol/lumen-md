/**
 * Tasks as Dataview sees them (plan W2.12): every `- [ ] text` line of a
 * note outside code, with its status, its inline fields (`[due:: 2026-11-20]`)
 * and the Tasks plugin's emoji dates (📅 due, ⏳ scheduled, 🛫 start, ➕
 * created, ✅ completion), for TASK queries and `file.tasks`.
 *
 * Pure: a note's text in, task objects out (the Value shape the evaluator
 * reads, so `t.completed`, `t.text` and `t.due` work in a WHERE).
 */
import type { Value } from "./dataview";

export interface DvTask {
  /** The text after the checkbox. */
  text: string;
  /** The character in the box: " " open, "x" done, "-" cancelled, "/" in progress, … */
  status: string;
  completed: boolean;
  /** Its own box ticked and every sub-task's too. */
  fullyCompleted: boolean;
  checked: boolean;
  /** 0-based line in the note. */
  line: number;
  /** Indent depth in leading whitespace characters (for sub-tasks). */
  indent: number;
  tags: string[];
  /** Inline fields and emoji dates, by name. */
  fields: Record<string, string>;
  /** The heading the task is under, or "". */
  section: string;
}

const TASK = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+\[(.)\][ \t]+(.*)$/;
const FENCE = /^[ \t]*(```|~~~)/;
const HEADING = /^#{1,6}[ \t]+(.+?)[ \t#]*$/;
const EMOJI: Array<[string, string]> = [
  ["📅", "due"],
  ["🗓️", "due"],
  ["🗓", "due"],
  ["⏳", "scheduled"],
  ["🛫", "start"],
  ["➕", "created"],
  ["✅", "completion"],
];

/** The tasks of a note, in order. */
export function tasksOf(content: string): DvTask[] {
  const out: DvTask[] = [];
  const lines = content.split(/\r?\n/);
  let fence: string | null = null;
  let section = "";
  let start = 0;
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) start = end + 1;
  }
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const f = FENCE.exec(line);
    if (f) {
      if (fence === null) fence = f[1];
      else if (f[1] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const h = HEADING.exec(line);
    if (h) {
      section = h[1];
      continue;
    }
    const m = TASK.exec(line);
    if (!m) continue;
    const status = m[2];
    const text = m[3].trim();
    const fields: Record<string, string> = {};
    for (const fm of text.matchAll(/[[(]([\p{L}\w][\p{L}\w \-]*?)::\s*([^\])]*)[\])]/gu)) fields[fm[1].trim()] ??= fm[2].trim();
    for (const [emoji, name] of EMOJI) {
      const at = text.indexOf(emoji);
      if (at < 0) continue;
      const d = /^\s*(\d{4}-\d{2}-\d{2})/.exec(text.slice(at + emoji.length));
      if (d) fields[name] ??= d[1];
    }
    const tags = [...text.matchAll(/(^|[\s(])#([\p{L}\p{M}\p{N}_/-]*[\p{L}\p{M}_][\p{L}\p{M}\p{N}_/-]*)/gu)].map((t) => "#" + t[2]);
    const completed = status === "x" || status === "X";
    out.push({ text, status, completed, fullyCompleted: completed, checked: status !== " ", line: i, indent: m[1].replace(/\t/g, "    ").length, tags, fields, section });
  }
  // A task is fully completed when it and every task indented under it are.
  for (let i = out.length - 1; i >= 0; i--) {
    for (let j = i + 1; j < out.length && out[j].indent > out[i].indent; j++) {
      if (!out[j].fullyCompleted) {
        out[i].fullyCompleted = false;
        break;
      }
    }
  }
  return out;
}

/** A task as a value the queries read; `scalar` turns field text into numbers, dates and links. */
export function taskValue(t: DvTask, path: string, scalar: (raw: string) => Value): Record<string, Value> {
  const name = path.split("/").pop()!.replace(/\.md$/i, "");
  const v: Record<string, Value> = {};
  for (const [k, raw] of Object.entries(t.fields)) {
    v[k] = scalar(raw);
    const norm = k.toLowerCase().replace(/\s+/g, "-");
    if (!(norm in v)) v[norm] = v[k];
  }
  return Object.assign(v, {
    text: t.text,
    status: t.status,
    completed: t.completed,
    fullyCompleted: t.fullyCompleted,
    checked: t.checked,
    annotated: Object.keys(t.fields).length > 0,
    line: t.line,
    tags: t.tags,
    section: t.section ? { link: `${path}#${t.section}`, display: t.section } : null,
    path,
    link: { link: path, display: name },
  });
}
