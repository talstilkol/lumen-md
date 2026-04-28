import { test, expect } from "@playwright/test";

/**
 * Mermaid block — entering a fenced ```mermaid``` block in source produces
 * an inline SVG diagram in the preview pane. Mermaid is lazy-loaded so we
 * give the chunk fetch some time to land.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
  });
  await page.goto("/");
});

test("a mermaid fence renders as inline SVG in the preview", async ({ page }) => {
  const editor = page.locator(".cm-content").first();
  await editor.click();
  // \`\`\`mermaid
  // graph LR; A --> B
  // \`\`\`
  await editor.fill(
    "```mermaid\ngraph LR\n  A --> B\n  B --> C\n```\n",
  );

  // Mermaid is dynamic-imported on first render — give it 8 s.
  const svg = page.locator(".mermaid-block svg, [data-lumen-block='mermaid'] svg").first();
  await expect(svg).toBeVisible({ timeout: 8_000 });
});
