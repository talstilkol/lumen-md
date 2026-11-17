import { expect, type Page } from "@playwright/test";

/**
 * The ten surfaces the accessibility gates walk (plan W13.Y2, Y4, Y5): the
 * main screen and nine others, each opened through the command palette's
 * event, the way a keyboard user gets there.
 */
export interface Surface {
  name: string;
  /** Command id dispatched as `lumen-run-command`; none for the main screen. */
  command?: string;
  /** Opened as a modal dialog (Escape closes it). */
  modal?: boolean;
}

export const SURFACES: Surface[] = [
  { name: "main screen" },
  { name: "command palette", modal: true },
  { name: "search", command: "view.search", modal: true },
  { name: "theme settings", command: "settings.theme", modal: true },
  { name: "settings", command: "settings.open", modal: true },
  { name: "setup", command: "help.setup", modal: true },
  { name: "trash", command: "file.trash", modal: true },
  { name: "version history", command: "view.versionHistory", modal: true },
  { name: "reading view", command: "view.reading" },
  { name: "graph", command: "view.graphView" },
];

export async function bootApp(page: Page, opts: { lang?: "en" | "he" } = {}): Promise<void> {
  const lang = opts.lang ?? "en";
  await page.addInitScript((l) => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.setItem("lumen-md", JSON.stringify({ state: { locale: l }, version: 0 }));
  }, lang);
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 20_000 });
}

/** Open `s`; returns a function that closes it again. */
export async function openSurface(page: Page, s: Surface): Promise<() => Promise<void>> {
  if (s.name === "command palette") await page.keyboard.press("ControlOrMeta+k");
  else if (s.command) await page.evaluate((id) => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id } })), s.command);
  if (s.modal) await expect(page.locator('[role="dialog"][aria-modal="true"]').first()).toBeVisible({ timeout: 10_000 });
  // a side panel has no dialog to wait for: two frames, so it has rendered
  else await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  return async () => {
    if (s.modal) {
      await page.keyboard.press("Escape");
      await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0, { timeout: 5_000 });
    } else if (s.command) {
      await page.evaluate((id) => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id } })), s.command);
    }
  };
}

/** Tab through `n` stops of the open surface, calling `each` on every focused element. */
export async function tabThrough(page: Page, n: number, each: () => Promise<void>): Promise<void> {
  for (let i = 0; i < n; i++) {
    await page.keyboard.press("Tab");
    await each();
  }
}
