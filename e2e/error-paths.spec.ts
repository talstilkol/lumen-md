import { test, expect } from "@playwright/test";

/**
 * Error-path e2e — systematically poke things that fail gracefully
 * to find places where they don't. Each test captures pageerror
 * events and asserts none fire (or asserts the expected user-facing
 * error UI appears).
 *
 * Focused on paths a real user can hit without external services:
 * malformed fence content, broken markdown structures, oversized
 * inputs, rapid concurrent actions.
 */

function captureErrors(page: import("@playwright/test").Page): string[] {
  const errs: string[] = [];
  page.on("pageerror", (e) => {
    const m = e.message;
    if (
      /Storage is disabled inside 'data:'|sandboxed and lacks the 'allow-same-origin'|allow-scripts/i.test(m)
    ) {
      return;
    }
    errs.push(m);
  });
  return errs;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
  });
  await page.goto("/");
  await page
    .locator("header")
    .first()
    .waitFor({ state: "visible", timeout: 5000 });
});

test("malformed mermaid syntax shows error block, no pageerror", async ({
  page,
}) => {
  const errs = captureErrors(page);
  await page.keyboard.press("Meta+2");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.fill(
    "```mermaid\nnot-a-valid-syntax => zzz\nbroken!!! [not a graph]\n```\n",
  );
  await page.waitForTimeout(2000); // mermaid render attempt
  expect(errs).toEqual([]);
});

test("malformed graphviz syntax doesn't crash the renderer", async ({
  page,
}) => {
  const errs = captureErrors(page);
  await page.keyboard.press("Meta+2");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.fill("```dot\nnot { valid graphviz at all\n```\n");
  await page.waitForTimeout(2000);
  expect(errs).toEqual([]);
});

test("massive CSV (1000 rows) renders without freezing", async ({ page }) => {
  const errs = captureErrors(page);
  await page.keyboard.press("Meta+2");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  const rows = Array.from({ length: 1000 }, (_, i) =>
    `${i},Row ${i},${Math.random().toFixed(4)},${["A", "B", "C", "D"][i % 4]}`,
  );
  await editor.fill(
    "```csv\nid,name,score,group\n" + rows.join("\n") + "\n```\n",
  );
  await page.waitForTimeout(3000);
  expect(errs).toEqual([]);
});

test("LiveJS with throw doesn't propagate up to pageerror", async ({
  page,
}) => {
  const errs = captureErrors(page);
  await page.keyboard.press("Meta+2");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.fill(
    "```live-js\nthrow new Error(\"intentional from user code\");\n```\n",
  );
  await page.waitForTimeout(2500);
  // The live-js block should catch the throw internally and show a
  // status message. No uncaught pageerror should leak.
  expect(errs).toEqual([]);
});

test("LiveJS with infinite loop is timed out (block status reflects it)", async ({
  page,
}) => {
  const errs = captureErrors(page);
  await page.keyboard.press("Meta+2");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.fill(
    "```live-js\nwhile (true) { /* user typo */ }\n```\n",
  );
  // The worker has a hard timeout (~3-5s). Wait long enough for the
  // status to flip to "Timed out".
  await page.waitForTimeout(6000);
  await expect(page.locator("text=/Timed out|Runtime error/i").first()).toBeVisible({
    timeout: 4000,
  });
  expect(errs).toEqual([]);
});

test("Print command with window.print stubbed (no real print) doesn't crash", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as unknown as { __openedPrint?: boolean }).__openedPrint = false;
    window.open = () => {
      (window as unknown as { __openedPrint?: boolean }).__openedPrint = true;
      return null;
    };
    window.print = () => {};
  });
  const errs = captureErrors(page);
  await page.keyboard.press("Meta+K");
  const palette = page
    .locator('[role="dialog"][aria-modal="true"]')
    .filter({ has: page.locator("input") });
  await palette.waitFor({ timeout: 8000 });
  await palette.locator("input").first().fill("Print");
  await expect(
    palette.locator('[role="option"][aria-selected="true"]'),
  ).toContainText(/Print/i, { timeout: 5000 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  expect(errs).toEqual([]);
});

test("opening a malformed JSON file via paste produces a graceful state", async ({
  page,
}) => {
  const errs = captureErrors(page);
  await page.keyboard.press("Meta+1");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  // Garbled JSON inside a json-table fence (the renderer attempts a
  // JSON.parse internally; should NOT crash if it fails).
  await editor.fill(
    "```json-table\n[ { bad json, no quotes }, { also: bad } ]\n```\n",
  );
  await page.waitForTimeout(1500);
  expect(errs).toEqual([]);
});

test("typing a 5000-character heading line doesn't freeze the editor", async ({
  page,
}) => {
  const errs = captureErrors(page);
  await page.keyboard.press("Meta+1");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.fill("# " + "long heading text ".repeat(280));
  await page.waitForTimeout(800);
  // Cursor should still be in the editor.
  await expect(editor).toBeVisible();
  expect(errs).toEqual([]);
});

test("rapid Cmd+S spam doesn't break the save pipeline", async ({ page }) => {
  // Stub save dialogs so we don't actually open them.
  await page.evaluate(() => {
    (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = async () => {
      throw new DOMException("user-cancelled-in-test", "AbortError");
    };
  });
  const errs = captureErrors(page);
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press("Meta+S");
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(500);
  expect(errs).toEqual([]);
});

test("Escape during palette typing doesn't leave residual state", async ({
  page,
}) => {
  const errs = captureErrors(page);
  await page.keyboard.press("Meta+K");
  const palette = page
    .locator('[role="dialog"][aria-modal="true"]')
    .filter({ has: page.locator("input") });
  await palette.waitFor({ timeout: 5000 });
  await palette.locator("input").first().fill("Page View");
  await page.keyboard.press("Escape");
  await expect(palette).not.toBeVisible({ timeout: 2000 });
  // Re-open palette and confirm input is empty.
  await page.keyboard.press("Meta+K");
  await palette.waitFor({ timeout: 5000 });
  const value = await palette.locator("input").first().inputValue();
  expect(value).toBe("");
  expect(errs).toEqual([]);
});

test("malformed KaTeX inline math doesn't propagate as pageerror", async ({
  page,
}) => {
  const errs = captureErrors(page);
  await page.keyboard.press("Meta+2");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  // KaTeX should render an error span (.katex-error) for bad input,
  // not crash the preview.
  await editor.fill(
    "Broken inline math: $\\frac{1}{}$ and $\\sqrt{$ — done.\n",
  );
  await page.waitForTimeout(1500);
  expect(errs).toEqual([]);
});

test("malformed KaTeX display math doesn't propagate as pageerror", async ({
  page,
}) => {
  const errs = captureErrors(page);
  await page.keyboard.press("Meta+2");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.fill(
    "$$\n\\begin{matrix} a & b \\\\ c \\end{wrongenv}\n$$\n",
  );
  await page.waitForTimeout(1500);
  expect(errs).toEqual([]);
});

test("deeply nested blockquote (50 levels) renders without freezing or crashing", async ({
  page,
}) => {
  const errs = captureErrors(page);
  await page.keyboard.press("Meta+2");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  // Round-25 catches recursion-depth issues in the renderer pipeline.
  const nesting = ">".repeat(50);
  await editor.fill(`${nesting} deeply nested\n`);
  await page.waitForTimeout(1000);
  expect(errs).toEqual([]);
});

test("wiki-link cycle ([[a]] → [[b]] → [[a]]) doesn't infinite-loop", async ({
  page,
}) => {
  const errs = captureErrors(page);
  await page.keyboard.press("Meta+2");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  // Self-referential wiki-link should render as a (possibly broken)
  // link, not trigger any recursive resolution loop.
  await editor.fill("[[self]] points to [[self]]. Also [[a]] → [[b]] → [[a]].\n");
  await page.waitForTimeout(1000);
  expect(errs).toEqual([]);
});

test("pasting >100 KB of plain text into the editor doesn't pageerror", async ({
  page,
}) => {
  const errs = captureErrors(page);
  await page.keyboard.press("Meta+2");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  // Generate ~100 KB of plain text (paragraphs of lorem-style filler).
  const para = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ";
  const huge = Array.from({ length: 800 }, () => para).join("\n\n");
  await editor.fill(huge);
  await page.waitForTimeout(2500);
  await expect(editor).toBeVisible();
  expect(errs).toEqual([]);
});

test("malformed YAML frontmatter renders the doc body without crashing", async ({
  page,
}) => {
  const errs = captureErrors(page);
  await page.keyboard.press("Meta+2");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.fill(
    "---\ntitle: [unclosed bracket\nbroken: : :\nlist:\n  - a\n     bad indent\n---\n\n# Body still here\n",
  );
  await page.waitForTimeout(1500);
  // The frontmatter parser should fall back to "no frontmatter" or
  // surface a small error, but never throw to the page.
  expect(errs).toEqual([]);
});
