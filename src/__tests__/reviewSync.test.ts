/**
 * W3.3 acceptance "the data survives sync and a device switch" (audit r2:
 * not tested). Two devices review from the same `.lumen/review.json`, then
 * a git pull merges them (planPull, src/sync/gitMerge.ts); a third device
 * opens the merged vault and goes on reviewing exactly where they left off.
 * The data is SYNTHETIC (built here).
 */
import { describe, expect, it } from "vitest";
import { dailyQueue, parseReviewFile, rate, serializeReviewFile, syncSources, type ReviewFile, type Source } from "../srs/cards";
import { fsrs } from "../srs/fsrs";
import { mergeReviewFiles, REVIEW_FILE_PATH } from "../srs/reviewMerge";
import { planPull } from "../sync/gitMerge";

const enc = new TextEncoder();
const dec = new TextDecoder();
const f = fsrs();
const day = (d: number, h = 9) => new Date(Date.UTC(2026, 10, d, h));
const src = (i: number): Source => ({ id: `c${i}`, kind: "qa", front: `שאלה ${i}`, back: `תשובה ${i}`, link: `notes/n${i}`, source: `notes/n${i}.md` });

function start(): ReviewFile {
  return syncSources({ version: 1, cards: {} }, Array.from({ length: 8 }, (_, i) => src(i)), day(1));
}

/** One device's day: rate each listed card. */
function review(file: ReviewFile, ids: string[], rating: 1 | 2 | 3 | 4, at: Date): ReviewFile {
  return ids.reduce((acc, id) => rate(acc, id, rating, at, f), file);
}

function pull(base: ReviewFile, ours: ReviewFile, theirs: ReviewFile, path = REVIEW_FILE_PATH) {
  return planPull([{ path, base: enc.encode(serializeReviewFile(base)), ours: enc.encode(serializeReviewFile(ours)), theirs: enc.encode(serializeReviewFile(theirs)) }]);
}

describe("the review file across devices (W3.3)", () => {
  const base = review(start(), ["c0", "c1", "c2"], 3, day(2));

  it("two devices that reviewed different cards: both reviews are kept, the merge is clean and valid", () => {
    const laptop = review(base, ["c3", "c4"], 3, day(3, 8));
    const phone = review(base, ["c5"], 4, day(3, 20));
    const acts = pull(base, laptop, phone);
    expect(acts.map((a) => a.kind)).toEqual(["write"]);
    const merged = parseReviewFile(dec.decode((acts[0] as { data: Uint8Array }).data))!;
    expect(merged).not.toBeNull();
    for (const id of ["c3", "c4"]) expect(merged.cards[id].card).toEqual(laptop.cards[id].card);
    expect(merged.cards.c5.card).toEqual(phone.cards.c5.card);
    expect(merged.cards.c0.card).toEqual(base.cards.c0.card);
  });

  it("the same card reviewed on both: the later review's schedule, both ratings in the log, no conflict markers", () => {
    const laptop = review(base, ["c0"], 1, day(5, 8)); // forgot it in the morning
    const phone = review(base, ["c0"], 3, day(5, 21)); // knew it in the evening
    const acts = pull(base, laptop, phone);
    expect(acts.map((a) => a.kind)).toEqual(["write"]);
    const text = dec.decode((acts[0] as { data: Uint8Array }).data);
    expect(text).not.toMatch(/<<<<<<<|>>>>>>>/);
    const merged = parseReviewFile(text)!;
    expect(merged.cards.c0.card).toEqual(phone.cards.c0.card);
    expect(merged.cards.c0.log.map((r) => r.rating)).toEqual([3, 1, 3]);
    // Without the card-by-card merge this is a line conflict of the JSON (the old behaviour).
  });

  it("a line merge of the same file is what used to happen: a conflict (the reason for this merge)", () => {
    const laptop = review(base, ["c0"], 1, day(5, 8));
    const phone = review(base, ["c0"], 3, day(5, 21));
    const acts = pull(base, laptop, phone, "notes/review-copy.json");
    expect(acts.map((a) => a.kind)).toEqual(["conflict"]);
  });

  it("a card whose source was removed on one device and reviewed on the other is kept, marked gone", () => {
    const laptop = syncSources(base, Array.from({ length: 8 }, (_, i) => src(i)).filter((s) => s.id !== "c1"), day(6));
    const phone = review(base, ["c1"], 3, day(6, 12));
    const merged = parseReviewFile(mergeReviewFiles(serializeReviewFile(base), serializeReviewFile(laptop), serializeReviewFile(phone)))!;
    expect(merged.cards.c1.gone).toBe(true);
    expect(merged.cards.c1.card).toEqual(phone.cards.c1.card);
  });

  it("a device switch: a new device opens the merged file and goes on exactly as the old one would", () => {
    const laptop = review(base, ["c3"], 3, day(7, 8));
    const phone = review(base, ["c4"], 2, day(7, 20));
    const text = dec.decode((pull(base, laptop, phone)[0] as { data: Uint8Array }).data);
    // The old device (both reviews in memory) and the new one (only the file) agree on every next step.
    const inMemory = review(review(base, ["c3"], 3, day(7, 8)), ["c4"], 2, day(7, 20));
    const onNewDevice = parseReviewFile(text)!;
    for (const d of [8, 10, 15, 30]) expect(dailyQueue(onNewDevice, day(d)).map((e) => e.id)).toEqual(dailyQueue(inMemory, day(d)).map((e) => e.id));
    const next = review(onNewDevice, ["c3"], 4, day(20));
    expect(next.cards.c3.card).toEqual(review(inMemory, ["c3"], 4, day(20)).cards.c3.card);
  });

  it("a side that is not a review file falls back to the text merge (both versions kept)", () => {
    expect(mergeReviewFiles(null, "{broken", serializeReviewFile(base))).toBeNull();
  });
});
