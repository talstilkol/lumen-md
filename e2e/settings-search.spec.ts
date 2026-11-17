import { test, expect } from "@playwright/test";
import { freshApp, axeBlocking } from "./_wave12";

/**
 * Plan W13.E4 — settings search, keyboard only (Obsidian 1.13).
 *
 * ⌘, (Ctrl+, elsewhere) opens the settings with the search field focused;
 * typing ranks the settings (niqqud- and accent-blind); ↓ moves the active
 * result, Enter opens it with its control focused; ⌘F comes back to the
 * field; Escape clears, then closes. No mouse anywhere. axe has nothing
 * serious, in Hebrew and English. `#settings/<id>` (the web form of
 * lumen://settings/<id>) opens the screen on a setting.
 */

const MOD = process.platform === "darwin" ? "Meta" : "Control";

for (const locale of ["he", "en"] as const) {
  test(`settings search by keyboard only (${locale})`, async ({ page, browserName }) => {
    await freshApp(page, browserName, locale);
    await page.keyboard.press(`${MOD}+Comma`);
    const screen = page.getByTestId("settings-screen");
    await expect(screen).toBeVisible();
    const field = page.getByTestId("settings-search");
    await expect(field).toBeFocused();

    await page.keyboard.type(locale === "he" ? "מצב כהה" : "dark mode");
    const options = page.getByRole("option");
    await expect(options.first()).toHaveAttribute("data-result", "theme");
    await expect(field).toHaveAttribute("aria-activedescendant", (await options.first().getAttribute("id"))!);
    expect(await axeBlocking(page, "body")).toEqual([]);

    // A query with niqqud finds the unpointed label (W13.E3).
    await field.fill("");
    await page.keyboard.type(locale === "he" ? "שָׂפָה" : "langüage");
    await expect(options.first()).toHaveAttribute("data-result", "locale");

    await field.fill("");
    await page.keyboard.type("spell");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-setting="spellCheck"]')).toBeFocused();
    await expect(field).toHaveValue("");

    // Space toggles it; ⌘F goes back to the field.
    await page.keyboard.press("Space");
    await page.keyboard.press(`${MOD}+KeyF`);
    await expect(field).toBeFocused();

    await page.keyboard.type("vim");
    await page.keyboard.press("Escape");
    await expect(field).toHaveValue("");
    await expect(screen).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(screen).toBeHidden();
    // Focus goes back somewhere sensible, never <body>.
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
  });
}

test("a settings deep link opens on the setting", async ({ page, browserName }) => {
  await freshApp(page, browserName, "en");
  await page.evaluate(() => (location.hash = "#settings/vimEnabled"));
  await expect(page.getByTestId("settings-screen")).toBeVisible();
  await expect(page.locator('[data-setting="vimEnabled"]')).toBeFocused();
});
