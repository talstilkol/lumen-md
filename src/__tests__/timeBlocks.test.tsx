/**
 * Plan W12.H7: time blocks in the daily note, the day's timeline, and
 * Shabbat / yom tov as blocked time (with W12.H8's times).
 *
 *  - `- 09:00–10:30 …` lines are blocks; moving one rewrites only its times.
 *  - The calendar subscriptions' block (W7.20) gives read-only events, not blocks.
 *  - A block on Friday after candle lighting is marked, with a suggestion;
 *    it is never moved by itself.
 *  - The timeline in RTL: dragging a block (and the keyboard) changes the
 *    line in the note. The browser e2e of the same is owed to the Mac.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { calendarEvents, moveBlock, parseBlocks, restConflicts } from "../daily/timeBlocks";
import { cityById, clock, type City } from "../daily/shabbatTimes";
import { DayTimeline } from "../ui/DayTimeline";
import "../ui/calendarPanelStrings";

const NOTE = ["# יום שישי", "", "- 09:00–10:30 כתיבת הפרק", "- [ ] 14:00-15:00 שיחה לבנק", "```", "- 08:00–09:00 not a block (code)", "```", "<!-- lumen-calendar:start -->", "## לוח שנה", "- 11:00–12:00 הרצאה · אולם 3", "<!-- lumen-calendar:end -->", "- 19:00–20:00 סיכום השבוע", ""].join("\n");
const FRI = { y: 2026, m: 11, d: 20 };
const jlm = cityById("jerusalem") as City;

afterEach(() => {
  cleanup();
  document.documentElement.dir = "";
});

describe("blocks in the note", () => {
  it("parses list lines that start with a time range, not code and not the calendar's events", () => {
    const b = parseBlocks(NOTE);
    expect(b.map((x) => [x.line, x.start, x.end, x.text])).toEqual([
      [2, 540, 630, "כתיבת הפרק"],
      [3, 840, 900, "שיחה לבנק"],
      [11, 1140, 1200, "סיכום השבוע"],
    ]);
    expect(calendarEvents(NOTE)).toEqual([{ time: "11:00", endTime: "12:00", summary: "הרצאה · אולם 3" }]);
  });

  it("moving a block changes only its times, keeping its dash and task box", () => {
    const moved = moveBlock(NOTE, 3, 15 * 60 + 30, 16 * 60 + 30);
    const a = NOTE.split("\n");
    const b = moved.split("\n");
    expect(b[3]).toBe("- [ ] 15:30-16:30 שיחה לבנק");
    expect(b.filter((l, i) => l !== a[i])).toEqual([b[3]]);
    expect(moveBlock(NOTE, 0, 60, 120)).toBe(NOTE); // not a block
    expect(moveBlock("a\r\n- 09:00–10:00 x\r\n", 1, 600, 660)).toBe("a\r\n- 10:00–11:00 x\r\n");
  });
});

describe("Shabbat as blocked time (times from W12.H8)", () => {
  it("a Friday block after candle lighting in Jerusalem is marked, with an earlier slot suggested; the morning block is not", () => {
    const c = restConflicts(parseBlocks(NOTE), FRI, jlm);
    expect(c.map((x) => x.block.text)).toEqual(["סיכום השבוע"]);
    expect(c[0].rest.why).toBe("shabbat");
    // Candle lighting on 20.11.2026 in Jerusalem is before 16:00; the suggestion ends 15 minutes before it.
    expect(clock(c[0].rest.start, jlm.tz) < "16:00").toBe(true);
    expect(c[0].suggest.day).toEqual(FRI);
    expect(c[0].suggest.end - c[0].suggest.start).toBe(60);
    // A Saturday block is suggested for Sunday.
    const sat = restConflicts(parseBlocks("- 10:00–11:00 x"), { y: 2026, m: 11, d: 21 }, jlm);
    expect(sat[0].suggest.day).toEqual({ y: 2026, m: 11, d: 22 });
    // No city chosen: no times, nothing marked.
    expect(restConflicts(parseBlocks(NOTE), { y: 2026, m: 11, d: 18 }, jlm)).toEqual([]);
  });
});

describe("the timeline (RTL)", () => {
  it("dragging a block down by an hour rewrites its line; the keyboard moves it by 15 minutes; the Shabbat block is marked", () => {
    document.documentElement.dir = "rtl";
    let note = NOTE;
    const view = render(<DayTimeline note={note} day={FRI} city={jlm} events={calendarEvents(note)} onChange={(n) => (note = n)} hourPx={40} />);
    const blocks = screen.getAllByTestId("timeline-block");
    expect(blocks).toHaveLength(3);
    expect(screen.getAllByTestId("timeline-event")).toHaveLength(1);
    expect(blocks[2].getAttribute("data-conflict")).toBe("rest");
    expect(blocks[0].getAttribute("data-conflict")).toBeNull();
    expect(screen.getByTestId("timeline-rest").textContent).toMatch(/ירושלים/);

    act(() => {
      fireEvent.pointerDown(blocks[0], { clientY: 100, pointerId: 1 });
    });
    act(() => {
      fireEvent.pointerMove(blocks[0], { clientY: 140, pointerId: 1 });
    });
    act(() => {
      fireEvent.pointerUp(blocks[0], { clientY: 140, pointerId: 1 });
    });
    expect(note.split("\n")[2]).toBe("- 10:00–11:30 כתיבת הפרק");

    view.rerender(<DayTimeline note={note} day={FRI} city={jlm} onChange={(n) => (note = n)} hourPx={40} />);
    fireEvent.keyDown(screen.getAllByTestId("timeline-block")[1], { key: "ArrowUp" });
    expect(note.split("\n")[3]).toBe("- [ ] 13:45-14:45 שיחה לבנק");
    view.rerender(<DayTimeline note={note} day={FRI} city={jlm} onChange={(n) => (note = n)} hourPx={40} />);
    fireEvent.keyDown(screen.getAllByTestId("timeline-block")[1], { key: "ArrowDown", shiftKey: true });
    expect(note.split("\n")[3]).toBe("- [ ] 13:45-15:00 שיחה לבנק");

    // The suggestion's button moves the Shabbat block only when pressed.
    view.rerender(<DayTimeline note={note} day={FRI} city={jlm} onChange={(n) => (note = n)} hourPx={40} />);
    const before = note;
    expect(screen.getByTestId("timeline-conflicts")).toBeTruthy();
    expect(note).toBe(before);
    fireEvent.click(screen.getByRole("button", { name: /הזזה|Move/ }));
    expect(parseBlocks(note).find((b) => b.text === "סיכום השבוע")!.end).toBeLessThan(16 * 60);
  });
});
