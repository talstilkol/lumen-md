/**
 * Plan W12.H5: "Create a syllabus…" from the palette. The calendar here is
 * SYNTHETIC (hand-written in an academic calendar's ICS shape, labelled as
 * such): two semesters, so the command picks the one for today. The real
 * published calendar's acceptance run is in syllabus.test.ts (owed to the
 * Mac until its fixture is downloaded).
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { draftSyllabus, SYLLABUS_FOLDER } from "../academic/createSyllabus";
import { parseSyllabus, semesterFor, semestersFromIcs } from "../academic/syllabus";

const ev = (uid: string, summary: string, from: string, toExclusive: string) =>
  ["BEGIN:VEVENT", `UID:${uid}`, `SUMMARY:${summary}`, `DTSTART;VALUE=DATE:${from.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${toExclusive.replace(/-/g, "")}`, "END:VEVENT"].join("\r\n");
/** SYNTHETIC academic calendar: hand-written for this test, not an institution's data. */
const SYNTHETIC_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//SYNTHETIC test calendar//HE",
  ev("s1", "פתיחת סמסטר א׳", "2026-10-18", "2026-10-19"),
  ev("b1", "חופשת חנוכה — אין לימודים", "2026-12-06", "2026-12-08"),
  ev("e1", "סיום סמסטר א׳", "2027-01-22", "2027-01-23"),
  ev("s2", "פתיחת סמסטר ב׳", "2027-03-07", "2027-03-08"),
  ev("e2", "סיום סמסטר ב׳", "2027-06-18", "2027-06-19"),
  "END:VCALENDAR",
].join("\r\n");

describe("the semester for today", () => {
  it("lists every semester the calendar names and picks the first that hasn't ended", () => {
    expect(semestersFromIcs(SYNTHETIC_ICS).map((s) => [s.start, s.end])).toEqual([
      ["2026-10-18", "2027-01-22"],
      ["2027-03-07", "2027-06-18"],
    ]);
    expect(semesterFor(SYNTHETIC_ICS, "2026-09-01")?.start).toBe("2026-10-18");
    expect(semesterFor(SYNTHETIC_ICS, "2026-11-15")?.start).toBe("2026-10-18");
    expect(semesterFor(SYNTHETIC_ICS, "2027-02-01")?.start).toBe("2027-03-07");
    expect(semesterFor(SYNTHETIC_ICS, "2027-07-01")).toBeNull();
  });
});

describe("the syllabus note the command writes", () => {
  it("one heading per teaching week of today's semester, under Syllabus/, named for the course", () => {
    const d = draftSyllabus({ ics: SYNTHETIC_ICS, title: "מבוא לסטטיסטיקה", lang: "he", israel: true, today: "2026-11-15" });
    if ("error" in d) throw new Error(d.error);
    expect(d.path).toBe(`${SYLLABUS_FOLDER}/מבוא לסטטיסטיקה.md`);
    expect(d.md.split("\n")[0]).toBe("# מבוא לסטטיסטיקה");
    expect(d.weeks[0]).toMatchObject({ n: 1, from: "2026-10-18" });
    expect(d.weeks.at(-1)?.to).toBe("2027-01-22");
    // The note parses back into the same weeks (readings go under each heading).
    expect(parseSyllabus(d.md).map((w) => w.n)).toEqual(d.weeks.map((w) => w.n));
    // Hanukkah's break shows as days off in its week.
    expect(d.md).toMatch(/אין לימודים: 6\.12, 7\.12/);
  });

  it("a file-safe name, the English template, and the reasons when there is nothing to write", () => {
    const d = draftSyllabus({ ics: SYNTHETIC_ICS, title: "Stats 1/2", lang: "en", israel: false, workWeek: "mon-fri", today: "2027-02-01" });
    if ("error" in d) throw new Error(d.error);
    expect(d.path).toBe("Syllabus/Stats 1-2.md");
    // Monday–Friday: the semester opens on a Sunday, so week 1 is the next Monday's.
    expect(d.md).toMatch(/^## Week 1: \n8\.3–14\.3$/m);
    expect(draftSyllabus({ ics: SYNTHETIC_ICS, title: "x", lang: "en", israel: true, today: "2027-07-01" })).toEqual({ error: "noSemester" });
    const allBreak = SYNTHETIC_ICS.replace("END:VCALENDAR", `${ev("b9", "אין לימודים", "2027-03-07", "2027-06-19")}\r\nEND:VCALENDAR`);
    expect(draftSyllabus({ ics: allBreak, title: "x", lang: "en", israel: true, today: "2027-02-01" })).toEqual({ error: "noWeeks" });
  });
});
