/**
 * W11.Q6 — drive the product journey (./productJourney.ts) with a Guidepup
 * screen reader, in Hebrew or English, and attach the receipt: every step's
 * spoken-phrase log, what was missing, the voice, and the protocol row.
 * The nightly `sr` kind copies the attachment into its sealed report
 * (scripts/nightly/run.mjs, collectSr).
 */
import type { Page, TestInfo } from "@playwright/test";
import { resultRow } from "./journey";
import { BASE_URL, type Reader } from "./runJourney";
import { missingIn, productTasks, VAULT, type JourneyLocale, type ProductReceipt } from "./productJourney";

/** Open the app in `locale` with the journey's vault in OPFS (the browser's own file system). */
export async function openVault(page: Page, locale: JourneyLocale): Promise<void> {
  await page.addInitScript((loc) => {
    localStorage.clear();
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.setItem("lumen-md", JSON.stringify({ state: { locale: loc, mode: "source", showWorkspace: true }, version: 0 }));
  }, locale);
  await page.goto(BASE_URL, { waitUntil: "load" });
  await page.evaluate(async (files) => {
    const root = await navigator.storage.getDirectory();
    for (const f of files) {
      const h = await root.getFileHandle(f.path, { create: true });
      const w = await (h as unknown as { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable();
      await w.write(f.content);
      await w.close();
    }
  }, VAULT[locale]);
  await page.reload({ waitUntil: "load" });
  await page.locator(`html[dir=${locale === "he" ? "rtl" : "ltr"}]`).waitFor();
  await page.locator("aside.file-tree [role=treeitem]").first().waitFor();
}

/** Poll until the reader stops speaking (the log stops growing), at most 5 s. */
async function settled(reader: Reader): Promise<string[]> {
  let last = -1;
  let spoken: string[] = [];
  for (let i = 0; i < 20; i++) {
    spoken = await reader.spokenPhraseLog();
    if (spoken.length === last) break;
    last = spoken.length;
    await new Promise((r) => setTimeout(r, 250));
  }
  return spoken;
}

export async function runProductJourney(page: Page, reader: Reader, setup: string, locale: JourneyLocale, info: TestInfo): Promise<ProductReceipt> {
  await openVault(page, locale);
  await reader.navigateToWebContent();
  const results: ProductReceipt["results"] = [];
  for (const task of productTasks(locale)) {
    await reader.clearSpokenPhraseLog();
    for (const a of task.actions) {
      if ("press" in a) await page.keyboard.press(a.press);
      else if ("type" in a) await page.keyboard.type(a.type);
      else if ("focus" in a) await page.locator(a.focus).first().focus();
      else {
        await settled(reader);
        await reader.clearSpokenPhraseLog();
      }
    }
    const spoken = await settled(reader);
    results.push({ id: task.id, title: task.title, spoken, missing: missingIn(task, spoken) });
  }
  const receipt: ProductReceipt = {
    setup: `${setup} / ${locale}`,
    journey: "product",
    locale,
    voice: process.env.LUMEN_SR_VOICE ?? null,
    row: resultRow(new Date().toISOString().slice(0, 10), process.env.npm_package_version ?? "dev", `${setup} / ${locale} (product journey)`, results),
    results,
  };
  await info.attach(`${setup} product ${locale}.json`, { body: JSON.stringify(receipt, null, 2), contentType: "application/json" });
  console.log(receipt.row);
  return receipt;
}
