/**
 * W10.C4–C6, wave g5: the calendar screens as a user meets them.
 *   C4 — Settings → Calendar: an address that is not https is named at its
 *        field; a request keeps its button busy (and focused) and runs once;
 *        the tab says where the password is kept; a subscription shows its
 *        host, never its private address; removing one moves focus on.
 *   C5 — the conflict dialog marks what differs (not by colour alone), reads
 *        a Hebrew path left to right and shows the due date as a date.
 *   C6 — a SYNTHETIC sample ICS file (fixtures/calendar/sample-he.ics: a
 *        weekly seminar with an exception, a three-day conference, a UTC
 *        call) fills the daily note; "Refresh today's note" replaces only the
 *        calendar block; the template's field can be added from the tab.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CalendarSettings, addCalendarField, feedHost } from "../ui/settings/CalendarSettings";
import { CalendarConflictDialog, conflictDiffers } from "../ui/CalendarConflictDialog";
import { calendarBlockFor, refreshCalendarInNote } from "../calendar/app";
import { saveSubscriptions } from "../calendar/config";
import { renderTemplate, dayOf } from "../daily/dailyNote";
import { BLOCK_END, BLOCK_START } from "../calendar/dailyEvents";
import { __resetSecretStore } from "../lib/secretStore";
import { useAppStore } from "../store/useStore";
import type { Conflict } from "../calendar/taskSync";

const ICS = readFileSync(join(__dirname, "fixtures/calendar/sample-he.ics"), "utf8").replace(/\r?\n/g, "\r\n");
const labels = { heading: "Today's calendar", allDay: "All day", none: "No events", failed: (n: string) => `${n}: could not be read` };
const feedFetch = (urls: string[] = []) => (async (u: RequestInfo | URL) => (urls.push(String(u)), new Response(ICS))) as typeof fetch;

beforeEach(() => {
  localStorage.clear();
  __resetSecretStore();
  document.body.innerHTML = "";
});
afterEach(() => __resetSecretStore());

const stubApp = (over: Record<string, unknown> = {}) =>
  (async () => ({ testConnection: vi.fn(), findCalendars: vi.fn(), syncTasksNow: vi.fn(), ...over })) as never;

describe("C4: Settings → Calendar, as used", () => {
  it("names an address that is not https at its field, after the user leaves it", () => {
    render(<CalendarSettings calendarApp={stubApp()} />);
    const url = screen.getByTestId("cal-url");
    fireEvent.change(url, { target: { value: "http://dav.example/cal/" } });
    expect(screen.queryByTestId("cal-url-error")).toBeNull(); // not while typing
    fireEvent.blur(url);
    expect(screen.getByTestId("cal-url-error").textContent).toMatch(/https/);
    expect(url.getAttribute("aria-invalid")).toBe("true");
    expect(url.getAttribute("aria-describedby")).toBe("cal-url-err");
    fireEvent.change(url, { target: { value: "https://dav.example/cal/" } });
    expect(screen.queryByTestId("cal-url-error")).toBeNull();
    fireEvent.change(url, { target: { value: "http://localhost:5232/u/cal/" } });
    expect(screen.queryByTestId("cal-url-error")).toBeNull();
  });

  it("a request keeps its button busy and focused, runs once, then says what happened", async () => {
    let answer!: (v: unknown) => void;
    const testConnection = vi.fn(() => new Promise((r) => (answer = r)));
    render(<CalendarSettings calendarApp={stubApp({ testConnection })} />);
    const test = screen.getByTestId("cal-test");
    test.focus();
    await act(async () => fireEvent.click(test));
    expect(test.getAttribute("aria-busy")).toBe("true");
    expect(test.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByTestId("cal-sync").getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(test); // aria-disabled, not disabled: focus stays
    expect(screen.getByTestId("cal-message").textContent).toMatch(/Working/);
    await act(async () => fireEvent.click(test));
    expect(testConnection).toHaveBeenCalledTimes(1);
    await act(async () => answer({ ok: false, reason: "cors" }));
    expect(test.getAttribute("aria-busy")).toBeNull();
    expect(screen.getByTestId("cal-message").textContent).toMatch(/CORS/);
    expect(screen.getByTestId("cal-message").getAttribute("data-ok")).toBe("false");
  });

  it("says where the password is kept", () => {
    render(<CalendarSettings calendarApp={stubApp()} />);
    // No IndexedDB and no keychain here: the store's visible plain mode (plan 2.5).
    expect(screen.getByTestId("cal-store").textContent).toMatch(/not encrypted/);
    expect(screen.getByTestId("cal-password").getAttribute("aria-describedby")).toBe("cal-store");
  });

  it("lists a subscription by name and host, never its private address; removing moves focus on, never to <body>", async () => {
    const secret = "https://calendar.example.org/private-8f3a9c1d/basic.ics";
    await saveSubscriptions([
      { id: "a", name: "חגים", url: "webcal://hol.example.org/h.ics" },
      { id: "b", name: "Work", url: secret },
    ]);
    render(<CalendarSettings calendarApp={stubApp()} />);
    const list = screen.getByTestId("cal-subs");
    expect(list.textContent).toContain("calendar.example.org");
    expect(document.body.innerHTML).not.toContain("private-8f3a9c1d");
    const removes = () => [...list.querySelectorAll("button")];
    removes()[0].focus();
    await act(async () => {
      fireEvent.click(removes()[0]);
      await Promise.resolve();
    });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Remove Work");
    await act(async () => {
      fireEvent.click(removes()[0]);
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(screen.getByTestId("cal-ics-name"));
  });

  it("adding a subscription by Enter clears the fields and keeps focus in the form", async () => {
    render(<CalendarSettings calendarApp={stubApp()} />);
    fireEvent.change(screen.getByTestId("cal-ics-name"), { target: { value: "חגים" } });
    fireEvent.change(screen.getByTestId("cal-ics-url"), { target: { value: "webcal://hol.example.org/h.ics" } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId("cal-ics-url").closest("form")!);
      await Promise.resolve();
    });
    expect(screen.getByTestId("cal-subs").textContent).toContain("חגים");
    expect((screen.getByTestId("cal-ics-url") as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(screen.getByTestId("cal-ics-name"));
    expect(feedHost("webcal://hol.example.org/h.ics")).toBe("hol.example.org");
  });

  it("its buttons and fields have a visible box (not bare under preflight)", () => {
    render(<CalendarSettings calendarApp={stubApp()} />);
    for (const id of ["cal-save", "cal-test", "cal-url", "cal-ics-add"]) {
      expect(screen.getByTestId(id).style.border, id).toMatch(/1px solid/);
      expect(screen.getByTestId(id).style.padding, id).not.toBe("");
    }
  });
});

describe("C5: the conflict dialog shows what differs", () => {
  const conflict: Conflict = {
    kind: "conflict",
    uid: "u1",
    why: "both-changed",
    local: { path: "Projects/חתונה.md", line: 3, uid: "u1", todo: { summary: "להזמין אולם", due: "2026-11-20", start: null, completed: false, completedOn: null } } as never,
    remote: { uid: "u1", href: "x", etag: '"2"', todo: { summary: "להזמין אולם", due: "2026-11-22", start: null, completed: false, completedOn: null } } as never,
  };

  it("marks only the fields that differ, with text as well as a bar", () => {
    render(<CalendarConflictDialog conflict={conflict} onResolve={() => {}} />);
    const marked = (side: string) => [...screen.getByTestId(side).querySelectorAll("[data-differs]")].map((e) => e.textContent ?? "");
    expect(marked("calendar-conflict-here")).toHaveLength(1);
    expect(marked("calendar-conflict-there")).toHaveLength(1);
    expect(marked("calendar-conflict-here")[0]).toMatch(/Due .*20.*\(differs\)/);
    expect(marked("calendar-conflict-there")[0]).toMatch(/Due .*22/);
    expect(conflictDiffers(null, (conflict.remote as { todo: never }).todo)).toEqual(new Set(["summary", "due", "state"]));
  });

  it("shows the due date as a date, not as 2026-11-20, and the path left to right", () => {
    render(<CalendarConflictDialog conflict={conflict} onResolve={() => {}} />);
    const here = screen.getByTestId("calendar-conflict-here").textContent ?? "";
    expect(here).not.toContain("2026-11-20");
    expect(here).toMatch(/2026/);
    const path = screen.getByTestId("calendar-conflict-path");
    expect(path.tagName).toBe("BDI");
    expect(path.getAttribute("dir")).toBe("ltr");
    // Portalled to <body>, outside the app's root: it sets its own text colour (dark mode).
    expect((document.querySelector(".prompt-dialog") as HTMLElement).style.color).toMatch(/--fg/);
  });
});

describe("C6: a sample ICS file in the daily note", () => {
  it("fills {{calendar}} with the day's events: a weekly seminar, a conference day, a UTC call in local time", async () => {
    const urls: string[] = [];
    const block = await calendarBlockFor("2026-11-20", { feeds: [{ name: "University", url: "webcal://cal.example/u.ics" }], fetch: feedFetch(urls), timeZone: "Asia/Jerusalem", labels });
    const note = renderTemplate("# {{date}}\n\n{{calendar}}\n", dayOf(new Date(2026, 10, 20)), "he", { calendar: block });
    expect(urls).toEqual(["https://cal.example/u.ics"]);
    expect(note).toContain("- All day כנס ספרות עברית");
    expect(note).toContain("- 09:15–10:45 סמינר מחלקתי: עיבוד שפה בעברית · חדר 210, בניין גילמן");
    expect(note).toContain("- 15:00–15:30 Call with Berlin");
    expect(note).not.toContain("מוצאי שבת");
  });

  it("honours the feed's exception (EXDATE) and the conference's last day (DTEND is exclusive)", async () => {
    const on = (day: string) => calendarBlockFor(day, { feeds: [{ name: "U", url: "https://cal.example/u.ics" }], fetch: feedFetch(), timeZone: "Asia/Jerusalem", labels });
    expect(await on("2026-11-13")).toContain("- No events");
    expect(await on("2026-11-27")).toContain("סמינר מחלקתי");
    expect(await on("2026-11-21")).toContain("כנס ספרות עברית");
    expect(await on("2026-11-22")).not.toContain("כנס ספרות עברית");
  });

  it("refreshing today's note replaces only the calendar block; the user's own text is untouched", async () => {
    const before = `# 20 Nov\n\nMy plan for today.\n\n${BLOCK_START}\n## Today's calendar\n- 08:00 old event\n${BLOCK_END}\n\n- [ ] write the report 📅 2026-11-20\n`;
    const files: Record<string, string> = { "Daily/2026-11-20.md": before };
    const vault = { read: async (p: string) => files[p] ?? null, write: vi.fn(async (p: string, c: string) => void (files[p] = c)) };
    const r = await refreshCalendarInNote("Daily/2026-11-20.md", "2026-11-20", { feeds: [{ name: "U", url: "https://cal.example/u.ics" }], fetch: feedFetch(), timeZone: "Asia/Jerusalem", labels, vault });
    expect(r).toEqual({ kind: "refreshed", path: "Daily/2026-11-20.md", events: 3 });
    const after = files["Daily/2026-11-20.md"];
    expect(after).not.toContain("old event");
    expect(after).toContain("Call with Berlin");
    expect(after.slice(0, after.indexOf(BLOCK_START))).toBe(before.slice(0, before.indexOf(BLOCK_START)));
    expect(after.slice(after.indexOf(BLOCK_END))).toBe(before.slice(before.indexOf(BLOCK_END)));
    // A note without a block gets one under its heading.
    files["Daily/2026-11-21.md"] = "# 21 Nov\n\nnotes\n";
    await refreshCalendarInNote("Daily/2026-11-21.md", "2026-11-21", { feeds: [{ name: "U", url: "https://cal.example/u.ics" }], fetch: feedFetch(), timeZone: "Asia/Jerusalem", labels, vault });
    expect(files["Daily/2026-11-21.md"]).toMatch(/^# 21 Nov\n\n<!-- lumen-calendar:start -->\n## Today's calendar\n- All day כנס ספרות עברית\n- 20:00 מוצאי שבת: הופעה\n<!-- lumen-calendar:end -->\n\nnotes\n$/);
  });

  it("no subscription: nothing fetched, nothing written; no note yet: said so, nothing written", async () => {
    const f = vi.fn();
    const vault = { read: vi.fn(async () => null), write: vi.fn() };
    expect(await refreshCalendarInNote("Daily/x.md", "2026-11-20", { feeds: [], fetch: f as never, labels, vault })).toEqual({ kind: "no-subscriptions" });
    expect(f).not.toHaveBeenCalled();
    expect(await refreshCalendarInNote("Daily/x.md", "2026-11-20", { feeds: [{ name: "U", url: "https://cal.example/u.ics" }], fetch: f as never, labels, vault })).toEqual({ kind: "no-note", path: "Daily/x.md" });
    expect(f).not.toHaveBeenCalled();
    expect(vault.write).not.toHaveBeenCalled();
  });

  it("the tab adds {{calendar}} to the daily template and refreshes today's note", async () => {
    useAppStore.getState().setDailyNotes({ template: "# {{title}}\n\n{{weekday}} · {{hebrewDate}}\n\n" });
    const refreshCalendarInNote = vi.fn(async (path: string) => ({ kind: "refreshed" as const, path, events: 2 }));
    render(<CalendarSettings calendarApp={stubApp({ refreshCalendarInNote })} />);
    expect(screen.getByTestId("cal-daily-field").textContent).toMatch(/no calendar field/);
    const add = screen.getByTestId("cal-daily-add-field");
    add.focus();
    await act(async () => {
      fireEvent.click(add);
      await Promise.resolve();
    });
    expect(useAppStore.getState().dailyNotes.template).toBe("# {{title}}\n\n{{calendar}}\n\n{{weekday}} · {{hebrewDate}}\n\n");
    expect(screen.queryByTestId("cal-daily-add-field")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("cal-daily-refresh"));
    expect(screen.getByTestId("cal-daily-field").textContent).toMatch(/has the calendar field/);
    await act(async () => fireEvent.click(screen.getByTestId("cal-daily-refresh")));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    expect(refreshCalendarInNote).toHaveBeenCalledWith(expect.stringContaining(iso), iso, expect.objectContaining({ labels: expect.any(Object) }));
    expect(screen.getByTestId("cal-daily-message").textContent).toMatch(/refreshed: 2 lines/);
    expect(addCalendarField("x")).toBe("x\n\n{{calendar}}\n");
    expect(addCalendarField("a {{ calendar }} b")).toBe("a {{ calendar }} b");
  });
});
