/**
 * 14.2 — "nothing leaves without a click", seen from the browser itself.
 *
 * FeedbackDialogRender.test.tsx proves it with stubs (fetch, XHR, sendBeacon,
 * window.open replaced by spies). This file stubs none of the network: the
 * dialog runs with the real i18n, the real AI policy and the real browser
 * APIs, and what the page loaded is read from the browser's own record of
 * every request (Resource Timing: fetch, XHR, beacons, images, scripts,
 * styles, all of them), plus a PerformanceObserver that sees each new entry.
 * Typing a title and a description and ticking the boxes sends nothing to
 * another site, and no request carries what was typed (the page may load its
 * own static files, and the doctor box asks this device's own model server
 * on loopback); only the click on "Open on GitHub" opens a URL, with the
 * previewed issue, exactly as the preview showed it. window.open alone is replaced, so the test opens no tab.
 *
 * In Node (happy-dom) there is no Resource Timing, so the file says so and
 * checks nothing there: run it in Chromium (the offline shim's browser runner,
 * or vitest's browser mode).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const hasTiming = typeof PerformanceObserver !== "undefined" && typeof performance.getEntriesByType === "function" && PerformanceObserver.supportedEntryTypes?.includes("resource");

// skip-reason: Resource Timing (PerformanceObserver "resource") exists only in a real browser; happy-dom has none, so the file runs in the Chromium runner | task: 14.2 | until: 2027-05-16
describe.skipIf(!hasTiming)(`feedback in a real browser: 0 requests before the click (14.2)${hasTiming ? "" : " — skipped: no Resource Timing here (happy-dom); runs in Chromium"}`, () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("typing and ticking send nothing off the device; the click opens exactly the previewed issue", async () => {
    const { FeedbackDialog } = await import("../ui/FeedbackDialog");
    const opened: string[] = [];
    vi.stubGlobal("open", (url?: string | URL) => {
      opened.push(String(url));
      return null;
    });
    render(<FeedbackDialog options={{}} onClose={() => undefined} />);
    // Let the first render's own loads (lazy strings, fonts) settle, then start counting.
    await new Promise((r) => setTimeout(r, 300));
    const before = performance.getEntriesByType("resource").length;
    const seen: string[] = [];
    /** Same origin as the page, or this device (loopback): not data leaving the device. */
    const onDevice = (entry: string) => {
      const u = new URL(entry.slice(entry.indexOf(" ") + 1));
      return u.origin === location.origin || ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    };
    const watch = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) seen.push(`${(e as PerformanceResourceTiming).initiatorType} ${e.name}`);
    });
    watch.observe({ type: "resource" });

    // 1. Typing: no request leaves the device. The app may load its own static files
    //    (the spelling dictionary, from its own origin); nothing goes to another site.
    fireEvent.change(screen.getByTestId("feedback-title"), { target: { value: "Tabs vanish" } });
    fireEvent.change(screen.getByTestId("feedback-description"), { target: { value: "All my tabs closed." } });
    await new Promise((r) => setTimeout(r, 500));
    expect(seen.filter((e) => !onDevice(e))).toEqual([]);
    // 2. Ticking the boxes: the doctor box runs the AI doctor, which asks this device's
    //    own model server (loopback) — the user's click, and still nothing off the device.
    for (const box of Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) fireEvent.click(box);
    await new Promise((r) => setTimeout(r, 800));
    expect(seen.filter((e) => !onDevice(e))).toEqual([]);
    // No request of any kind carries what the user typed.
    for (const e of seen) for (const typed of ["Tabs", "vanish", "tabs%20closed", "closed."]) expect(e, typed).not.toContain(typed);
    expect(performance.getEntriesByType("resource").length).toBe(before + seen.length);
    expect(opened).toEqual([]);

    const preview = screen.getByTestId("feedback-preview").textContent ?? "";
    expect(preview).toContain("Tabs vanish");
    // The doctor's report (ticked) is in the preview, scrubbed; what the user typed is theirs and shown as typed.
    expect(preview).toContain("## AI doctor report");

    fireEvent.click(screen.getByTestId("feedback-open-github"));
    await waitFor(() => expect(opened).toHaveLength(1));
    const url = new URL(opened[0]);
    expect(`${url.origin}${url.pathname}`).toBe("https://github.com/talstilkol/lumen-md/issues/new");
    // Exactly what the preview showed, nothing more.
    expect(`${url.searchParams.get("title")}\n\n${url.searchParams.get("body")}`).toBe(preview);
    // Opening the issue is the user's own navigation: still no request from this page to another site.
    await new Promise((r) => setTimeout(r, 300));
    watch.disconnect();
    expect(seen.filter((e) => !onDevice(e))).toEqual([]);
  }, 30_000);
});
