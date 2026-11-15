/**
 * R12.7 — timelines and the time checker, on synthetic claims: the undated
 * claim stands apart and is never placed; impossible dates, overlapping
 * exclusive roles and contradictory order are found as gaps (certain or
 * possible), never as edits; "what did I know on date X" shows only what
 * was recorded by then. The view in RTL: right = earliest, arrow keys,
 * axe clean. Clean reimplementation (design reference only).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { buildTimeline, checkTimeline, knownOn, spanFromText, spanWords, type TimeSpan, type TimelineClaim } from "../entities/temporal";
import { TimelineView } from "../views/timeline/TimelineView";

const day = (d: string): TimeSpan => ({ from: d, to: d, precision: "day" });
const year = (y: number): TimeSpan => ({ from: `${y}-01-01`, to: `${y}-12-31`, precision: "year" });
const src = (quote: string) => ({ note: "תיק/רחוב.md", anchor: "a1", quote });
const claim = (id: string, p: Partial<TimelineClaim>): TimelineClaim => ({ id, subject: "dana", predicate: "event", value: id, observed: "2024-01-01", source: src(id), ...p });

// Three synthetic claims about one person, one of them undated.
const THREE: TimelineClaim[] = [
  claim("c1", { predicate: "born", value: "נולדה", start: day("1980-03-02") }),
  claim("c2", { predicate: "role", value: "יו״ר הוועד", start: year(2010), end: year(2014), exclusive: true }),
  claim("c3", { value: "עברה לגור בעיר", source: src("עברה לגור בעיר, לא ידוע מתי") }),
];

describe("R12.7 timeline and checker", () => {
  it("3 claims: the undated one is shown apart, never dated", () => {
    const tl = buildTimeline(THREE);
    expect(tl.rows.map((r) => r.claim.id)).toEqual(["c1", "c2"]);
    expect(tl.undated.map((c) => c.id)).toEqual(["c3"]);
    expect(tl.undated[0].start).toBeUndefined();
  });

  it("finds overlapping exclusive roles: certain, possible, and none for consecutive terms", () => {
    const roles = [
      claim("r1", { subject: "dana", predicate: "role", value: "יו״ר הוועד", start: day("2010-01-01"), end: day("2014-06-30"), exclusive: true }),
      claim("r2", { subject: "yossi", predicate: "role", value: "יו״ר הוועד", start: day("2013-01-01"), end: day("2016-01-01"), exclusive: true }),
      claim("r3", { subject: "rina", predicate: "role", value: "יו״ר הוועד", start: year(2016), exclusive: true }),
      claim("r4", { subject: "avi", predicate: "role", value: "גזבר", start: day("2013-01-01"), exclusive: true }),
    ];
    const gaps = checkTimeline(roles).filter((g) => g.kind === "role-overlap");
    expect(gaps).toContainEqual(expect.objectContaining({ claims: ["r1", "r2"], certainty: "certain" }));
    // yossi ends 1.1.2016; rina starts some day in 2016: only possibly at once.
    expect(gaps).toContainEqual(expect.objectContaining({ claims: ["r2", "r3"], certainty: "possible" }));
    expect(gaps.some((g) => g.claims.includes("r4"))).toBe(false);
    expect(gaps.some((g) => g.claims.join() === "r1,r3")).toBe(false);
  });

  it("finds impossible dates and contradictory order, and nothing in a consistent timeline", () => {
    const bad = [
      claim("b1", { predicate: "born", start: day("1980-03-02") }),
      claim("b2", { predicate: "died", start: day("2020-05-01") }),
      claim("e1", { start: day("1975-01-01") }), // before birth
      claim("e2", { start: year(2022) }), // after death
      claim("e3", { start: day("2019-02-30") }), // no such day
      claim("e4", { start: day("2015-05-01"), end: day("2014-01-01") }), // ends before it starts
      claim("e5", { start: year(2001), after: "e6" }), // said to come after e6 ...
      claim("e6", { start: year(2005) }), // ... which is later
      claim("e7", { start: year(2020) }), // the year of death: only possibly after it, not a gap
    ];
    const kinds = checkTimeline(bad).map((g) => `${g.kind}:${g.claims.join(",")}:${g.certainty}`);
    expect(kinds.sort()).toEqual(["after-death:e2,b2:certain", "before-birth:e1,b1:certain", "end-before-start:e4:certain", "invalid-date:e3:certain", "order:e5,e6:certain"].sort());
    expect(checkTimeline(THREE)).toEqual([]);
  });

  it("what did I know on date X: only what was recorded by then, the latest record winning", () => {
    const cs = [
      claim("k1", { predicate: "role", value: "יו״ר", start: year(2010), observed: "2011-01-01" }),
      claim("k2", { predicate: "role", value: "יו״ר", start: year(2010), end: year(2012), observed: "2013-06-01" }),
      claim("k3", { value: "פגישה", start: day("2014-02-02"), observed: "2014-02-03" }),
    ];
    expect(knownOn(cs, "2012-01-01").map((c) => c.id)).toEqual(["k1"]);
    expect(knownOn(cs, "2013-12-31").map((c) => c.id)).toEqual(["k2"]);
    expect(knownOn(cs, "2020-01-01").map((c) => c.id)).toEqual(["k2", "k3"]);
  });

  it("dates in words keep their uncertainty; claims take dates from their quote (R12.6)", () => {
    expect(spanWords(year(2013), "he")).toBe("2013");
    expect(spanWords({ from: "2019-01-01", to: "2021-12-31", precision: "year" }, "he")).toBe("בין 2019 ל־2021");
    expect(spanFromText("בשנים 2019–2021 לא נסענו")).toEqual({ from: "2019-01-01", to: "2021-12-31", precision: "year" });
    expect(spanFromText("ללא תאריך")).toBeUndefined();
  });
});

describe("R12.7 timeline view in RTL", () => {
  beforeEach(() => {
    document.documentElement.dir = "rtl";
    document.documentElement.lang = "he";
  });
  afterEach(() => {
    document.documentElement.dir = "";
  });

  it("rows earliest first, the undated group apart, keyboard, as-of, axe clean", async () => {
    const opened: string[] = [];
    const cs = [...THREE, claim("c4", { value: "פגישה", start: day("2015-04-01"), observed: "2015-04-02" })];
    const { container } = render(
      <div dir="rtl">
        <TimelineView claims={cs} names={new Map([["dana", "דנה"]])} onOpenSource={(n, a) => opened.push(`${n}#^${a}`)} />
      </div>,
    );
    const rows = within(screen.getByTestId("timeline-rows")).getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("data-claim"))).toEqual(["c1", "c2", "c4"]);
    expect(within(screen.getByTestId("timeline-undated")).getAllByRole("listitem").map((r) => r.getAttribute("data-claim"))).toEqual(["c3"]);

    const buttons = within(screen.getByTestId("timeline-rows")).getAllByRole("button");
    buttons[0].focus();
    // RTL: the later row is to the left.
    fireEvent.keyDown(buttons[0], { key: "ArrowLeft" });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.keyDown(buttons[1], { key: "End" });
    expect(document.activeElement).toBe(buttons[2]);
    fireEvent.click(buttons[2]);
    expect(opened).toEqual(["תיק/רחוב.md#^a1"]);

    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);

    await act(async () => {
      fireEvent.change(screen.getByTestId("timeline-as-of"), { target: { value: "2020-01-01" } });
    });
    // c1–c3 were recorded in 2024: on 1.1.2020 only the meeting was known.
    expect(within(screen.getByTestId("timeline-rows")).getAllByRole("listitem").map((x) => x.getAttribute("data-claim"))).toEqual(["c4"]);
    expect(screen.queryByTestId("timeline-undated")).toBeNull();
  });
});
