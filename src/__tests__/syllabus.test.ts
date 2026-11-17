/**
 * Plan W12.H5: an academic study plan, a syllabus by the semester's
 * teaching weeks from the institution's academic calendar (ICS), with
 * readings and deadlines.
 *
 * The acceptance check is a 13-week syllabus on one university's PUBLISHED
 * calendar, with the source named in the fixture. That calendar has to be
 * downloaded (no network here), so it is owed to the Mac: drop the ICS and
 * its meta into src/__tests__/fixtures/academic-calendar/ and the last
 * describe runs. Until then the calendar below is SYNTHETIC, written by
 * hand in an academic calendar's ICS shape and labelled as such, not any
 * institution's data.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkDeadlines, markReading, parseSyllabus, semesterFromIcs, syllabusTemplate, teachingWeeks } from "../academic/syllabus";

const ISRAEL = { israel: true, workWeek: "sun-thu" as const };
const ev = (uid: string, summary: string, from: string, toExclusive: string) =>
  ["BEGIN:VEVENT", `UID:${uid}`, `SUMMARY:${summary}`, `DTSTART;VALUE=DATE:${from.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${toExclusive.replace(/-/g, "")}`, "END:VEVENT"].join("\r\n");
/** SYNTHETIC academic calendar: hand-written for this test. */
const SYNTHETIC_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//SYNTHETIC test calendar//HE",
  ev("s", "פתיחת סמסטר א׳", "2026-10-18", "2026-10-19"),
  ev("b1", "חופשת חנוכה — אין לימודים", "2026-12-06", "2026-12-08"),
  ev("b2", "אין לימודים (שבוע מבחני אמצע)", "2026-12-27", "2027-01-01"),
  ev("x", "יום הסטודנט", "2026-11-11", "2026-11-12"),
  ev("e", "סיום סמסטר א׳", "2027-01-22", "2027-01-23"),
  "END:VCALENDAR",
].join("\r\n");

describe("the semester's teaching weeks from the academic calendar (SYNTHETIC calendar)", () => {
  it("reads the start, the end and the breaks; a week that is all break isn't counted: 13 weeks", () => {
    const sem = semesterFromIcs(SYNTHETIC_ICS)!;
    expect(sem.start).toBe("2026-10-18");
    expect(sem.end).toBe("2027-01-22");
    expect(sem.breaks.map((b) => [b.from, b.to])).toEqual([
      ["2026-12-06", "2026-12-07"],
      ["2026-12-27", "2026-12-31"],
    ]);
    const weeks = teachingWeeks(sem, ISRAEL);
    expect(weeks).toHaveLength(13);
    expect(weeks[0]).toMatchObject({ n: 1, from: "2026-10-18", to: "2026-10-24" });
    expect(weeks.at(-1)).toMatchObject({ n: 13, from: "2027-01-17", to: "2027-01-22" });
    // Every week starts on a Sunday; the break week (27–31.12) is not among them.
    expect(weeks.every((w) => new Date(`${w.from}T12:00:00Z`).getUTCDay() === 0)).toBe(true);
    expect(weeks.some((w) => w.from === "2026-12-27")).toBe(false);
    // Chanukah's two days off are listed in their week, which still counts.
    expect(weeks.find((w) => w.from === "2026-12-06")?.off.map((o) => o.day)).toEqual(["2026-12-06", "2026-12-07"]);
  });

  it("Monday–Friday weeks elsewhere start on Monday", () => {
    const weeks = teachingWeeks({ start: "2026-09-07", end: "2026-09-25", breaks: [] }, { israel: false, workWeek: "mon-fri" });
    expect(weeks.map((w) => w.from)).toEqual(["2026-09-07", "2026-09-14", "2026-09-21"]);
  });
});

describe("the syllabus note", () => {
  const sem = semesterFromIcs(SYNTHETIC_ICS)!;
  const weeks = teachingWeeks(sem, ISRAEL);

  it("a template with one heading per teaching week, its dates and its days off", () => {
    const md = syllabusTemplate(weeks, "he", "מבוא לסוציולוגיה");
    expect(md.split("\n").filter((l) => l.startsWith("## שבוע "))).toHaveLength(13);
    expect(md).toContain("6.12–12.12 · אין לימודים: 6.12, 7.12");
  });

  it("readings marked read change only their box; a deadline on Shabbat gets a suggested day, the note's date stays", () => {
    const md = ["# קורס", "## שבוע 5: דורקהיים", "- [ ] Durkheim, The Rules, ch. 1", "- [x] Giddens ch. 2", "- דדליין: 2026-11-21 עבודה 1", "## שבוע 6", "- הגשה: 2026-11-24 תרגיל"].join("\n");
    const s = parseSyllabus(md);
    expect(s.map((w) => [w.n, w.topic, w.readings.length, w.deadlines.length])).toEqual([
      [5, "דורקהיים", 2, 1],
      [6, "", 0, 1],
    ]);
    const read = markReading(md, 2);
    expect(read.split("\n")[2]).toBe("- [x] Durkheim, The Rules, ch. 1");
    expect(read.split("\n").filter((l, i) => l !== md.split("\n")[i])).toHaveLength(1);
    expect(markReading(md, 1)).toBe(md);
    const d = checkDeadlines(md, weeks, ISRAEL);
    // 21.11.2026 is Shabbat: the next working day in Israel is Sunday 22.11.
    expect(d[0]).toMatchObject({ date: "2026-11-21", suggest: "2026-11-22", inWeek: 5 });
    expect(d[1]).toMatchObject({ date: "2026-11-24", suggest: null, inWeek: 6 });
    expect(md).toContain("2026-11-21");
  });
});

const DIR = join(__dirname, "fixtures/academic-calendar");
const real = existsSync(DIR) ? readdirSync(DIR).filter((f: string) => f.endsWith(".json")) : [];
describe("a 13-week syllabus on a university's published calendar (fixture downloaded outside the app)", () => {
  // skip-reason: the university calendars are downloaded outside the app; without the fixture there is nothing to compare | task: W12.H5 | until: 2027-05-16
  it.skipIf(real.length === 0)("every week falls on the dates the published calendar gives", () => {
    for (const f of real) {
      // meta: { source (URL of the published calendar), institution, ics, start, end, weeks, breaks?: [[from, to]] } — copied by hand from the publication.
      const meta = JSON.parse(readFileSync(join(DIR, f), "utf8"));
      expect(meta.source, f).toMatch(/^https:\/\//);
      const sem = semesterFromIcs(readFileSync(join(DIR, meta.ics), "utf8"), { after: meta.start })!;
      expect([sem.start, sem.end], f).toEqual([meta.start, meta.end]);
      const weeks = teachingWeeks(sem, ISRAEL);
      expect(weeks.length, f).toBe(meta.weeks);
      for (const [from, to] of meta.breaks ?? []) expect(weeks.some((w) => w.from >= from && w.to <= to), `${f}: a teaching week inside ${from}–${to}`).toBe(false);
    }
  });
});
