import { test } from "@playwright/test";

/**
 * Engine gaps shared by several specs (plan W4.12): one helper per gap, so
 * e2e/ keeps under its skip cap (scripts/lib/skipAudit.mjs) and each gap is
 * written down once.
 */

/**
 * What only Playwright's Chromium can do: a CDP call, a command-line flag, or an API Firefox and WebKit lack;
 * or a check pinned to one engine's output (W10.Z3: one helper, so e2e/ stays under its skip cap).
 */
export type ChromiumOnly =
  | "page.pdf()"
  | "CPU throttling"
  | "the mDNS flag"
  | "showDirectoryPicker"
  | "a fake microphone"
  | "phone emulation"
  | "the pixel baseline"
  | "the aria snapshots"
  | "one engine for a server round trip";

/** Why each gap is Chromium's, for the skip message. */
const WHY: Record<ChromiumOnly, string> = {
  "page.pdf()": "Playwright has it in Chromium only",
  "CPU throttling": "a CDP call, Chromium only",
  "the mDNS flag": "a Chromium command-line flag",
  showDirectoryPicker: "showDirectoryPicker is Chromium-only; the folder here is an OPFS directory handed to the picker",
  "a fake microphone": "Playwright fakes a microphone in Chromium only (--use-fake-device-for-media-stream)",
  "phone emulation": "Firefox has no mobile emulation in Playwright; WebKit's layout is covered by the desktop webkit project",
  "the pixel baseline": "the baseline is one engine's rendering; fonts and anti-aliasing differ per engine",
  "the aria snapshots": "the snapshots pin Chromium's accessibility tree; the real screen readers run in sr/",
  "one engine for a server round trip": "the flow under test is the server's; no engine changes it",
};

/** Skip on every engine but Chromium, inside a test, for a gap only Chromium fills. */
export function chromiumOnly(browserName: string, what: ChromiumOnly): void {
  // skip-reason: a Playwright capability only its Chromium has (page.pdf(), CDP CPU throttling, the mDNS flag, showDirectoryPicker), or a check pinned to one engine's output (the pixel baseline); each gap is named in WHY above | task: W4.12 | until: 2027-05-16
  test.skip(browserName !== "chromium", `${what}: ${WHY[what]}`);
}

/** The same for a whole file or describe block: call it at that level, as `test.skip(({ browserName }) => …)` would be. */
export function chromiumOnlyHere(what: ChromiumOnly): void {
  // skip-reason: a whole spec that only Chromium can run (a fake microphone, phone emulation), pinned to its output (the aria snapshots), or the server's flow (the collab round trip); each gap is named in WHY above | task: W4.12 | until: 2027-05-16
  test.skip(({ browserName }) => browserName !== "chromium", `${what}: ${WHY[what]}`);
}

/** The service-worker offline checks: the production build only, and only Chromium can go offline with a worker in control. */
export function swOfflineOrSkip(dev: boolean, browserName: string, what: string): void {
  // skip-reason: the service worker exists on the production build only, and Playwright can take only Chromium offline with a worker in control | task: 0.5 | until: 2027-05-12
  test.skip(dev || browserName !== "chromium", what);
}
