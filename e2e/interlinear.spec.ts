import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { axeBlocking, freshApp, runCommand, setNote } from "./_wave12";

/**
 * W13.R12: the bilingual reader on a bilingual chapter — a Sefaria source
 * note with a Hebrew and an English version (e2e/fixtures/interlinear: a
 * synthetic 12-verse chapter in the source-note format; invented text).
 * Every verse is paired with its own translation (100%) in columns and in
 * interlinear; the keys 1/2/3 switch layouts; source only hides the
 * translation; axe clean; no request.
 */
const MD = readFileSync(join(__dirname, "fixtures", "interlinear", "bilingual-chapter.md"), "utf8");

for (const locale of ["he", "en"] as const) {
  test(`bilingual chapter (${locale} UI): verse alignment 100%, three layouts, axe`, async ({ page, browserName }) => {
    await freshApp(page, browserName, locale);
    const requests: string[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).origin !== new URL(page.url()).origin && !/^(data|blob):/.test(r.url())) requests.push(r.url());
    });
    await setNote(page, MD);
    await runCommand(page, "view.bilingual");
    const view = page.getByTestId("bilingual-view");
    await expect(view).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("bi-mode-columns").click();

    const aligned = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll("[data-testid=bi-row]")).map((r) => {
          const n = r.getAttribute("data-verse");
          const s = Array.from(r.querySelectorAll("[data-testid=bi-src]")).map((x) => x.textContent).join(" ");
          const t = Array.from(r.querySelectorAll("[data-testid=bi-tgt]")).map((x) => x.textContent).join(" ");
          return s.includes(`פָּסוּק ${n}.`) && t.includes(`Verse ${n}.`);
        }),
      );
    for (const mode of ["columns", "interlinear"] as const) {
      if (mode === "interlinear") await page.keyboard.press("2");
      await expect(view).toHaveAttribute("data-mode", mode);
      const rows = await aligned();
      expect(rows).toHaveLength(12);
      expect(rows.every(Boolean)).toBe(true);
      expect(await axeBlocking(page, "[data-testid=bilingual-view]")).toEqual([]);
    }
    // Columns: the Hebrew source is on the right of its translation.
    await page.keyboard.press("1");
    const first = page.getByTestId("bi-row").first();
    const src = await first.getByTestId("bi-src").boundingBox();
    const tgt = await first.getByTestId("bi-tgt").boundingBox();
    expect(src!.x).toBeGreaterThan(tgt!.x);

    await page.keyboard.press("3");
    await expect(view).toHaveAttribute("data-mode", "source");
    await expect(page.getByTestId("bi-tgt")).toHaveCount(0);
    await expect(page.getByTestId("bi-src")).toHaveCount(12);
    await expect(page.getByTestId("bi-version")).toContainText(/Public Domain/);
    expect(requests).toEqual([]);
  });
}
