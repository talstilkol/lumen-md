/**
 * W7.20 world-class pass on Settings → Calendar: real buttons and fields (the
 * app's styles, not bare preflight), one request at a time with a busy state,
 * a failed sync said instead of swallowed, the last sync's time and counts,
 * subscriptions as a list whose Remove keeps focus in the list, the ICS
 * section's own messages, and axe.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { CalendarSettings, LAST_SYNC_KEY } from "../ui/settings/CalendarSettings";
import { readSubscriptions, saveSubscriptions } from "../calendar/config";
import { __resetSecretStore } from "../lib/secretStore";
import type { SyncReport } from "../calendar/taskSync";

beforeEach(() => {
  localStorage.clear();
  __resetSecretStore();
  document.body.innerHTML = "";
});
afterEach(() => __resetSecretStore());

const report = (o: Partial<SyncReport> = {}): SyncReport => ({ pushed: 2, pulled: 3, deleted: 0, conflicts: [], errors: [], state: { v: 1, entries: {} }, ...o }) as SyncReport;
const appWith = (syncTasksNow: () => Promise<SyncReport | null>) => async () => ({ testConnection: vi.fn(), findCalendars: vi.fn(), syncTasksNow }) as never;

describe("Settings → Calendar", () => {
  it("every button and field carries the app's styles (none is a bare preflight control)", () => {
    render(<CalendarSettings calendarApp={appWith(async () => null)} />);
    const root = screen.getByTestId("calendar-settings");
    for (const b of root.querySelectorAll("button")) expect(b.className, b.textContent ?? "").toMatch(/prompt-btn/);
    for (const i of root.querySelectorAll("input:not([type=radio])")) expect(i.className, i.outerHTML).toMatch(/cal-input/);
  });

  it("sync: busy while it runs (a second click does nothing), then the counts and the last sync's time, kept for next time", async () => {
    let finish!: (r: SyncReport) => void;
    const sync = vi.fn(() => new Promise<SyncReport>((ok) => (finish = ok)));
    render(<CalendarSettings calendarApp={appWith(sync)} />);
    await act(async () => void fireEvent.click(screen.getByTestId("cal-sync")));
    await waitFor(() => expect(screen.getByTestId("cal-message").textContent).toMatch(/Syncing/));
    expect((screen.getByTestId("cal-sync") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => void fireEvent.click(screen.getByTestId("cal-sync")));
    expect(sync).toHaveBeenCalledTimes(1);
    await act(async () => finish(report({ conflicts: [{} as never] })));
    await waitFor(() => expect(screen.getByTestId("cal-message").textContent).toMatch(/2 sent, 3 received, 1 conflicts left/));
    expect(screen.getByTestId("cal-last-sync").textContent).toMatch(/Last sync: .+ sent 2, received 3, conflicts left 1/);
    expect(JSON.parse(localStorage.getItem(LAST_SYNC_KEY)!)).toMatchObject({ pushed: 2, pulled: 3, conflicts: 1 });
    expect((screen.getByTestId("cal-sync") as HTMLButtonElement).disabled).toBe(false);
  });

  it("a sync that throws (offline, a bug) is said, and the buttons come back", async () => {
    render(<CalendarSettings calendarApp={appWith(async () => Promise.reject(new TypeError("Failed to fetch")))} />);
    await act(async () => void fireEvent.click(screen.getByTestId("cal-sync")));
    await waitFor(() => expect(screen.getByTestId("cal-message").textContent).toMatch(/did not work/));
    expect((screen.getByTestId("cal-sync") as HTMLButtonElement).disabled).toBe(false);
    expect(localStorage.getItem(LAST_SYNC_KEY)).toBeNull();
  });

  it("the status regions are there before they speak (a live region added with its text is often not announced)", () => {
    render(<CalendarSettings calendarApp={appWith(async () => null)} />);
    expect(screen.getByTestId("cal-message").getAttribute("role")).toBe("status");
    expect(screen.getByTestId("cal-ics-message").getAttribute("role")).toBe("status");
  });

  it("subscriptions: empty state; a bad address is said in the ICS section; add and remove; Remove keeps focus in the list", async () => {
    render(<CalendarSettings calendarApp={appWith(async () => null)} />);
    expect(screen.getByTestId("cal-ics-empty")).toBeTruthy();
    fireEvent.change(screen.getByTestId("cal-ics-url"), { target: { value: "http://plain.example/x.ics" } });
    fireEvent.click(screen.getByTestId("cal-ics-add"));
    expect(screen.getByTestId("cal-ics-message").textContent).toMatch(/https/);
    expect(screen.getByTestId("cal-message").textContent).toBe("");
    for (const [name, url] of [["אוניברסיטה", "webcal://a.example/u.ics"], ["Work", "https://b.example/w.ics"]]) {
      fireEvent.change(screen.getByTestId("cal-ics-name"), { target: { value: name } });
      fireEvent.change(screen.getByTestId("cal-ics-url"), { target: { value: url } });
      await act(async () => void fireEvent.click(screen.getByTestId("cal-ics-add")));
    }
    expect(screen.getAllByTestId("cal-ics-item").map((x) => x.textContent)).toEqual(["אוניברסיטהRemove", "WorkRemove"]);
    await waitFor(() => expect(readSubscriptions().map((s) => s.name)).toEqual(["אוניברסיטה", "Work"]));
    const first = screen.getByRole("button", { name: "Remove the subscription אוניברסיטה" });
    first.focus();
    await act(async () => {
      fireEvent.click(first);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(screen.getAllByTestId("cal-ics-item")).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Remove the subscription Work" }));
    expect(screen.getByTestId("cal-ics-message").textContent).toBe("Removed: אוניברסיטה");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove the subscription Work" }));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(document.activeElement).toBe(screen.getByTestId("cal-ics-name"));
    expect(screen.getByTestId("cal-ics-empty")).toBeTruthy();
  });

  it("axe: no serious or critical violation, with subscriptions and a message on screen", async () => {
    await saveSubscriptions([{ id: "a", name: "University", url: "https://a.example/u.ics" }]);
    const { container } = render(<CalendarSettings calendarApp={appWith(async () => report())} />);
    await act(async () => void fireEvent.click(screen.getByTestId("cal-sync")));
    await waitFor(() => expect(screen.getByTestId("cal-last-sync")).toBeTruthy());
    const r = await axe.run(container, { resultTypes: ["violations"], rules: { "color-contrast": { enabled: false } } });
    expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
});
