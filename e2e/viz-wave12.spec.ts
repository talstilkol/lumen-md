import { test, expect } from "@playwright/test";
import { axeBlocking, freshApp, seed, setNote } from "./_wave12";

/**
 * Wave 12 views in a real browser (wave g6, Mac pack L5 — the parts that
 * vizGate.test.tsx checks only on a static DOM):
 *
 *   W12.V1  the six chart kinds of a ```dataview block, in Hebrew (RTL) and
 *           English (LTR): axe clean on each figure, the table alternative
 *           holds the chart's rows, and one visual baseline per kind and
 *           direction in Chromium (a missing baseline fails; only
 *           `npm run visual:approve -- wave12` writes them, W10.B16).
 *   W12.V3  a ```structure block of this note's headings: an ARIA tree that
 *           the keyboard walks, axe clean, an RTL baseline.
 *   W12.V6  a `layout: dashboard` note with 8 blocks over a seeded vault
 *           (DASHBOARD_NOTES, default 10,000 — the acceptance) draws all 8
 *           in under a second after the vault is indexed.
 *
 * The vault is OPFS: WebKit in Playwright has none (vaultOrSkip). The data
 * is SYNTHETIC, written here.
 */

const BOOKS: Record<string, string> = {
  "books/א.md": "---\ntags: [book]\nstatus: נקרא\ngenre: שירה\npages: 120\nrating: 4\nread: 2026-01-05\n---\n# א\n",
  "books/ב.md": "---\ntags: [book]\nstatus: נקרא\ngenre: פרוזה\npages: 300\nrating: 5\nread: 2026-01-05\n---\n# ב\n",
  "books/ג.md": "---\ntags: [book]\nstatus: בקריאה\ngenre: פרוזה\npages: 210\nrating: 3\nread: 2026-02-01\n---\n# ג\n",
  "books/ד.md": "---\ntags: [book]\nstatus: רשימה\ngenre: Essays\npages: 80\nrating: 2\nread: 2026-03-14\n---\n# ד\n",
};

/** Each kind, its chart lines, and how many rows its table alternative must hold for BOOKS (chartModel.chartTable). */
const KINDS: { kind: string; lines: string[]; rows: number }[] = [
  { kind: "bar", lines: ["chart: bar", "chart-x: status", "chart-y: pages"], rows: 3 },
  { kind: "line", lines: ["chart: line", "chart-x: read"], rows: 3 },
  { kind: "pie", lines: ["chart: pie", "chart-x: genre"], rows: 3 },
  { kind: "scatter", lines: ["chart: scatter", "chart-x: pages", "chart-y: rating", "chart-series: genre"], rows: 4 },
  { kind: "heatmap", lines: ["chart: heatmap", "chart-x: status", "chart-series: genre"], rows: 3 },
  { kind: "calendar", lines: ["chart: calendar", "chart-x: read", "chart-y: pages"], rows: 3 },
];

const block = (lines: string[]) => ["```dataview", "TABLE status, genre, pages, rating, read FROM #book", ...lines, "```"].join("\n");

for (const locale of ["he", "en"] as const) {
  const dir = locale === "he" ? "rtl" : "ltr";
  test.describe(`W12.V1 charts (${dir})`, () => {
    test.beforeEach(async ({ page, browserName }) => {
      await freshApp(page, browserName, locale);
      await seed(page, BOOKS);
      await page.keyboard.press("Meta+2");
    });

    for (const k of KINDS) {
      test(`${k.kind}: axe clean, its table holds the data, and its ${dir} baseline`, async ({ page, browserName }) => {
        await setNote(page, `# ${k.kind}\n\n${block(k.lines)}\n`);
        const fig = page.locator(`figure.lumen-viz[data-viz-kind="${k.kind}"]`);
        await expect(fig).toBeVisible({ timeout: 20_000 });
        await expect(fig).toHaveAttribute("dir", dir);

        // The alternative: the switch opens a table with one row per data point (W12.V7).
        const table = fig.locator("table[data-viz-table]");
        await fig.locator("button[data-viz-switch]").click();
        await expect(table).toBeVisible();
        await expect(table.locator("tbody tr")).toHaveCount(k.rows);

        const violations = await axeBlocking(page, `figure.lumen-viz[data-viz-kind="${k.kind}"]`);
        expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);

        // Back to the picture for the baseline.
        await fig.locator("button[data-viz-switch]").click();
        await expect(table).toBeHidden();
        // Baselines are Chromium's only (`npm run visual:approve -- wave12`); the other engines check the rest.
        if (browserName === "chromium") await expect(fig).toHaveScreenshot(`viz-${k.kind}-${dir}.png`, { maxDiffPixelRatio: 0.01, animations: "disabled" });
      });
    }
  });
}

test.describe("W12.V3 structure block (rtl)", () => {
  test("the headings tree is an ARIA tree the keyboard walks, axe clean, with an RTL baseline", async ({ page, browserName }) => {
    await freshApp(page, browserName, "he");
    await page.keyboard.press("Meta+2");
    await setNote(page, ["# מבוא", "## רקע", "## שיטה", "# תוצאות", "# סיכום", "", "```structure", "source: headings", "view: tree", "```", ""].join("\n"));
    const tree = page.locator('ul[role="tree"].lumen-viz-tree');
    await expect(tree).toBeVisible({ timeout: 20_000 });
    await expect(tree).toHaveAttribute("dir", "rtl");
    const items = tree.locator('[role="treeitem"]');
    await expect(items.first()).toHaveAttribute("tabindex", "0");

    // The roving focus moves with the arrow keys: one item has tabindex 0 at a time.
    await items.first().focus();
    await page.keyboard.press("ArrowDown");
    await expect(tree.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1);
    await expect(items.first()).toHaveAttribute("tabindex", "-1");

    const violations = await axeBlocking(page, 'ul[role="tree"].lumen-viz-tree');
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
    if (browserName === "chromium") await expect(tree).toHaveScreenshot("viz-structure-tree-rtl.png", { maxDiffPixelRatio: 0.01, animations: "disabled" });
  });
});

test.describe("W12.V6 dashboard note", () => {
  test.setTimeout(600_000);
  test("8 blocks over the seeded vault are all drawn within 1 s of opening the note", async ({ page, browserName }) => {
    const n = Number(process.env.DASHBOARD_NOTES ?? 10_000);
    await freshApp(page, browserName, "he");
    // Seed in chunks so one evaluate never carries the whole vault.
    for (let i = 0; i < n; i += 500) {
      const chunk: Record<string, string> = {};
      for (let j = i; j < Math.min(n, i + 500); j++) {
        const tag = ["project", "book", "idea", "person"][j % 4];
        chunk[`vault/${tag}/n${j}.md`] = `---\ntags: [${tag}]\nstatus: ${["open", "done", "blocked"][j % 3]}\npages: ${(j % 300) + 1}\nread: 2026-0${(j % 9) + 1}-1${j % 10}\n---\n# n${j}\n\nטקסט ${j} #${tag}\n`;
      }
      await seed(page, chunk);
    }
    await page.evaluate(async () => {
      const m = await (window as unknown as { __lumen: { vaultIndex(): Promise<{ ensureIndex(force?: boolean): Promise<void> }> } }).__lumen.vaultIndex();
      await m.ensureIndex(true);
    });
    await page.keyboard.press("Meta+2");

    const q = (body: string[]) => ["```query", ...body, "```"].join("\n");
    const dv = (body: string[]) => ["```dataview", ...body, "```"].join("\n");
    const widgets = [
      q(["tag:project", "limit: 20"]),
      q(["tag:book", "view: table", "limit: 20"]),
      dv(["TABLE status, pages FROM #project LIMIT 20"]),
      dv(["LIST FROM #idea LIMIT 20"]),
      dv(["TABLE status FROM #book", "chart: bar", "chart-x: status"]),
      dv(["TABLE pages FROM #person", "chart: pie", "chart-x: status"]),
      dv(["TABLE read, pages FROM #project", "chart: calendar", "chart-x: read", "chart-y: pages"]),
      ["```structure", "source: tags", "view: tree", "```"].join("\n"),
    ];
    const note = ["---", "layout: dashboard", "dashboard-columns: 3", "---", "# לוח", "", ...widgets.flatMap((w) => [w, ""])].join("\n");

    const t0 = Date.now();
    await setNote(page, note);
    const grid = page.locator(".lumen-dashboard");
    await expect(grid).toBeVisible({ timeout: 20_000 });
    // Every widget has content: a result list/table, a chart figure or the tree.
    const done = page.locator(".lumen-dashboard .lumen-query-block:has(a.wiki-link, tbody tr, figure.lumen-viz), .lumen-dashboard ul[role='tree']");
    await expect(done).toHaveCount(8, { timeout: 30_000 });
    const ms = Date.now() - t0;
    test.info().annotations.push({ type: "perf", description: JSON.stringify({ id: "W12.V6", notes: n, widgets: 8, ms }) });
    expect(ms, `8 widgets over ${n} notes took ${ms} ms`).toBeLessThan(1_000);
  });
});
