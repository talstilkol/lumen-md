import { test, expect } from "@playwright/test";

/**
 * Wiki-links — typing `[[Target]]` in the editor produces a clickable
 * wiki-link in the preview pane. We use the source-mode editor (default)
 * and check that the rendered preview contains an `a.wikilink` element.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
  });
  await page.goto("/");
});

test("typing [[Foo Bar]] in source renders a wikilink in preview", async ({ page }) => {
  // Focus the source editor (left split). CodeMirror exposes a single
  // `.cm-content` editable element.
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.fill("# Test\n\nA [[Foo Bar]] inline link.\n");

  // The split-mode preview should render a wiki-link anchor.
  // Renderer emits `<a class="wiki-link" data-wiki-target="Foo Bar">Foo Bar</a>`.
  const link = page.locator(".wiki-link, [data-wiki-target='Foo Bar']").first();
  await expect(link).toBeVisible({ timeout: 4000 });
});
