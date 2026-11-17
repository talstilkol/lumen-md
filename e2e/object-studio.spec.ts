import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { opfsWritable, vaultOrSkip } from "./_opfs";

/**
 * Plan W12.T2 — Object Studio, in the running app, in Hebrew (RTL): make the
 * type "אדם" with five fields, start a new note of it, fill the five fields
 * in the properties panel's form and save the note into the vault; the file
 * on disk holds the five values and the note's heading; axe finds no serious
 * or critical violation on the form. The offline half (the same flow over
 * the real form component, and the 100-note rename with one Ctrl+Z) is
 * src/__tests__/typedFormRtl.test.tsx and typedForm.test.ts.
 */

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

/** he/common.json, types.studio.* */
const L = {
  id: "מזהה (שם הקובץ)",
  labelHe: "שם בעברית",
  labelEn: "שם באנגלית",
  tag: "תגית שהופכת פתק לסוג הזה",
  create: "יצירת סוג",
  pickType: "סוג…",
  fieldName: "שם השדה",
  kind: "סוג הערך",
  options: "אפשרויות, מופרדות בפסיק",
  add: "הוספת השדה",
  noteTitle: "כותרת",
  createNote: "יצירת פתק",
};

const FIELDS: Array<{ name: string; kind: string; options?: string }> = [
  { name: "שם_מלא", kind: "text" },
  { name: "נולד", kind: "hebrew-date" },
  { name: "תפקיד", kind: "select", options: "סופרת, עורכת" },
  { name: "ספרים", kind: "number" },
  { name: "אתר", kind: "url" },
];

const run = (page: Page, id: string) => page.evaluate((cmd) => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: cmd } })), id);

/** Every .md file of the vault whose name starts with `prefix`, with its text. */
async function vaultNotes(page: Page, prefix: string): Promise<Array<{ path: string; text: string }>> {
  return page.evaluate(async (pre) => {
    const out: Array<{ path: string; text: string }> = [];
    const walk = async (dir: FileSystemDirectoryHandle, at: string) => {
      for await (const [name, h] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        const p = at ? `${at}/${name}` : name;
        if (h.kind === "directory") {
          if (!name.startsWith(".")) await walk(h as FileSystemDirectoryHandle, p);
        } else if (name.startsWith(pre) && name.endsWith(".md")) out.push({ path: p, text: await (await (h as FileSystemFileHandle).getFile()).text() });
      }
    };
    await walk(await navigator.storage.getDirectory(), "");
    return out;
  }, prefix);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.setItem("lumen-md", JSON.stringify({ state: { locale: "he" }, version: 0 }));
  });
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});

test("RTL: make the type אדם with five fields, a new note of it, fill the five fields, save — and axe on the form", async ({ page, browserName }) => {
  test.setTimeout(90_000);
  vaultOrSkip(await opfsWritable(page), browserName);

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lumen-open-object-studio", { detail: {} })));
  const studio = page.getByTestId("object-studio");
  await expect(studio).toBeVisible({ timeout: 10_000 });

  // A new type.
  await studio.getByLabel(L.id).fill("person");
  await studio.getByLabel(L.labelHe).fill("אדם");
  await studio.getByLabel(L.labelEn).fill("Person");
  await studio.getByLabel(L.tag).fill("person");
  await studio.getByRole("button", { name: L.create }).click();
  await expect.poll(async () => (await page.evaluate(async () => {
    try {
      const lumen = await (await navigator.storage.getDirectory()).getDirectoryHandle(".lumen");
      const types = await lumen.getDirectoryHandle("types");
      return (await (await types.getFileHandle("person.yaml")).getFile()).text();
    } catch {
      return "";
    }
  })), { timeout: 10_000 }).toContain("person");

  // Five fields.
  const addForm = studio.locator('form[aria-labelledby="studio-add-field"]');
  await expect(addForm.getByLabel(L.pickType).locator('option[value="person"]')).toHaveCount(1, { timeout: 10_000 });
  await addForm.getByLabel(L.pickType).selectOption("person");
  for (const f of FIELDS) {
    await addForm.getByLabel(L.fieldName).fill(f.name);
    await addForm.getByLabel(L.kind).selectOption(f.kind);
    if (f.options) await addForm.getByLabel(L.options).fill(f.options);
    await addForm.getByRole("button", { name: L.add }).click();
    await expect(addForm.getByLabel(L.fieldName)).toHaveValue("", { timeout: 5_000 });
  }

  // A new note of the type: it opens with the fields and the heading.
  const noteForm = studio.locator('form[aria-labelledby="studio-new-note"]');
  await noteForm.getByLabel(L.pickType).selectOption("person");
  await noteForm.getByLabel(L.noteTitle).fill("לאה");
  await noteForm.getByRole("button", { name: L.createNote }).click();
  await expect(studio).toHaveCount(0, { timeout: 10_000 });
  const editor = page.locator(".cm-content").first();
  await expect(editor).toContainText("type: person", { timeout: 10_000 });
  await expect(editor).toContainText("# לאה");

  // The form in the properties panel: one input per field, by the field's name.
  await run(page, "view.properties");
  const panel = page.getByTestId("properties-panel");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  const input = (name: string) => panel.getByLabel(name, { exact: true });
  await expect(input("שם_מלא")).toBeVisible({ timeout: 10_000 });
  await input("שם_מלא").fill("לאה גולדברג");
  await input("שם_מלא").press("Tab");
  await input("נולד").fill("1911-05-29");
  await input("נולד").press("Tab");
  await input("תפקיד").selectOption("סופרת");
  await input("ספרים").fill("12");
  await input("ספרים").press("Tab");
  await input("אתר").fill("https://example.org/leah");
  await input("אתר").press("Tab");
  for (const want of ["שם_מלא: לאה גולדברג", "נולד: 1911-05-29", "תפקיד: סופרת", "ספרים: 12", "אתר: https://example.org/leah"]) await expect(editor).toContainText(want, { timeout: 5_000 });

  // axe on the form (WCAG A + AA), in RTL.
  await page.evaluate(AXE);
  const violations = await page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: Array<{ id: string; impact: string | null; nodes: Array<{ target: string[] }> }> }> } };
    const r = await w.axe.run({ include: ['[data-testid="properties-panel"]'] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] });
    return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  });
  expect(violations).toEqual([]);

  // Save it into the vault: the file holds the five values, the type and the heading.
  await run(page, "file.saveToWorkspace");
  await expect.poll(async () => (await vaultNotes(page, "לאה")).length, { timeout: 10_000 }).toBeGreaterThan(0);
  const [saved] = await vaultNotes(page, "לאה");
  for (const want of ["type: person", "שם_מלא: לאה גולדברג", "נולד: 1911-05-29", "תפקיד: סופרת", "ספרים: 12", "אתר: https://example.org/leah", "# לאה"]) expect(saved.text, saved.path).toContain(want);
});
