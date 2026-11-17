import { test, expect, type Page } from "@playwright/test";
import { freshApp, seed, axeBlocking } from "./_wave12";

/**
 * Plan W13.R8 — the compare view: two notes picked in the file tree,
 * compared word by word, in two columns (the old one on the right in
 * Hebrew) or inline; prefix-only changes mark only the prefix; F7 /
 * Shift+F7 move between changes and announce them; axe has nothing serious.
 *
 * Bidi: the marks are plain inline elements, so a paragraph with marks is
 * laid out exactly as the same text without them — checked here by
 * comparing where each character lands with and without the marks.
 */

const OLD = "# הערות\n\nהבית גדול ב-Tel Aviv ובו 3 חדרים.\n\nפסקה שלא השתנתה.\n\nThe cat sat on the mat.\n";
const NEW = "# הערות\n\nובית גדול ב-Tel Aviv ובו 4 חדרים.\n\nפסקה שלא השתנתה.\n\nThe dog sat on the mat.\n";

async function openCompare(page: Page) {
  await seed(page, { "a.md": OLD, "b.md": NEW });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: "view.workspace" } })));
  const tree = page.locator(".file-tree-list");
  await expect(tree).toBeVisible({ timeout: 15_000 });
  await tree.getByText("a.md", { exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Select for compare|בחירה להשוואה/ }).click();
  await tree.getByText("b.md", { exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Compare with|השוואה עם/ }).click();
  const view = page.getByTestId("compare-view");
  await expect(view).toBeVisible();
  return view;
}

for (const locale of ["he", "en"] as const) {
  test(`two notes word by word (${locale}): columns in the right order, prefix marks, F7`, async ({ page, browserName }) => {
    await freshApp(page, browserName, locale);
    const view = await openCompare(page);
    await expect(view).toHaveAttribute("data-changes", "3");
    // The old column first: on the right in RTL, on the left in LTR.
    const oldX = (await page.getByTestId("compare-old-label").boundingBox())!.x;
    const newX = (await page.getByTestId("compare-new-label").boundingBox())!.x;
    if (locale === "he") expect(oldX).toBeGreaterThan(newX);
    else expect(oldX).toBeLessThan(newX);
    // הבית → ובית: only the prefix letter is marked, the word stays whole.
    await expect(view.locator(".cmp-old .cmp-word del")).toHaveText("ה");
    await expect(view.locator(".cmp-new .cmp-word ins")).toHaveText("ו");
    await page.keyboard.press("F7");
    await expect(page.getByTestId("compare-count")).toContainText("1");
    await page.keyboard.press("F7");
    await page.keyboard.press("Shift+F7");
    await expect(page.getByTestId("compare-count")).toContainText("1");
    await expect(view.locator(".cmp-current").first()).toBeVisible();
    expect(await axeBlocking(page, "[data-testid=compare-view]")).toEqual([]);
  });
}

test("the marks do not move a single character (bidi order is the plain text's)", async ({ page, browserName }) => {
  await freshApp(page, browserName, "he");
  const view = await openCompare(page);
  await page.getByTestId("compare-inline").click();
  const para = view.locator(".cmp-para").nth(1);
  await expect(para).toContainText("Tel Aviv");
  const same = await para.evaluate((p) => {
    // Each character's x in the marked paragraph, then in a copy with the marks unwrapped.
    const xs = (root: Element) => {
      const out: number[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        for (let i = 0; i < (n.textContent ?? "").length; i++) {
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + 1);
          out.push(Math.round(r.getBoundingClientRect().left));
        }
      }
      return out;
    };
    const plain = p.cloneNode(true) as HTMLElement;
    plain.querySelectorAll("ins, del, span").forEach((m) => m.replaceWith(...Array.from(m.childNodes)));
    plain.style.position = "absolute";
    plain.style.top = `${p.getBoundingClientRect().top}px`;
    plain.style.width = `${p.getBoundingClientRect().width}px`;
    plain.style.left = `${p.getBoundingClientRect().left}px`;
    p.parentElement!.append(plain);
    const a = xs(p);
    const b = xs(plain);
    plain.remove();
    return a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= 1);
  });
  expect(same).toBe(true);
});

test("from the version history: compare a version with the current text", async ({ page, browserName }) => {
  await freshApp(page, browserName, "en");
  await seed(page, { "v.md": "first text" });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lumen-open-file", { detail: { path: "v.md" } })));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: "view.versionHistory" } })));
  const history = page.getByTestId("version-history");
  await expect(history).toHaveAttribute("data-ready", "true");
  const first = history.getByRole("button").filter({ hasText: /chars/ }).first();
  if ((await first.count()) === 0) await history.getByRole("button", { name: /Keep a version now|Keep/ }).click();
  await history.getByRole("button").filter({ hasText: /chars/ }).first().click();
  await page.getByTestId("version-compare").click();
  await expect(page.getByTestId("compare-view")).toBeVisible();
  await expect(page.getByTestId("compare-new-label")).toContainText("Current text");
});
