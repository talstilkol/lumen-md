import { test, expect, type Page } from "@playwright/test";
import { FIRST_NOTE_P75_BUDGET_MS, TTFV1_P75_BUDGET_MS, TTFV_RUNS, isExternalRequest, ttfvVerdict } from "./perf/ttfv";

/**
 * Plan W11.P5 — time to first value on a production build, with no network.
 * Budgets and definitions: e2e/perf/ttfv.ts. Run with `npm run perf:ttfv`
 * against `npm run build && npx vite preview` (PLAYWRIGHT_BASE_URL). On the
 * dev server the numbers are reported but not asserted, as in
 * e2e/cold-start.spec.ts: on-the-fly transforms are not Lumen's start.
 *
 * Every run is a fresh browser context: no OPFS, no localStorage, no cache.
 */

const PROD = !!process.env.PLAYWRIGHT_BASE_URL;
const ACTIVATION_KEY = "lumen.activation.v1";

function report(name: string, value: number | string): void {
  test.info().annotations.push({ type: "perf", description: `${name}: ${value}` });
}

/** Refuse everything outside the app's origin; count what was refused. */
async function offline(page: Page, baseURL: string): Promise<{ refused: string[] }> {
  const refused: string[] = [];
  await page.context().route("**/*", (route) => {
    const url = route.request().url();
    if (isExternalRequest(url, baseURL)) {
      refused.push(new URL(url).origin);
      return route.abort("internetdisconnected");
    }
    return route.continue();
  });
  return { refused };
}

/** Navigation → the editor holds the caret and takes input (TTFV-1). */
async function ttfv1Run(page: Page): Promise<number> {
  await page.addInitScript(() => {
    // A returning user: setup done, tour done, a note open.
    localStorage.setItem("lumen-tour-done", "1"); // src/onboarding/setup.ts DONE_KEY
    if (!localStorage.getItem("lumen-md")) {
      localStorage.setItem("lumen-md", JSON.stringify({ state: { showWorkspace: true, mode: "source", doc: { name: "Note.md", content: "# Note\n\nText.\n", dirty: false, workspaceName: null } }, version: 0 }));
    }
  });
  await page.goto("/");
  const handle = await page.waitForFunction(
    () => {
      const el = document.querySelector<HTMLElement>(".cm-content");
      return el && el.isContentEditable ? performance.now() : 0;
    },
    null,
    { polling: "raf", timeout: 60_000 },
  );
  return (await handle.jsonValue()) as number;
}

/** Navigation on a fresh profile → the first note of the user's own is saved. */
async function firstNoteRun(page: Page): Promise<number> {
  await page.goto("/");
  const setup = page.getByRole("dialog").filter({ has: page.getByTestId("first-run") }).or(page.getByTestId("first-run"));
  await expect(setup.first()).toBeVisible({ timeout: 30_000 });
  // Through the setup by the quickest path: an empty vault / a blank note when offered.
  for (let step = 0; step < 8; step++) {
    const blank = setup.first().getByRole("radio", { name: /An empty vault|Blank note|Empty note/i });
    if (await blank.count()) await blank.first().check();
    const finish = setup.first().getByRole("button", { name: /Start writing/i });
    if (await finish.count()) {
      await finish.first().click();
      break;
    }
    await setup.first().getByRole("button", { name: /^Next$/ }).click();
  }
  const editor = page.locator(".cm-content").first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\nMy own first line.");
  const handle = await page.waitForFunction(
    (key) => {
      try {
        const s = JSON.parse(localStorage.getItem(key) ?? "null") as { firstOwnSaveDay?: string | null } | null;
        return s?.firstOwnSaveDay ? performance.now() : 0;
      } catch {
        return 0;
      }
    },
    ACTIVATION_KEY,
    { polling: 50, timeout: 60_000 },
  );
  return (await handle.jsonValue()) as number;
}

test("TTFV-1: the editor takes input within 2 s at p75, no network", { tag: "@ttfv" }, async ({ browser, baseURL }) => {
  test.setTimeout(600_000);
  const values: number[] = [];
  const appValues: number[] = [];
  let refused = 0;
  for (let i = 0; i < TTFV_RUNS; i++) {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    const net = await offline(page, baseURL!);
    values.push(await ttfv1Run(page));
    // The app's own TTFV-1 (W11.P4), when it recorded one: reported, not asserted.
    const own = await page.evaluate((key) => {
      try {
        const s = JSON.parse(localStorage.getItem(key) ?? "null") as { ttfv1Ms?: number[] } | null;
        return s?.ttfv1Ms?.at(-1) ?? null;
      } catch {
        return null;
      }
    }, ACTIVATION_KEY);
    if (typeof own === "number") appValues.push(own);
    refused += net.refused.length;
    await context.close();
  }
  const v = ttfvVerdict(values, TTFV1_P75_BUDGET_MS);
  report("TTFV-1 runs (ms)", values.map(Math.round).join(", "));
  report("TTFV-1 p75", `${Math.round(v.p75)} ms (budget ${v.budget} ms)`);
  report("TTFV-1 as the app recorded it, p75", appValues.length ? `${Math.round(ttfvVerdict(appValues, TTFV1_P75_BUDGET_MS).p75)} ms` : "none recorded");
  report("requests refused (outside the origin)", refused);
  expect(v.runs).toBe(TTFV_RUNS);
  if (PROD) expect(v.p75, `TTFV-1 p75 ${Math.round(v.p75)} ms`).toBeLessThanOrEqual(TTFV1_P75_BUDGET_MS);
});

test("first note: a new user's own note is saved within 4 s at p75, no network", { tag: "@ttfv" }, async ({ browser, baseURL }) => {
  test.setTimeout(900_000);
  const values: number[] = [];
  for (let i = 0; i < TTFV_RUNS; i++) {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await offline(page, baseURL!);
    values.push(await firstNoteRun(page));
    await context.close();
  }
  const v = ttfvVerdict(values, FIRST_NOTE_P75_BUDGET_MS);
  report("first note runs (ms)", values.map(Math.round).join(", "));
  report("first note p75", `${Math.round(v.p75)} ms (budget ${v.budget} ms)`);
  expect(v.runs).toBe(TTFV_RUNS);
  if (PROD) expect(v.p75, `first note p75 ${Math.round(v.p75)} ms`).toBeLessThanOrEqual(FIRST_NOTE_P75_BUDGET_MS);
});
