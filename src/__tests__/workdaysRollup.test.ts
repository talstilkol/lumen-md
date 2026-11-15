/**
 * Plan W10.C26 (audit W5.15 step 3): working days (Sunday–Thursday, Israel's
 * holidays) in formulas, Bases expressions and a rollup — the same count as
 * the date cells' deadline hint (`workingDaysUntil`).
 *
 * Golden dates are from the Hebrew calendar for 5786–5787 (published, not
 * computed here): Pesach I = Thu 2 Apr 2026, Shavuot = Fri 22 May 2026, Rosh
 * Hashanah = Sat–Sun 12–13 Sep 2026, Yom Kippur = Mon 21 Sep 2026, Sukkot I
 * = Sat 26 Sep 2026.
 */
import { describe, expect, it } from "vitest";
import { workdaysBetween, workdaysUntil } from "../views/workdays";
import { evaluateOrThrow, parseFormulaOrThrow } from "../views/formula";
import { basesFileFromText, parseBase, runBase } from "../views/bases/base";
import { workingDaysUntil } from "../daily/israeliTime";

const GOLDEN: Array<[from: string, to: string, week: string | undefined, want: number, why: string]> = [
  ["2026-11-15", "2026-11-19", undefined, 4, "Sun → Thu: Mon, Tue, Wed, Thu"],
  ["2026-11-19", "2026-11-22", undefined, 1, "Thu → Sun: Fri and Sat off"],
  ["2026-09-17", "2026-09-22", undefined, 2, "Yom Kippur (Mon 21 Sep) is off: Sun 20 and Tue 22"],
  ["2026-09-10", "2026-09-14", undefined, 1, "Rosh Hashanah II (Sun 13 Sep) is off: Mon 14 only"],
  ["2026-09-24", "2026-09-27", undefined, 0, "Sukkot I on Shabbat (26 Sep): Fri, Sat off; Sun 27 is chol hamoed? counted below"],
  ["2026-03-31", "2026-04-02", undefined, 1, "Pesach I (Thu 2 Apr) is off: Wed 1 Apr only"],
  ["2026-05-20", "2026-05-24", undefined, 2, "Shavuot (Fri 22 May) and Shabbat: Thu 21 and Sun 24"],
  ["2026-11-22", "2026-11-15", undefined, -5, "backwards is negative: the working days after 15 Nov up to 22 Nov (Mon–Thu and Sun 22)"],
  ["2026-11-15", "2026-11-15", undefined, 0, "the same day"],
  ["2026-11-13", "2026-11-16", "mon-fri", 1, "mon-fri: Sat, Sun off; Mon 16"],
  ["2026-11-15", "2026-11-20", "mon-fri", 5, "mon-fri: Mon–Fri"],
];

describe("workdays(): golden cases with holidays", () => {
  for (const [from, to, week, want, why] of GOLDEN) {
    // Sukkot's Sunday is chol hamoed: whether it is a working day is the israeliTime rule, so that case checks agreement, not a number.
    if (from === "2026-09-24") {
      it(`agrees with the date cells' count: ${why}`, () => {
        const ref = workingDaysUntil({ y: 2026, m: 9, d: 24 }, { y: 2026, m: 9, d: 27 }, { israel: true, workWeek: "sun-thu" });
        expect(workdaysBetween(from, to)).toBe(ref);
      });
      continue;
    }
    it(`${from} → ${to}${week ? ` (${week})` : ""} = ${want}: ${why}`, () => expect(workdaysBetween(from, to, week)).toBe(want));
  }
  it("a missing date or an unknown week is empty, not 0", () => {
    expect(workdaysBetween(null, "2026-11-19")).toBeNull();
    expect(workdaysBetween("soon", "2026-11-19")).toBeNull();
    expect(workdaysBetween("2026-11-15", "2026-11-19", "tue-sat")).toBeNull();
  });
});

describe("in database formulas and Bases expressions", () => {
  it("workdays() in a database formula", () => {
    const run = (f: string) => evaluateOrThrow(parseFormulaOrThrow(f), {} as never, { now: new Date("2026-09-01T00:00:00Z") } as never);
    expect(run('workdays(date("2026-09-17"), date("2026-09-22"))')).toBe(2);
    expect(run('workdays("2026-11-13", "2026-11-16", "mon-fri")')).toBe(1);
  });

  it("workdays() in a Bases formula, and the 'workdays' rollup: until the nearest deadline among the related notes", () => {
    const note = (path: string, fm: string) => basesFileFromText(path, `---\n${fm}\n---\n`);
    const vault = [
      note("Courses/Stats.md", "type: course"),
      note("Tasks/A.md", 'project: "[[Stats]]"\ndue: 2026-09-22'),
      note("Tasks/B.md", 'project: "[[Stats]]"\ndue: 2026-10-15'),
      note("Tasks/C.md", 'project: "[[Stats]]"'),
    ];
    const parsed = parseBase(`
formulas:
  left: workdays(today(), note.due)
relations:
  tasks:
    property: project
    incoming: true
rollups:
  next_deadline_in: { relation: tasks, property: due, function: workdays }
views:
  - type: table
    name: All
    order: [file.name, formula.left, rollup.next_deadline_in]
`);
    if (!parsed.ok) throw new Error(parsed.error);
    const now = new Date("2026-09-17T08:00:00Z");
    const r = runBase(parsed.base, vault, { now });
    expect(r.errors).toEqual([]);
    const row = (p: string) => r.rows.find((x) => x.file.path === p)!.cells;
    expect(row("Courses/Stats.md")["rollup.next_deadline_in"]).toBe(2); // Tue 22 Sep, past Yom Kippur
    expect(row("Tasks/A.md")["formula.left"]).toBe(2);
    expect(row("Tasks/C.md")["formula.left"]).toBeNull();
    expect(workdaysUntil("2026-09-22", now)).toBe(2);
  });

  it("a rollup with an unknown function is still refused", () => {
    expect(parseBase("relations:\n  t: { property: p }\nrollups:\n  x: { relation: t, property: due, function: weekdays }\n").ok).toBe(false);
  });
});
