import { expect, type Page } from "@playwright/test";

/**
 * Shared setup for the RTL parity specs (plan 9.9, W10.E22): open the app in
 * Hebrew (RTL) or English (LTR) with a given note, and geometry helpers. Each
 * spec runs both locales; English is the control that the Hebrew result
 * mirrors.
 */
export type Locale = "he" | "en";
export const LOCALES: readonly Locale[] = ["he", "en"];

export async function openApp(page: Page, locale: Locale, content: string, extra: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript(
    ({ locale, content, extra }) => {
      localStorage.clear();
      localStorage.setItem("lumen-tour-done", "1");
      localStorage.setItem("lumen-md", JSON.stringify({ state: { locale, doc: { name: "RTL.md", content, dirty: false, workspaceName: null }, ...extra }, version: 0 }));
    },
    { locale, content, extra },
  );
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", locale === "he" ? "rtl" : "ltr");
}

export const runCommand = (page: Page, id: string) => page.evaluate((cmd) => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: cmd } })), id);

export async function boxOf(page: Page, selector: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await page.locator(selector).first().boundingBox();
  expect(b, selector).not.toBeNull();
  return b!;
}

/** True when `x` is on the reading start side of `ref` (right of it in RTL, left in LTR). */
export const onStartSide = (locale: Locale, x: number, ref: number) => (locale === "he" ? x > ref : x < ref);
