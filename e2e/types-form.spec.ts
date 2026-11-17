import { test, expect, type Page } from "@playwright/test";
import { axeBlocking, freshApp, seed } from "./_wave12";
import { addFieldToTypeText, newTypeFile } from "../src/types/typedForm";

/**
 * The typed note's field form in a real browser, in Hebrew (plan W12.T2):
 * a note whose frontmatter says `type: person` shows the type's fields in
 * the properties panel, in the type's order, right to left; a select
 * writes one frontmatter key into the file on disk; a value that does not
 * fit (a word in a number field) is marked aria-invalid and kept, never
 * removed. axe has nothing blocking on the form.
 *
 * The type and the note are SYNTHETIC, written by the test through the
 * app's index (the type file through the same writer Object Studio uses).
 */

let type = newTypeFile("person", { he: "אדם", en: "Person" }, { tag: "person" });
let text = type.text;
text = addFieldToTypeText(text, "שם_מלא", "text", { label: { he: "שם מלא" } });
text = addFieldToTypeText(text, "תפקיד", "select", { options: ["סופר", "עורך"], label: { he: "תפקיד" } });
text = addFieldToTypeText(text, "ספרים", "number", { label: { he: "מספר ספרים" } });
type = { ...type, text };

const NOTE = "אנשים/ביאליק.md";
const BODY = "---\ntype: person\nשם_מלא: חיים נחמן ביאליק\nספרים: הרבה\n---\n\n# ביאליק\n\nמשורר.\n";

/** A vault file as it is on disk (OPFS), read in the page. */
function readVault(page: Page, path: string): Promise<string> {
  return page.evaluate(async (p) => {
    let dir = await navigator.storage.getDirectory();
    const parts = p.split("/");
    for (const d of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(d);
    return (await (await dir.getFileHandle(parts.at(-1)!)).getFile()).text();
  }, path);
}

test("a typed note's fields: order, RTL, one key written, a bad value marked and kept, axe clean", async ({ page, browserName }) => {
  test.setTimeout(90_000);
  await freshApp(page, browserName, "he");
  await seed(page, { [type.path]: type.text, [NOTE]: BODY });
  await page.evaluate((path) => window.dispatchEvent(new CustomEvent("lumen-open-file", { detail: { path } })), NOTE);
  await expect(page.locator(".cm-content").first()).toContainText("משורר", { timeout: 15_000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: "view.properties" } })));

  const form = page.getByTestId("typed-fields");
  await expect(form).toBeVisible({ timeout: 15_000 });
  const labels = await form.locator("label").allInnerTexts();
  const order = ["שם מלא", "תפקיד", "מספר ספרים"].map((l) => labels.findIndex((x) => x.includes(l)));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(await form.evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");

  // The bad number is marked, and the file keeps it.
  const books = form.getByLabel("מספר ספרים");
  await expect(books).toHaveAttribute("aria-invalid", "true");
  await expect(books).toHaveValue("הרבה");

  // The select writes exactly one key.
  await form.getByLabel("תפקיד").selectOption("עורך");
  await expect.poll(() => readVault(page, NOTE), { timeout: 10_000 }).toContain("תפקיד: עורך");
  const after = await readVault(page, NOTE);
  expect(after).toContain("שם_מלא: חיים נחמן ביאליק");
  expect(after).toContain("ספרים: הרבה");
  expect(after.replace(/\nתפקיד: עורך/, "")).toBe(BODY);

  expect(await axeBlocking(page, '[data-testid="typed-fields"]')).toEqual([]);
});
