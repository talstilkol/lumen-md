import { test, expect, type Page } from "@playwright/test";
import { freshApp, runCommand, seed } from "./_wave12";

/**
 * Plan W12.V8 in a real browser (wave g6, Mac pack L5): the note graph's
 * time slider — the same TimeSlider component as the entity graph — narrows
 * the graph and its table alternative (W10.E60) by the same notes.
 * Notes carry a `created` day in their frontmatter, so the slider has three
 * days to step through. SYNTHETIC vault, written here. WebKit: no OPFS.
 */

const NOTES: Record<string, string> = {
  "g/a.md": "---\ncreated: 2026-01-01\n---\n# a\n[[b]] [[c]]\n",
  "g/b.md": "---\ncreated: 2026-01-01\n---\n# b\n[[a]]\n",
  "g/c.md": "---\ncreated: 2026-02-01\n---\n# c\n[[d]]\n",
  "g/d.md": "---\ncreated: 2026-03-01\n---\n# d\n[[a]]\n",
  "g/e.md": "---\ncreated: 2026-03-01\n---\n# e\n[[d]]\n",
};

/** The node count the graph's toolbar shows (the first number of graph-stats). */
async function graphNodes(page: Page): Promise<number> {
  const text = (await page.getByTestId("graph-stats").textContent()) ?? "";
  const m = /\d+/.exec(text);
  if (!m) throw new Error(`no count in graph-stats: ${text}`);
  return Number(m[0]);
}

for (const locale of ["he", "en"] as const) {
  test(`W12.V8 (${locale}): the slider narrows the graph and its table by the same notes`, async ({ page, browserName }) => {
    await freshApp(page, browserName, locale);
    await seed(page, NOTES);
    await runCommand(page, "view.graphView");
    const view = page.getByTestId("graph-view");
    await expect(view).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("graph-time-field").selectOption("created");

    const slider = page.getByTestId("graph-time");
    await expect(slider).toHaveAttribute("max", "2");
    await expect.poll(() => graphNodes(page), { timeout: 15_000 }).toBe(5);

    // First day only: a and b. The range input is native, so Home is the browser's own (RTL-aware).
    await slider.focus();
    await page.keyboard.press("Home");
    await expect(slider).toHaveAttribute("aria-valuetext", "2026-01-01");
    await expect.poll(() => graphNodes(page)).toBe(2);

    // The table alternative lists exactly the same notes.
    await page.getByTestId("graph-as-table").click();
    const rows = page.getByTestId("graph-table").locator("tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId("graph-table")).toContainText("a");
    await expect(page.getByTestId("graph-table")).toContainText("b");

    // One day on: c joins, in both.
    await slider.focus();
    // ArrowUp raises a range input in every engine and either direction.
    await page.keyboard.press("ArrowUp");
    await expect(slider).toHaveAttribute("aria-valuetext", "2026-02-01");
    await expect(rows).toHaveCount(3);
    expect(await graphNodes(page)).toBe(3);
  });
}
