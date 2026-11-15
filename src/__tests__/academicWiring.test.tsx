/**
 * Plan W10.C27: the academic calendar (W7.8) wired to deadlines (W5.15)
 * and student mode (W5.13). The calendar is the synthetic one
 * (fixtures/academic/example-5787.json, marked as such): the real
 * institutions' files are still unverified (plan 10.O), so in the app the
 * wiring shows nothing until a person checks one.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { academicDeadline, examsLabel, semesterWeekLine, type AcademicYear } from "../academic/calendar";
import { CALENDARS, choose } from "../academic/registry";
import { dateCell } from "../daily/dateCells";
import { deadlineText } from "../daily/deadlineText";
import "../daily/israeliTimeStrings";
import { lectureNote, type Lecture } from "../student/lectureCore";
import { semesterOf } from "../student/lecture";
import { LectureRecorder, type RecorderDeps } from "../student/LectureRecorder";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EX: AcademicYear = JSON.parse(readFileSync(join(__dirname, "fixtures", "academic", "example-5787.json"), "utf8"));
const day = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
};
const IL = { israel: true, workWeek: "sun-thu" as const };
const settings = { israel: true, workWeek: "sun-thu" as const, hebrewDates: false, deadlineMove: "next" as const };

describe("deadlines in a break or an exam period get a reason (W10.C27)", () => {
  it("names the break and the first working day after it", () => {
    const r = academicDeadline(day("2027-04-20"), EX, IL);
    expect(r).toEqual({ kind: "break", name: "חופשת פסח", suggestion: { y: 2027, m: 5, d: 2 } }); // 1 May is Shabbat
  });

  it("names the exam period", () => {
    expect(academicDeadline(day("2027-01-27"), EX, IL)).toEqual({ kind: "exams", semester: "a", moed: "a" });
    expect(examsLabel("a", "a", "he")).toBe("מועד א׳ · סמסטר א׳");
    expect(examsLabel("b", "a", "en")).toBe("Moed A, semester B");
  });

  it("an ordinary teaching day, a day outside the year and an unverified file say nothing", () => {
    expect(academicDeadline(day("2026-11-10"), EX, IL)).toBeNull();
    expect(academicDeadline(day("2028-01-01"), EX, IL)).toBeNull();
    expect(academicDeadline(day("2027-04-20"), { ...EX, verified: false }, IL)).toBeNull();
  });

  it("the deadline cell carries it, and the deadline words say it", () => {
    const cell = dateCell("2027-04-20", { locale: "en", settings, deadline: true, academic: EX, today: day("2027-04-01") });
    expect(cell?.deadline?.academic).toEqual({ kind: "break", name: "חופשת פסח", suggestion: "2027-05-02" });
    expect(deadlineText(cell!.deadline!).academic).toBe("In the academic break (חופשת פסח): suggested 2027-05-02");
    const exam = dateCell("2027-01-27", { locale: "he", settings, deadline: true, academic: EX, today: day("2027-01-01") });
    expect(exam?.deadline?.academic).toEqual({ kind: "exams", label: "מועד א׳ · סמסטר א׳" });
    expect(deadlineText(exam!.deadline!).academic).toBe("During the exams: מועד א׳ · סמסטר א׳");
  });

  it("without a chosen calendar nothing changes", () => {
    const cell = dateCell("2027-04-20", { locale: "en", settings, deadline: true, today: day("2027-04-01") });
    expect(cell?.deadline?.academic).toBeUndefined();
    expect(deadlineText(cell!.deadline!).academic).toBeNull();
  });
});

describe("student mode shows the week of the semester (W10.C27)", () => {
  it("a teaching day's line, in Hebrew and English", () => {
    expect(semesterWeekLine(day("2026-11-24"), EX, "he")).toBe("שבוע 6 בסמסטר א׳ · תשפ״ז");
    expect(semesterWeekLine(day("2026-11-24"), EX, "en")).toBe("week 6 of semester A · תשפ״ז");
    expect(semesterWeekLine(day("2027-02-01"), EX)).toBe(""); // exams, not teaching
    expect(semesterWeekLine(day("2026-11-24"), { ...EX, verified: false })).toBe("");
  });

  it("the lecture note records the semester and its week", () => {
    const l: Lecture = { title: "Biology 3", date: "2026-11-24", audioPath: "audio/x.webm", durationSec: 60, sentences: [], important: new Set(), summary: [], cards: [], semester: { id: "a", week: 6, line: "שבוע 6 בסמסטר א׳ · תשפ״ז" } };
    const words = { recording: "Recording", summary: "Summary", cards: "Cards", noCards: "none", transcript: "Transcript", important: "Important" };
    const note = lectureNote(l, words);
    expect(note).toContain("\nsemester: a\nsemester-week: 6\ntags: [lecture]\n---\n");
    expect(note).toContain("# Biology 3\n\n_שבוע 6 בסמסטר א׳ · תשפ״ז_\n");
    expect(lectureNote({ ...l, semester: null }, words)).not.toContain("semester");
  });

  it("the recorder shows the line from its deps", async () => {
    const deps: RecorderDeps = {
      start: async () => ({ stop: async () => ({ audio: new Blob(["x"]), durationMs: 1 }), cancel: () => {} }),
      process: async () => ({ path: "x.md", cards: 0, important: 0 }),
      open: () => {},
      now: () => 0,
      semester: async () => ({ line: "שבוע 6 בסמסטר א׳ · תשפ״ז" }),
    };
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(LectureRecorder, { onClose: () => {}, deps })));
    await act(async () => {});
    expect(host.querySelector('[data-testid="lecture-semester-week"]')?.textContent).toBe("🎓 שבוע 6 בסמסטר א׳ · תשפ״ז");
    act(() => root.unmount());
    host.remove();
  });

  it("in the app, the repo's calendars are not verified yet, so student mode shows nothing (data: plan 10.O)", async () => {
    expect(CALENDARS.every((c) => !c.verified)).toBe(true);
    if (CALENDARS[0]) choose(CALENDARS[0]);
    expect(await semesterOf(new Date(2026, 10, 24), "he")).toBeNull();
    choose(null);
  });
});
