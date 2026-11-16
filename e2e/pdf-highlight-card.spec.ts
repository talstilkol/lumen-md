import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { vaultOrSkip } from "./_opfs";
import { createPdfAnnotation, upsertAnnotationsNote } from "../src/pdf/annotations";

/**
 * Plan W12.R1 — a PDF highlight dragged from the highlights panel onto the
 * canvas becomes a card, and the card's link opens the PDF at that page with
 * that highlight (src/ui/useHighlightCards.ts, src/canvas/highlightCards.ts).
 *
 * The drag is made of the two real halves: the panel's own dragstart fills a
 * DataTransfer (so the payload is the panel's, not one written here), and that
 * DataTransfer is dropped on the canvas body. Playwright cannot drag between
 * the panel and the canvas modal, which are never open together. The card is
 * then selected and its link followed through Excalidraw's own link popup,
 * which calls the app's onLinkOpen.
 *
 * Not covered here (owed): a scanned PDF with an OCR layer (W6.47).
 */

const PDF = readFileSync(new URL("./fixtures/bilingual.pdf", import.meta.url));
const ID = "00000777-0000-4000-8000-000000000000";
const QUOTE = "passage to highlight";

async function put(page: Page, name: string, data: Uint8Array | string): Promise<boolean> {
  const bytes = typeof data === "string" ? Array.from(new TextEncoder().encode(data)) : Array.from(data);
  return page.evaluate(
    async ({ name, bytes }) => {
      try {
        const root = await navigator.storage.getDirectory();
        const fh = await root.getFileHandle(name, { create: true });
        const h = fh as unknown as { createWritable?: () => Promise<{ write(d: Uint8Array): Promise<void>; close(): Promise<void> }> };
        if (typeof h.createWritable !== "function") return false;
        const w = await h.createWritable();
        await w.write(Uint8Array.from(bytes));
        await w.close();
        return true;
      } catch {
        return false;
      }
    },
    { name, bytes },
  );
}

const readCanvas = (page: Page, file: string) =>
  page.evaluate(async (f) => {
    try {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("canvases");
      return await (await (await dir.getFileHandle(f)).getFile()).text();
    } catch {
      return null;
    }
  }, file);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
  });
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toContainText("Welcome to", { timeout: 15_000 });
});

test("highlight → drag to the canvas → the card's link opens the PDF at that page and highlight", async ({ page, browserName }) => {
  test.setTimeout(90_000);
  const ann = createPdfAnnotation({ id: ID, source: "bilingual.pdf", page: 2, text: QUOTE, start: 0, end: QUOTE.length, now: new Date("2026-11-15T08:00:00Z") });
  const note = upsertAnnotationsNote(null, "bilingual.pdf", [ann], { title: "Highlights — bilingual.pdf", page: (n) => `p. ${n}`, empty: "_none_" });
  vaultOrSkip((await put(page, "bilingual.pdf", new Uint8Array(PDF))) && (await put(page, "bilingual.pdf.md", note)), browserName);

  // 1. The panel's own drag payload.
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  await page.keyboard.type("All highlights");
  await page.keyboard.press("Enter");
  const item = page.getByTestId("highlight-item").first();
  await expect(item).toBeVisible({ timeout: 15_000 });
  const payload = await item.evaluate((el) => {
    const dt = new DataTransfer();
    el.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
    return dt.getData("application/x-lumen-highlight");
  });
  const drag = JSON.parse(payload) as { pdf: string; id: string; page: number; quote: string };
  expect(drag).toMatchObject({ pdf: "bilingual.pdf", page: 2, quote: QUOTE });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("highlights-panel")).toHaveCount(0);

  // 2. Dropped on the canvas: a card with the highlight's link, saved to the file.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: "view.canvas" } })));
  const canvas = page.getByTestId("canvas");
  await expect(canvas.locator(".excalidraw")).toBeVisible({ timeout: 15_000 });
  await expect(canvas).toHaveAttribute("data-ready", "true");
  const body = canvas.locator(".lumen-canvas-body");
  const box = (await body.boundingBox())!;
  const at = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  await body.evaluate(
    (el, { payload, at }) => {
      const dt = new DataTransfer();
      dt.setData("application/x-lumen-highlight", payload);
      el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: at.x, clientY: at.y }));
    },
    { payload, at },
  );
  const link = `bilingual.pdf#page=2&highlight=${ID.slice(0, 8)}`;
  await expect.poll(() => readCanvas(page, "untitled.excalidraw"), { timeout: 10_000 }).toContain(link);
  const saved = JSON.parse((await readCanvas(page, "untitled.excalidraw"))!) as { elements: Array<{ type: string; link?: string | null; text?: string }> };
  expect(saved.elements.filter((e) => e.link === link)).toHaveLength(1);
  expect(saved.elements.some((e) => e.type === "text" && (e.text ?? "").includes(QUOTE))).toBe(true);

  // 3. Select the card (it was dropped with its top-left at the drop point) and follow its link.
  await page.mouse.click(at.x + 20, at.y + 10);
  const open = canvas.locator(".excalidraw-hyperlinkContainer-link");
  await expect(open).toBeVisible({ timeout: 5_000 });
  await open.click();
  const reader = page.getByTestId("pdf-reader");
  await expect(reader).toBeVisible({ timeout: 15_000 });
  await expect(reader).toHaveAttribute("data-current-page", "2", { timeout: 10_000 });
  const flashed = page.locator(`[data-page-number="2"] [data-highlight-id="${ID.slice(0, 8)}"][data-flash="true"] .pdf-hl-rect`);
  await expect(flashed).toBeVisible({ timeout: 10_000 });
});
