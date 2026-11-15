/**
 * R12.6 — dates in free Hebrew text, on a synthetic gold set
 * (fixtures/dates-he/gold.synthetic.json: invented sentences; the
 * holiday rows are marked `anchor` and shared with W10.E76). Acceptance:
 * ≥ 98% of the rows exactly right; "2023" alone, a day and month without a
 * year, and a relative word without the note's date are not read.
 * Clean reimplementation (design reference only).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { extractDates, suggestDueDate } from "../daily/hebrewDates";

interface Row {
  text: string;
  reference?: string;
  anchor?: boolean;
  expect: Array<{ from: string; to: string; precision: string; holiday?: string }>;
}
const gold = JSON.parse(readFileSync("src/__tests__/fixtures/dates-he/gold.synthetic.json", "utf8")) as { cases: Row[] };

const got = (r: Row) => extractDates(r.text, { reference: r.reference }).map((m) => ({ from: m.from, to: m.to, precision: m.precision, ...(m.holiday ? { holiday: m.holiday } : {}) }));

describe("R12.6 Hebrew dates (synthetic gold)", () => {
  it("≥ 98% of the rows exactly right", () => {
    const wrong = gold.cases.filter((r) => JSON.stringify(got(r)) !== JSON.stringify(r.expect)).map((r) => ({ text: r.text, want: r.expect, got: got(r) }));
    const score = (gold.cases.length - wrong.length) / gold.cases.length;
    expect(gold.cases.length).toBeGreaterThanOrEqual(50);
    expect({ score: score >= 0.98, wrong }).toEqual({ score: true, wrong: score >= 0.98 ? wrong : [] });
  });

  it("the holiday anchors are all right (W10.E76 uses them)", () => {
    const anchors = gold.cases.filter((r) => r.anchor);
    expect(anchors.length).toBeGreaterThanOrEqual(11);
    for (const r of anchors) expect(got(r), r.text).toEqual(r.expect);
  });

  it("does not invent: a bare year, a day and month alone, a relative word without the note's date", () => {
    expect(extractDates("2023")).toEqual([]);
    expect(extractDates("ראינו 2023 ציפורים")).toEqual([]);
    expect(extractDates("נדבר ב-10 ביולי")).toEqual([]);
    expect(extractDates("אתמול")).toEqual([]);
    expect(extractDates("בשנת 2023")).toHaveLength(1);
  });

  it("offsets point at the words, prefix letters included", () => {
    const text = "המסמך נחתם ב-10 ביולי 2023 במשרד";
    const [m] = extractDates(text);
    expect(text.slice(m.start, m.end)).toBe("ב-10 ביולי 2023");
  });

  it("a task's due date from free text", () => {
    expect(suggestDueDate("להגיש את הדוח עד 1/2/2024", "2024-01-10")).toBe("2024-02-01");
    expect(suggestDueDate("להתקשר לרופא מחר", "2026-11-15")).toBe("2026-11-16");
    expect(suggestDueDate("לקנות חלב", "2026-11-15")).toBeNull();
    expect(suggestDueDate("לסגור את התיק בשנת 2027", "2026-11-15")).toBeNull(); // a year is not a due day
  });
});
