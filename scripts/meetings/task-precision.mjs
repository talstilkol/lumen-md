#!/usr/bin/env node
/**
 * Task precision of a meeting note against three reviewers (W11.I21).
 *
 *   npm run eval:meeting-tasks -- --note <meeting note.md> --review <review.json> [--out score.json]
 *
 * The reference is every task two of the three reviewers wrote; the note's
 * tasks are its `- [ ]` lines. A synthetic review (the test sample) is
 * scored but marked so, and never passes as a result.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { referenceTasks, scoreTasks, tasksOfNote, validateReview } from "../../src/meetings/meetingEval.ts";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const note = arg("note");
const reviewPath = arg("review");
if (!note || !reviewPath) {
  console.error("usage: npm run eval:meeting-tasks -- --note <meeting note.md> --review <review.json> [--out score.json]");
  process.exit(2);
}
const review = JSON.parse(readFileSync(reviewPath, "utf8"));
const problems = validateReview(review);
if (problems.length) {
  console.error(`review file: ${problems.join("; ")}`);
  process.exit(2);
}
const predicted = tasksOfNote(readFileSync(note, "utf8"));
const reference = referenceTasks(review);
const score = { ...scoreTasks(predicted, reference), synthetic: review.synthetic, recording: review.recording, command: process.argv.slice(1).join(" ") };
console.log(`${review.synthetic ? "SYNTHETIC review — not a result. " : ""}tasks: ${score.matched}/${score.predicted} in the reference (precision ${score.precision.toFixed(3)}), ${score.matched}/${score.reference} of the reference found (recall ${score.recall.toFixed(3)})`);
const out = arg("out");
if (out) writeFileSync(out, JSON.stringify(score, null, 2) + "\n");
