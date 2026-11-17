import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { axeBlocking, freshApp, runCommand, setNote } from "./_wave12";

/**
 * W13.R11: the page of the Talmud. Berakhot 2a (e2e/fixtures/daf: the
 * Mishnah and Gemara, Rashi and Tosafot — public-domain texts) opens from
 * the palette as a daf: no two texts' line boxes overlap, Rashi is on the
 * right on amud a and on the left on amud b, Tosafot on the other side; the
 * linear alternative passes axe; no request is made.
 */
const MD = readFileSync(join(__dirname, "fixtures", "daf", "berakhot-2a.md"), "utf8");

async function sides(page: Page) {
  return page.evaluate(() => {
    const pageEl = document.querySelector(".daf-page") as HTMLElement;
    const box = pageEl.getBoundingClientRect();
    const lines: Record<string, DOMRect[]> = {};
    pageEl.querySelectorAll<HTMLElement>(".daf-layer").forEach((l) => {
      const out: DOMRect[] = [];
      const tw = document.createTreeWalker(l, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = tw.nextNode())) {
        if ((n.parentElement as HTMLElement).closest(".daf-heading")) continue;
        const r = document.createRange();
        r.selectNodeContents(n);
        for (const x of Array.from(r.getClientRects())) if (x.width > 0.5) out.push(x);
      }
      lines[l.dataset.slot!] = out;
    });
    let overlaps = 0;
    const slots = Object.keys(lines);
    for (let i = 0; i < slots.length; i++)
      for (let j = i + 1; j < slots.length; j++)
        for (const a of lines[slots[i]]) for (const b of lines[slots[j]]) if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) overlaps++;
    // Where a commentary sits: the middle of its lines, beside the main text (below the lead band).
    const mid = (s: string) => {
      const r = lines[s].slice(6, -2);
      return r.reduce((a, x) => a + (x.left + x.right) / 2, 0) / r.length - box.left;
    };
    return { overlaps, width: box.width, inner: mid("inner"), outer: mid("outer"), counts: slots.map((s) => lines[s].length) };
  });
}

test("Berakhot 2a as a daf: Rashi and Tosafot on the right sides, no overlap; linear view passes axe", async ({ page, browserName }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await freshApp(page, browserName, "he");
  const requests: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).origin !== new URL(page.url()).origin && !/^(data|blob):/.test(r.url())) requests.push(r.url());
  });
  await setNote(page, MD);
  await runCommand(page, "view.daf");
  const view = page.getByTestId("daf-view");
  await expect(view).toHaveAttribute("data-ready", "true", { timeout: 15_000 });
  await expect(view).toHaveAttribute("data-mode", "page");

  const a = await sides(page);
  expect(a.overlaps).toBe(0);
  expect(a.inner).toBeGreaterThan(a.width / 2); // amud a: Rashi on the right
  expect(a.outer).toBeLessThan(a.width / 2); //   and Tosafot on the left

  await page.getByTestId("daf-side").selectOption("left");
  await expect(view).toHaveAttribute("data-inner-side", "left");
  await expect(view).toHaveAttribute("data-ready", "true");
  const b = await sides(page);
  expect(b.overlaps).toBe(0);
  expect(b.inner).toBeLessThan(b.width / 2);
  expect(b.outer).toBeGreaterThan(b.width / 2);

  await page.getByTestId("daf-mode-linear").click();
  await expect(view).toHaveAttribute("data-mode", "linear");
  await expect(page.getByTestId("daf-linear").getByRole("heading", { level: 2 })).toHaveCount(4);
  expect(await axeBlocking(page, "[data-testid=daf-view]")).toEqual([]);
  expect(requests).toEqual([]);
});

test("a narrow window shows the texts one after another", async ({ page, browserName }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await freshApp(page, browserName, "he");
  await setNote(page, MD);
  await runCommand(page, "view.daf");
  await expect(page.getByTestId("daf-view")).toHaveAttribute("data-mode", "linear", { timeout: 15_000 });
  expect(await axeBlocking(page, "[data-testid=daf-view]")).toEqual([]);
});
