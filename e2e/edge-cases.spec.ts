import { test, expect } from "@playwright/test";

/**
 * Edge-case e2e — scenarios real users hit that the happy-path tests
 * miss. The audit cadence has consistently found bugs by changing the
 * type of evidence collected; these tests change the type of INPUT.
 */

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

test("malformed code fence (unclosed ```) doesn't crash the preview", async ({
  page,
}) => {
  await page.keyboard.press("Meta+2");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  // Unclosed fence — extends to EOF. The CM6 highlighter handles it
  // gracefully; the question is whether the preview pipeline survives.
  await editor.fill("# Hello\n\n```\nlet x = 1;\nlet y = 2;\n");
  // Wait for any rendering to settle.
  await page.waitForTimeout(800);
  // Preview should still show the H1 — unclosed fence shouldn't take
  // the whole pipeline down.
  await expect(
    page.locator(".markdown-preview h1, [data-preview-root] h1").first(),
  ).toBeVisible({ timeout: 5000 });
});

test("unmatched [[wiki link bracket doesn't crash the renderer", async ({
  page,
}) => {
  await page.keyboard.press("Meta+2");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.fill("# Notes\n\nThis [[link is broken without closing brackets.");
  await page.waitForTimeout(500);
  await expect(
    page.locator(".markdown-preview h1, [data-preview-root] h1").first(),
  ).toBeVisible({ timeout: 5000 });
});

test("a 10 000-character doc renders without freezing", async ({ page }) => {
  await page.keyboard.press("Meta+2");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  // Programmatically populate so we don't wait for keystrokes.
  const big = ["# Big document", "", ...Array.from({ length: 200 }, (_, i) =>
    `Paragraph ${i + 1}. Lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
  )].join("\n");
  await editor.fill(big);
  await page.waitForTimeout(1500);
  // Preview heading should still be there.
  await expect(
    page.locator(".markdown-preview h1, [data-preview-root] h1").first(),
  ).toBeVisible({ timeout: 8000 });
  // The status bar word/char counter (if visible) should reflect the big doc.
  // Status bar formats counts with comma separators ("12,304 chars"), so
  // match digit-groups with optional thousands-separators (≥ 1000).
  const statusBar = page.locator(".status-bar").first();
  if (await statusBar.isVisible().catch(() => false)) {
    const text = (await statusBar.textContent()) ?? "";
    expect(text, "status bar should show a large word/char count").toMatch(
      /[\d,]{4,}\s*(words|chars)/,
    );
  }
});

test("malformed JSON inside ```json renders without crashing", async ({
  page,
}) => {
  await page.keyboard.press("Meta+2");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.fill(
    "```json\n{ not valid json, missing quotes around: key }\n```\n",
  );
  await page.waitForTimeout(500);
  // The pipeline should still mount; JSON-table is a separate block.
  // We just need no page error.
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.waitForTimeout(500);
  expect(pageErrors).toEqual([]);
});

test("rapid mode flips (Meta+1234) don't leave the editor in a broken state", async ({
  page,
}) => {
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press("Meta+1");
    await page.keyboard.press("Meta+2");
    await page.keyboard.press("Meta+3");
  }
  // After all that thrashing, settling on split mode should still
  // render both panes.
  await page.keyboard.press("Meta+2");
  await page.waitForTimeout(500);
  await expect(page.locator(".cm-content").first()).toBeVisible();
});

test("Escape closes any open menu / dialog reliably", async ({ page }) => {
  // Open file menu, then Escape.
  await page.locator("header button:has-text('File')").click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  // Open palette, then Escape.
  await page.keyboard.press("Meta+K");
  const palette = page.locator('[role="dialog"][aria-modal="true"]');
  await palette.waitFor({ timeout: 5000 });
  await page.keyboard.press("Escape");
  await expect(palette).not.toBeVisible({ timeout: 2000 });
  // Open shortcuts dialog, then Escape.
  await page.keyboard.press("Meta+/");
  await page.waitForTimeout(200);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  // App should be in normal state.
  await expect(page.locator(".cm-content").first()).toBeVisible();
});

test("typing then Cmd+Z undoes the last keystrokes", async ({ page }) => {
  await page.keyboard.press("Meta+1");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.fill("seed text");
  await page.keyboard.press("End");
  await page.keyboard.type(" — added");
  // The full text should be "seed text — added".
  await expect(editor).toContainText("seed text — added");
  // Re-focus the editor before issuing Cmd+Z — otherwise a focus drift
  // (e.g. the Cmd press itself raising a menu) sends the keybinding to
  // the page chrome instead of CM6 and undo silently no-ops. Click the
  // editor inside Playwright's act() so the focus has time to settle.
  await editor.click();
  // Undo via Cmd+Z. CM6 typically groups bursts of consecutive
  // keystrokes into one checkpoint, so a handful of presses is plenty
  // to walk back to "seed text" or further.
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press("Meta+Z");
    await page.waitForTimeout(30);
  }
  // After undo, the " — added" suffix should be gone.
  const text = (await editor.textContent()) ?? "";
  expect(text).not.toContain(" — added");
});
