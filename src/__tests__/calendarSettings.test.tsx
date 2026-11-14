/**
 * Plan W10.C4–C6 (audit W7.20): the calendar engine reached from the app.
 *   C4 — Settings → Calendar: the account, the password in the secret store
 *        (never in settings storage or an export), finding calendars, a
 *        connection test with a message for each failure.
 *   C5 — the conflict dialog: both sides, keep mine / theirs / both, and
 *        "decide later" leaves it unresolved; 0 loss for each choice.
 *   C6 — {{calendar}} in the daily note: the day's events from an ICS
 *        subscription (a SYNTHETIC sample feed below).
 * The CalDAV server is the in-memory fake (helpers/fakeServers/caldav.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { basicAuth, createCalDavClient, parseCalendars } from "../calendar/caldav";
import { calendarBlockFor, findCalendars, syncTasksNow, testConnection } from "../calendar/app";
import { CALDAV_PASSWORD, readAccount } from "../calendar/config";
import { emptyState, type Choice, type Conflict, type VaultIO } from "../calendar/taskSync";
import { CalendarConflictDialog } from "../ui/CalendarConflictDialog";
import { CalendarSettings } from "../ui/settings/CalendarSettings";
import { renderTemplate, dayOf } from "../daily/dailyNote";
import { exportSettings } from "../settings/io";
import { SETTINGS_TABS } from "../settings/schema";
import { getSecret, __resetSecretStore } from "../lib/secretStore";
import { fakeCalDav } from "./helpers/fakeServers/caldav";

const COL = "https://dav.example/cal/tasks/";
const AUTH = basicAuth("dana", "s3cret-app-pass");
const memVault = (files: Record<string, string>): VaultIO & { files: Record<string, string> } => ({
  files,
  list: async () => Object.keys(files),
  read: async (p) => files[p] ?? null,
  write: async (p, c) => void (files[p] = c),
});

beforeEach(() => {
  localStorage.clear();
  __resetSecretStore();
  document.body.innerHTML = "";
});
afterEach(() => __resetSecretStore());

describe("C4: connection test and calendar discovery", () => {
  it("ok with the right password; auth, url and cors failures each named", async () => {
    const f = fakeCalDav({ collection: COL, authorization: AUTH });
    const account = { url: COL, user: "dana", inbox: "Tasks/Calendar.md" };
    expect(await testConnection(account, AUTH, f.fetch)).toEqual({ ok: true, tasks: 0 });
    expect(await testConnection(account, basicAuth("dana", "wrong"), f.fetch)).toEqual({ ok: false, reason: "auth" });
    expect(await testConnection({ ...account, url: "http://dav.example/cal/" }, AUTH, f.fetch)).toEqual({ ok: false, reason: "url" });
    const down = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    expect(await testConnection(account, AUTH, down)).toEqual({ ok: false, reason: "cors" });
  });

  it("finds the calendar collections under a home, with their names and whether they take tasks", async () => {
    const xml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
      <d:response><d:href>/cal/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
      <d:response><d:href>/cal/tasks/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>משימות</d:displayname><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response>
      <d:response><d:href>/cal/work</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Work &amp; school</d:displayname><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response>
    </d:multistatus>`;
    expect(parseCalendars(xml, "https://dav.example/cal/")).toEqual([
      { url: "https://dav.example/cal/tasks/", name: "משימות", tasks: true },
      { url: "https://dav.example/cal/work/", name: "Work & school", tasks: false },
    ]);
    const seen: Array<{ method?: string; depth?: string | null }> = [];
    const f = (async (_u: RequestInfo | URL, init?: RequestInit) => (seen.push({ method: init?.method, depth: new Headers(init?.headers).get("Depth") }), new Response(xml, { status: 207 }))) as typeof fetch;
    const r = await findCalendars("https://dav.example/cal", AUTH, f);
    expect(Array.isArray(r) && r.map((c) => c.name)).toEqual(["משימות", "Work & school"]);
    expect(seen).toEqual([{ method: "PROPFIND", depth: "1" }]);
  });
});

describe("C4: the settings tab", () => {
  it("is a tab; the password goes to the secret store, never to settings storage or an export", async () => {
    expect(SETTINGS_TABS.map((t) => t.id)).toContain("calendar");
    const testConnection = vi.fn(async () => ({ ok: false as const, reason: "auth" as const }));
    render(<CalendarSettings calendarApp={async () => ({ testConnection, findCalendars: vi.fn(), syncTasksNow: vi.fn() }) as never} />);
    fireEvent.change(screen.getByTestId("cal-url"), { target: { value: COL } });
    fireEvent.change(screen.getByTestId("cal-user"), { target: { value: "dana" } });
    fireEvent.change(screen.getByTestId("cal-password"), { target: { value: "s3cret-app-pass" } });
    await act(async () => fireEvent.click(screen.getByTestId("cal-test")));
    expect(testConnection).toHaveBeenCalledWith({ url: COL, user: "dana", inbox: "Tasks/Calendar.md" }, AUTH);
    expect(screen.getByTestId("cal-message").textContent).toMatch(/refused/);
    await act(async () => fireEvent.click(screen.getByTestId("cal-save")));
    expect(readAccount()).toEqual({ url: COL, user: "dana", inbox: "Tasks/Calendar.md" });
    expect(getSecret(CALDAV_PASSWORD)).toBe("s3cret-app-pass");
    // The settings entry holds no secret (the secret store keeps the password under its own key: encrypted
    // in a browser, the OS keychain on the desktop; here, without either, its visible "plain" mode, plan 2.5).
    expect(localStorage.getItem("lumen.calendar.caldav")).not.toContain("s3cret-app-pass");
    const exported = JSON.stringify(exportSettings({ getApp: () => ({}) as never, setApp: () => {}, storage: localStorage } as never));
    expect(exported).not.toContain("s3cret-app-pass");
    expect(exported).not.toContain("dav.example");
  });
});

describe("C5: the conflict dialog", () => {
  const conflict: Conflict = {
    kind: "conflict",
    uid: "u1",
    why: "both-changed",
    local: { path: "Daily/a.md", line: 1, uid: "u1", todo: { summary: "לכתוב דוח", due: "2026-11-20", start: null, completed: false, completedOn: null } } as never,
    remote: { uid: "u1", href: `${COL}u1.ics`, etag: '"2"', todo: { summary: "write the report", due: "2026-11-21", start: null, completed: true, completedOn: "2026-11-15" } } as never,
  };

  it("shows both sides, each in its own direction; every button is its answer; Escape is 'later'", async () => {
    const answers: Array<Choice | null> = [];
    const { unmount } = render(<CalendarConflictDialog conflict={conflict} onResolve={(c) => answers.push(c)} />);
    expect(screen.getByTestId("calendar-conflict-here").textContent).toContain("לכתוב דוח");
    expect(screen.getByTestId("calendar-conflict-there").textContent).toContain("write the report");
    expect(screen.getByTestId("calendar-conflict-here").querySelector("[dir=auto]")).toBeTruthy();
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(screen.getByTestId("calendar-conflict").contains(document.activeElement)).toBe(true);
    for (const id of ["calendar-conflict-here-btn", "calendar-conflict-there-btn", "calendar-conflict-both", "calendar-conflict-later"]) fireEvent.click(screen.getByTestId(id));
    unmount();
    render(<CalendarConflictDialog conflict={conflict} onResolve={(c) => answers.push(c)} />);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(answers).toEqual(["here", "there", "both", null, null]);
  });

  it("0 loss for each choice, and 'later' leaves the conflict unresolved (nothing of theirs touched)", async () => {
    const run = async (choice: Choice | null) => {
      const f = fakeCalDav({ collection: COL, authorization: AUTH });
      const client = createCalDavClient({ collection: COL, fetch: f.fetch, authorization: AUTH });
      const vault = memVault({ "Daily/a.md": "# a\n- [ ] write report 📅 2026-11-20\n" });
      const store = new Map<string, string>();
      const kv = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
      let n = 0;
      const deps = { vault, fetch: f.fetch, account: { url: COL, user: "dana", inbox: "Tasks/Calendar.md" }, authorization: AUTH, store: kv, newUid: () => `u${++n}`, now: () => new Date("2026-11-14T10:00:00Z") };
      expect((await syncTasksNow({ ...deps, decide: async () => null }))!.pushed).toBe(1);
      // Both sides change the task.
      vault.files["Daily/a.md"] = vault.files["Daily/a.md"]!.replace("write report", "write report today");
      const [res] = await client.list();
      await client.update(res!.href, res!.ics.replace("SUMMARY:write report", "SUMMARY:write the report"), res!.etag);
      const asked: Conflict[] = [];
      const r = (await syncTasksNow({ ...deps, decide: async (c) => (asked.push(c), choice) }))!;
      const server = (await client.list()).map((x) => /SUMMARY:(.*)/.exec(x.ics)![1]!.trim());
      const local = Object.values(vault.files).join("\n");
      return { r, asked, server, local };
    };
    const later = await run(null);
    expect(later.asked).toHaveLength(1);
    expect(later.r.conflicts).toHaveLength(1);
    expect(later.server).toEqual(["write the report"]);
    expect(later.local).toContain("write report today");
    const here = await run("here");
    expect(here.server).toEqual(["write report today"]);
    expect(here.local).toContain("write report today");
    const there = await run("there");
    expect(there.server).toEqual(["write the report"]);
    expect(there.local).toContain("write the report");
    expect(there.local).not.toContain("write report today");
    const both = await run("both");
    expect(both.server.sort()).toEqual(["write report today", "write the report"]);
    expect(both.local).toContain("write report today");
    expect(both.local).toContain("write the report");
  });

  it("with no account, nothing is asked and nothing is sent", async () => {
    expect(await syncTasksNow({ account: null, decide: async () => "here", vault: memVault({}), fetch: (() => Promise.reject(new Error("sent"))) as never })).toBeNull();
  });
});

describe("C6: {{calendar}} in the daily note", () => {
  // SYNTHETIC sample feed (two events on 2026-11-20, one the day after).
  const ICS = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", "BEGIN:VEVENT", "UID:a", "DTSTART:20261120T070000Z", "DTEND:20261120T083000Z", "SUMMARY:הרצאה בסטטיסטיקה", "LOCATION:בניין 72", "END:VEVENT", "BEGIN:VEVENT", "UID:b", "DTSTART;VALUE=DATE:20261120", "SUMMARY:יום הולדת לנועה", "END:VEVENT", "BEGIN:VEVENT", "UID:c", "DTSTART:20261121T070000Z", "SUMMARY:Tomorrow", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
  const labels = { heading: "Today's calendar", allDay: "All day", none: "No events", failed: (n: string) => `${n}: could not be read` };

  it("the day's events from a subscription fill the template's {{calendar}}", async () => {
    const urls: string[] = [];
    const f = (async (u: RequestInfo | URL) => (urls.push(String(u)), new Response(ICS))) as typeof fetch;
    const block = await calendarBlockFor("2026-11-20", { feeds: [{ name: "University", url: "webcal://cal.example/u.ics" }], fetch: f, timeZone: "Asia/Jerusalem", labels });
    expect(urls).toEqual(["https://cal.example/u.ics"]);
    const note = renderTemplate("# {{date}}\n\n{{calendar}}\n", dayOf(new Date(2026, 10, 20)), "en", { calendar: block });
    expect(note).toContain("## Today's calendar");
    expect(note).toContain("- All day יום הולדת לנועה");
    expect(note).toContain("- 09:00–10:30 הרצאה בסטטיסטיקה · בניין 72");
    expect(note).not.toContain("Tomorrow");
    expect(note).toMatch(/<!-- lumen-calendar:start -->[\s\S]*<!-- lumen-calendar:end -->/);
  });

  it("no subscription: an empty block and 0 requests; a failing feed is named, the others still show", async () => {
    const f = vi.fn(async () => new Response(ICS));
    expect(await calendarBlockFor("2026-11-20", { feeds: [], fetch: f as never, labels })).toBe("");
    expect(f).not.toHaveBeenCalled();
    const mixed = (async (u: RequestInfo | URL) => (String(u).includes("bad") ? new Response("", { status: 500 }) : new Response(ICS))) as typeof fetch;
    const block = await calendarBlockFor("2026-11-20", { feeds: [{ name: "Good", url: "https://a.example/g.ics" }, { name: "Bad", url: "https://a.example/bad.ics" }], fetch: mixed, timeZone: "Asia/Jerusalem", labels });
    expect(block).toContain("הרצאה בסטטיסטיקה");
    expect(block).toContain("- Bad: could not be read");
    expect(renderTemplate("{{calendar}}x", dayOf(new Date(2026, 10, 20)), "en")).toBe("x");
    expect(emptyState()).toEqual({ v: 1, entries: {} });
  });
});
