/**
 * Plan W12.H4: the "follow a learning plan" picker. The dialog over the real
 * plans module (src/learning/plans.ts) and the real cycles: follow a cycle,
 * see today's reading with its Sefaria link, mark today learned, see the
 * progress, mark for review (it becomes a flashcard), stop following.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { LearningPlansDialog } from "../learning/LearningPlansDialog";
import { emptyLearningFile, follow, markDone, reviewCards, type LearningFile } from "../learning/plans";

afterEach(cleanup);

const TODAY = { y: 2020, m: 1, d: 7 };

function setup(file: LearningFile) {
  const saved: LearningFile[] = [];
  render(<LearningPlansDialog file={file} today={TODAY} lang="en" onChange={(f) => void saved.push(f)} onClose={() => {}} />);
  return saved;
}

describe("learning plans picker", () => {
  it("lists the four cycles with today's reading; following one saves the plan from today", () => {
    const saved = setup(emptyLearningFile());
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    const daf = screen.getByTestId("learning-dafYomi");
    expect(daf.getAttribute("data-following")).toBe("false");
    // 7 January 2020 is the third day of cycle 14: Berakhot 4.
    const link = within(daf).getByRole("link", { name: "Berakhot 4" });
    expect(link.getAttribute("href")).toBe("https://www.sefaria.org/Berakhot.4");
    fireEvent.click(within(daf).getByRole("checkbox"));
    expect(saved.at(-1)?.plans).toEqual([{ cycle: "dafYomi", started: "2020-01-07", done: [], review: [] }]);
    expect(screen.getByTestId("learning-dafYomi").getAttribute("data-following")).toBe("true");
    expect(screen.getByTestId("learning-dafYomi-progress").textContent).toBe("0 of 1 days");
  });

  it("shows progress since the start, marks today learned, and marks it for review as a card", () => {
    let f = follow(emptyLearningFile(), "rambam1", { y: 2020, m: 1, d: 4 });
    f = markDone(f, "rambam1", { y: 2020, m: 1, d: 5 });
    const saved = setup(f);
    const row = screen.getByTestId("learning-rambam1");
    expect(within(row).getByTestId("learning-rambam1-progress").textContent).toBe("1 of 4 days");
    expect(within(row).getByTestId("learning-rambam1-behind").textContent).toBe("3 days not marked");
    const learned = within(row).getByRole("button", { name: "Learned today" });
    expect(learned.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(learned);
    expect(saved.at(-1)?.plans[0].done).toEqual(["2020-01-05", "2020-01-07"]);
    expect(within(row).getByTestId("learning-rambam1-progress").textContent).toBe("2 of 4 days");
    expect(within(row).getByRole("button", { name: "Learned today" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(row).getByRole("button", { name: "Review later" }));
    const last = saved.at(-1)!;
    expect(last.plans[0].review).toEqual(["2020-01-07"]);
    expect(within(row).getByRole("button", { name: "Marked for review" })).toBeTruthy();
    expect(reviewCards(last, "en")).toHaveLength(1);
    // Unfollow removes the plan.
    fireEvent.click(within(row).getByRole("checkbox"));
    expect(saved.at(-1)?.plans).toEqual([]);
  });
});
