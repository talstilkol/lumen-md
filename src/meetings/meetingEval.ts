/**
 * Measuring the meeting flow's tasks (W11.I21) against people's review: a
 * public recording (ivrit-ai/knesset-committees, eval/public/meeting-knesset-
 * committees.json) is listened to by three reviewers, each writing the tasks
 * they heard agreed. A task is in the reference when at least two of the
 * three wrote it (`sameTask`, the word-overlap match the 6.16 eval uses).
 *
 *   precision  share of the flow's tasks that are in the reference
 *   recall     share of the reference the flow found
 *
 * The review file is the owner's (W11.O5); the sample in the tests is
 * synthetic and says so. Pure: the runner is scripts/meetings/task-precision.mjs.
 */
import { sameTask } from "./meetingCore";

export interface TaskReview {
  schema: 1;
  /** True for a made-up sample: a synthetic review never produces a reported number. */
  synthetic: boolean;
  recording: { manifest: string; file: string; start: string; end: string };
  reviewers: Array<{ id: string; tasks: string[] }>;
}

export function validateReview(r: unknown): string[] {
  const p: string[] = [];
  const x = r as Partial<TaskReview> | null;
  if (!x || typeof x !== "object") return ["not an object"];
  if (x.schema !== 1) p.push("schema must be 1");
  if (typeof x.synthetic !== "boolean") p.push("synthetic must be true or false");
  if (!x.recording || typeof x.recording.manifest !== "string" || typeof x.recording.file !== "string") p.push("recording.manifest and recording.file are required");
  if (!Array.isArray(x.reviewers) || x.reviewers.length !== 3) p.push("exactly three reviewers");
  else {
    if (new Set(x.reviewers.map((v) => v.id)).size !== 3) p.push("reviewer ids must differ");
    for (const v of x.reviewers) if (!Array.isArray(v.tasks) || v.tasks.some((s) => typeof s !== "string" || !s.trim())) p.push(`reviewer ${v.id}: tasks must be non-empty strings`);
  }
  return p;
}

/** The tasks at least `min` reviewers wrote (each reviewer counts once per task; the first wording is kept). */
export function referenceTasks(review: Pick<TaskReview, "reviewers">, min = 2): string[] {
  const groups: Array<{ text: string; by: Set<string> }> = [];
  for (const v of review.reviewers)
    for (const task of v.tasks) {
      const g = groups.find((x) => sameTask(x.text, task));
      if (g) g.by.add(v.id);
      else groups.push({ text: task, by: new Set([v.id]) });
    }
  return groups.filter((g) => g.by.size >= min).map((g) => g.text);
}

export interface TaskScore {
  predicted: number;
  reference: number;
  matched: number;
  precision: number;
  recall: number;
}

/** Precision and recall of predicted tasks against the reference (each reference task matches one prediction). */
export function scoreTasks(predicted: readonly string[], reference: readonly string[]): TaskScore {
  const used = new Set<number>();
  let matched = 0;
  for (const p of predicted) {
    const i = reference.findIndex((r, k) => !used.has(k) && sameTask(p, r));
    if (i >= 0) {
      used.add(i);
      matched++;
    }
  }
  return {
    predicted: predicted.length,
    reference: reference.length,
    matched,
    precision: predicted.length ? matched / predicted.length : 0,
    recall: reference.length ? matched / reference.length : 1,
  };
}

/** The task texts of a meeting note (its `## Tasks` lines), without the ▶ link, owner and dates. */
export function tasksOfNote(md: string): string[] {
  return md
    .split("\n")
    .filter((l) => /^- \[ \] /.test(l))
    .map((l) =>
      l
        .slice(6)
        .replace(/\s*\[▶[^\]]*\]\(<[^>]*>\)/g, "")
        .replace(/\s*`\d+:\d{2}(?::\d{2})?`/g, "")
        .replace(/\s*\(@[^)]*\)/g, "")
        .replace(/\s*[⏳📅]\s*\d{4}-\d{2}-\d{2}/gu, "")
        .trim(),
    )
    .filter(Boolean);
}
