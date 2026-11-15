/**
 * W11.I21: the knesset-committees manifest and the task-precision runner,
 * against a review sample that is SYNTHETIC (and labelled so in the file).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { referenceTasks, scoreTasks, tasksOfNote, validateReview, type TaskReview } from "../meetings/meetingEval";
import { validateManifest, isPinned, type PublicManifest } from "../eval/public/manifest";
import { meetingNote, meetingSentences, segmentsOfFinals, checkNotes } from "../meetings/meetingFlowCore";

const review = JSON.parse(readFileSync("src/__tests__/fixtures/meetings/review.synthetic.json", "utf8")) as TaskReview;

describe("the review file", () => {
  it("the sample is valid and says it is synthetic", () => {
    expect(validateReview(review)).toEqual([]);
    expect(review.synthetic).toBe(true);
  });

  it("needs exactly three distinct reviewers and a synthetic flag", () => {
    expect(validateReview({ ...review, reviewers: review.reviewers.slice(0, 2) })).toContain("exactly three reviewers");
    expect(validateReview({ ...review, reviewers: [review.reviewers[0], review.reviewers[0], review.reviewers[1]] })).toContain("reviewer ids must differ");
    expect(validateReview({ ...review, synthetic: undefined })).toContain("synthetic must be true or false");
  });

  it("the reference is what two of the three wrote", () => {
    expect(referenceTasks(review)).toEqual(["Send the budget table to the committee", "Invite the ministry's representative to the next session", "Publish the protocol on the website"]);
    expect(referenceTasks(review, 3)).toEqual([]);
  });
});

describe("the runner", () => {
  it("precision of a meeting note's tasks against the reference", () => {
    const finals = [
      { at: 30, text: "Ruth will send the budget table to the committee." },
      { at: 60, text: "The clerk will publish the protocol on the website." },
      { at: 90, text: "Someone should order lunch." },
    ];
    const s = meetingSentences(segmentsOfFinals(finals, 90));
    const notes = checkNotes({ decisions: [], tasks: [{ text: "Send the budget table to the committee", owner: "Ruth" }, { text: "Publish the protocol on the website" }, { text: "Order lunch" }], questions: [] }, s);
    const md = meetingNote(
      { title: "x", date: "2026-11-15", audioLink: "audio/a.webm", durationSec: 90, sentences: s, summary: [], notes, engine: "whisper" },
      { recording: "R", summary: "S", summaryKind: "k", decisions: "D", tasks: "T", questions: "Q", none: "-", transcript: "X", rejected: null },
    );
    const predicted = tasksOfNote(md);
    expect(predicted).toEqual(["Send the budget table to the committee", "Publish the protocol on the website", "Order lunch"]);
    const score = scoreTasks(predicted, referenceTasks(review));
    expect(score).toEqual({ predicted: 3, reference: 3, matched: 2, precision: 2 / 3, recall: 2 / 3 });
  });

  it("no predictions: precision 0, not NaN", () => {
    expect(scoreTasks([], ["a task"]).precision).toBe(0);
  });
});

describe("the manifest (eval/public/meeting-knesset-committees.json)", () => {
  const m = JSON.parse(readFileSync("eval/public/meeting-knesset-committees.json", "utf8")) as PublicManifest;
  it("is valid, names the ivrit.ai dataset, and stays unpinned with its pin owed", () => {
    expect(validateManifest(m, "meeting-knesset-committees")).toEqual([]);
    expect(m.dataset.id).toBe("ivrit-ai/knesset-committees");
    expect(isPinned(m)).toBe(false);
    expect((m.owed ?? []).some((o) => /^pin:/.test(o))).toBe(true);
    expect((m.owed ?? []).some((o) => /three people/.test(o))).toBe(true);
    expect(m.license.redistribute).toBe(false);
  });
});
