import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { vaultOrSkip } from "./_opfs";

/**
 * Plan W12.R2 — the PDF reader's two-page view (src/pdf/PdfSpread.tsx).
 * Acceptance: on a Hebrew and on an English book the page order is right in
 * both directions, and the reading position (readingPosition.ts) is kept in
 * the two-page view too.
 *
 * The fixture (bilingual.pdf, 3 pages) has Hebrew and English text; the
 * direction is set with the reader's own toggle, so one file gives both a
 * right-to-left (Hebrew book) and a left-to-right (English book) layout.
 * Which direction is chosen by default from the text is unit-tested
 * (src/__tests__/pdfSpread.test.tsx, bookDirOf).
 */

const FIXTURE = readFileSync(new URL("./fixtures/bilingual.pdf", import.meta.url)).toString("base64");

async function putInVault(page: Page, name: string, base64: string): Promise<boolean> {
  return page.evaluate(
    async ({ name, base64 }) => {
      try {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const fh = await (await navigator.storage.getDirectory()).getFileHandle(name, { create: true });
        const h = fh as unknown as { createWritable?: () => Promise<{ write(d: Uint8Array): Promise<void>; close(): Promise<void> }> };
        if (typeof h.createWritable !== "function") return false;
        const w = await h.createWritable();
        await w.write(bytes);
        await w.close();
        return true;
      } catch {
        return false;
      }
    },
    { name, base64 },
  );
}

const readPositions = (page: Page) =>
  page.evaluate(async () => {
    try {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(".lumen");
      return await (await (await dir.getFileHandle("reading-positions.json")).getFile()).text();
    } catch {
      return "";
    }
  });

/** Left edges of pages 1 and 2 on screen. */
const lefts = (page: Page) =>
  page.evaluate(() => [1, 2].map((n) => document.querySelector(`[data-page-number="${n}"]`)!.getBoundingClientRect().left));

async function openReader(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lumen-open-file", { detail: { path: "bilingual.pdf" } })));
  const reader = page.getByTestId("pdf-reader");
  await expect(reader).toHaveAttribute("data-page-count", "3", { timeout: 15_000 });
  return reader;
}

async function setDir(page: Page, want: "rtl" | "ltr") {
  const btn = page.getByTestId("pdf-spread-dir");
  await expect(btn).toBeVisible();
  if ((await btn.getAttribute("aria-pressed")) !== String(want === "rtl")) await btn.click();
  await expect(btn).toHaveAttribute("aria-pressed", String(want === "rtl"));
  await expect(page.getByTestId("pdf-spread-row").first()).toHaveAttribute("dir", want);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
    localStorage.removeItem("lumen.pdf.spread");
  });
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toContainText("Welcome to", { timeout: 15_000 });
});

test("odd spreads: page 1 on the right in a Hebrew book, on the left in an English one; arrows page in the book's direction", async ({ page, browserName }) => {
  test.setTimeout(60_000);
  vaultOrSkip(await putInVault(page, "bilingual.pdf", FIXTURE), browserName);
  const reader = await openReader(page);
  await page.getByTestId("pdf-spread-mode").selectOption("odd");
  const rows = page.getByTestId("pdf-spread-row");
  await expect(rows).toHaveCount(2); // 1–2, 3
  await expect(rows.nth(0).locator("[data-page-number]")).toHaveCount(2);

  // Hebrew book: right to left, ArrowLeft is "next".
  await setDir(page, "rtl");
  const [r1, r2] = await lefts(page);
  expect(r1).toBeGreaterThan(r2);
  await page.getByTestId("pdf-spread-dir").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(reader).toHaveAttribute("data-current-page", "3", { timeout: 10_000 });
  await page.keyboard.press("ArrowRight");
  await expect(reader).toHaveAttribute("data-current-page", "1", { timeout: 10_000 });

  // English book: left to right, ArrowRight is "next".
  await setDir(page, "ltr");
  const [l1, l2] = await lefts(page);
  expect(l1).toBeLessThan(l2);
  await page.getByTestId("pdf-spread-dir").focus();
  await page.keyboard.press("ArrowRight");
  await expect(reader).toHaveAttribute("data-current-page", "3", { timeout: 10_000 });
});

test("even spreads keep page 1 alone (a cover), then 2–3", async ({ page, browserName }) => {
  vaultOrSkip(await putInVault(page, "bilingual.pdf", FIXTURE), browserName);
  await openReader(page);
  await page.getByTestId("pdf-spread-mode").selectOption("even");
  const rows = page.getByTestId("pdf-spread-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator("[data-page-number]")).toHaveCount(1);
  await expect(rows.nth(1).locator("[data-page-number]")).toHaveCount(2);
  await setDir(page, "rtl");
  const [p2, p3] = await page.evaluate(() => [2, 3].map((n) => document.querySelector(`[data-page-number="${n}"]`)!.getBoundingClientRect().left));
  expect(p2).toBeGreaterThan(p3);
});

test("the reading position and the two-page choice are kept when the PDF is reopened", async ({ page, browserName }) => {
  test.setTimeout(60_000);
  vaultOrSkip(await putInVault(page, "bilingual.pdf", FIXTURE), browserName);
  const reader = await openReader(page);
  await page.getByTestId("pdf-spread-mode").selectOption("odd");
  await setDir(page, "rtl");
  await page.getByTestId("pdf-spread-dir").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(reader).toHaveAttribute("data-current-page", "3", { timeout: 10_000 });
  await expect.poll(async () => (JSON.parse((await readPositions(page)) || "{}") as { docs?: Record<string, { page: number }> }).docs?.["bilingual.pdf"]?.page, { timeout: 10_000 }).toBe(3);

  await page.keyboard.press("Escape");
  await expect(reader).toHaveCount(0);
  const again = await openReader(page);
  await expect(page.getByTestId("pdf-spread-mode")).toHaveValue("odd");
  await expect(page.getByTestId("pdf-spread-dir")).toHaveAttribute("aria-pressed", "true");
  await expect(again).toHaveAttribute("data-current-page", "3", { timeout: 10_000 });
});
