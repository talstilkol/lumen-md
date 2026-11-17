/**
 * R12.6 (audit r3: suggestDueDate was used nowhere): a task's due date from
 * its free text, Hebrew and English, wired into the task parser
 * (`dueSuggested`, only when the line has no 📅 and the parse knows today)
 * and into inbox triage (the model's day, else the one the words name).
 * Today in these tests is Monday 16.11.2026.
 */
import { describe, expect, it } from "vitest";
import { dueFromText } from "../tasks/dueFromText";
import { parseTaskLine, tasksInNote } from "../tasks/taskParser";
import { inboxEntries, triagedEntry } from "../capture/triage";

const TODAY = "2026-11-16"; // a Monday

describe("dueFromText (R12.6)", () => {
  it("Hebrew: a full date, relative days and a weekday deadline", () => {
    expect(dueFromText("להגיש את הדוח עד 1/2/2027", TODAY)).toBe("2027-02-01");
    expect(dueFromText("להתקשר לרופא מחר", TODAY)).toBe("2026-11-17");
    expect(dueFromText("לסיים היום", TODAY)).toBe("2026-11-16");
    expect(dueFromText("לשלם מחרתיים", TODAY)).toBe("2026-11-18");
    expect(dueFromText("לשלוח את הטופס עד יום חמישי", TODAY)).toBe("2026-11-19");
    expect(dueFromText("פגישה ביום ראשון", TODAY)).toBe("2026-11-22");
    expect(dueFromText("לקנות חלות בשבת", TODAY)).toBe("2026-11-21");
    expect(dueFromText("פגישה ביום שני", TODAY)).toBe("2026-11-23"); // the next Monday, not today
    expect(dueFromText("להגיש ב-10 בדצמבר 2026", TODAY)).toBe("2026-12-10");
  });

  it("English: a full date, relative days and a weekday deadline", () => {
    expect(dueFromText("submit the report by December 3, 2026", TODAY)).toBe("2026-12-03");
    expect(dueFromText("finish by 2026-12-05", TODAY)).toBe("2026-12-05");
    expect(dueFromText("call mom tomorrow", TODAY)).toBe("2026-11-17");
    expect(dueFromText("pay rent the day after tomorrow", TODAY)).toBe("2026-11-18");
    expect(dueFromText("email Dana tonight", TODAY)).toBe("2026-11-16");
    expect(dueFromText("send the draft by Friday", TODAY)).toBe("2026-11-20");
    expect(dueFromText("Review PR next Tuesday", TODAY)).toBe("2026-11-17");
  });

  it("names no day: no suggestion (no guesses, no past days, no bare years or weekdays)", () => {
    expect(dueFromText("לקנות חלב", TODAY)).toBeNull();
    expect(dueFromText("buy milk", TODAY)).toBeNull();
    expect(dueFromText("לסגור את התיק בשנת 2027", TODAY)).toBeNull();
    expect(dueFromText("Read about Friday the 13th", TODAY)).toBeNull();
    expect(dueFromText("לבדוק מה קרה אתמול", TODAY)).toBeNull();
    expect(dueFromText("check the 1/2/2020 invoice", TODAY)).toBeNull();
    expect(dueFromText("call mom tomorrow", "not-a-date")).toBeNull();
  });
});

describe("the task parser suggests a due date from the words (R12.6 wiring)", () => {
  it("a line without 📅 gets dueSuggested when the parse knows today; a 📅 always wins", () => {
    expect(parseTaskLine("- [ ] להתקשר לרופא מחר", "a.md", 0, null, { today: TODAY })).toMatchObject({ due: null, dueSuggested: "2026-11-17" });
    expect(parseTaskLine("- [ ] send the draft by Friday #work", "a.md", 0, null, { today: TODAY })).toMatchObject({ due: null, dueSuggested: "2026-11-20", tags: ["#work"] });
    expect(parseTaskLine("- [ ] call mom tomorrow 📅 2026-11-30", "a.md", 0, null, { today: TODAY })?.dueSuggested).toBeUndefined();
    expect(parseTaskLine("- [ ] לקנות חלב", "a.md", 0, null, { today: TODAY })?.dueSuggested).toBeNull();
    // Without today nothing is suggested (the vault index parses without a clock).
    expect(parseTaskLine("- [ ] call mom tomorrow")?.dueSuggested).toBeUndefined();
    const tasks = tasksInNote("t.md", "# Week\n- [ ] לשלוח את הטופס עד יום חמישי\n- [ ] buy milk\n", { today: TODAY });
    expect(tasks.map((t) => t.dueSuggested)).toEqual(["2026-11-19", null]);
  });

  it("inbox triage: a task the model gave no day gets the one its words name", () => {
    const [e] = inboxEntries("- [[Daily/2026-11-16]] 09:30 to send the draft by Friday\n");
    expect(triagedEntry(e, { kind: "task", due: null, tags: [] }, TODAY)).toBe("- [[Daily/2026-11-16]] 09:30 [ ] to send the draft by Friday 📅 2026-11-20");
    // The model's day wins; without today nothing is added.
    expect(triagedEntry(e, { kind: "task", due: "2026-11-25", tags: [] }, TODAY)).toContain("📅 2026-11-25");
    expect(triagedEntry(e, { kind: "task", due: null, tags: [] })).toBe("- [[Daily/2026-11-16]] 09:30 [ ] to send the draft by Friday");
  });
});
