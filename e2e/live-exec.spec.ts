import { test, expect, type Locator } from "@playwright/test";

async function replaceEditorSource(editor: Locator, source: string) {
  await editor.fill(source);
  await expect.poll(async () => {
    const lines = await editor.locator(".cm-line").allTextContents();
    // WebKit can retain one empty leading line after filling CodeMirror.
    return lines[0] === "" ? lines.slice(1) : lines;
  }).toEqual(source.split("\n"));
}

/**
 * REAL execution proof for the live code blocks (master-plan §3). Until now
 * these had smoke-only unit tests ("renders chrome, never loads the
 * runtime") — AND, as this spec uncovered, both runtimes were loaded from a
 * CDN that the app's `script-src 'self'` CSP silently blocked, so the blocks
 * never ran in production. Both runtimes are now self-hosted same-origin
 * (sql.js bundled from npm; Pyodide staged into public/pyodide/ by
 * scripts/copy-pyodide.mjs). This spec boots each real WASM runtime in a
 * browser, runs code, and asserts the COMPUTED output — values that never
 * appear in the source.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
  });
  await page.goto("/");
  await page.locator("header").first().waitFor({ state: "visible", timeout: 5000 });
});

test("live-sql executes a real query via sql.js WASM", async ({ page }) => {
  test.setTimeout(120_000);
  await page.keyboard.press("Meta+2"); // split: source + preview
  const editor = page.locator(".cm-content").first();
  await editor.click();
  // Clear the async-seeded welcome doc, then verify all source lines
  // before running the query so old text cannot enter SQL.
  await editor.fill("");
  await editor.pressSequentially("```live-sql\nSELECT 1000 + 763 AS answer;\n```");
  const sqlLines = editor.locator(".cm-line");
  await expect(sqlLines).toHaveCount(3);
  await expect(sqlLines.nth(0)).toHaveText("```live-sql");
  await expect(sqlLines.nth(1)).toHaveText(/^SELECT 1000 \+ 763 AS [A-Za-z]+;$/);
  await expect(sqlLines.nth(2)).toHaveText("```");

  // Scope to the live-sql block itself (the welcome doc renders its OWN
  // chart-blocks, so `.first()` would grab the wrong one).
  const block = page.locator(".chart-block", {
    has: page.getByRole("button", { name: "Run SQL" }),
  });
  await expect(block).toBeVisible({ timeout: 15_000 });
  await block.getByRole("button", { name: "Run SQL" }).click();

  // WASM init + query — 1763 is computed by SQLite, never present in source.
  await expect(block).toContainText("1763", { timeout: 90_000 });
});

test("live-python executes real Python via Pyodide WASM", async ({ page }) => {
  test.setTimeout(300_000);
  await page.keyboard.press("Meta+2");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await replaceEditorSource(editor, "```live-python\nprint(sum(range(100)) + 7)\n```");

  // Scope to the live-python block (the welcome doc renders other blocks).
  const block = page.locator(".chart-block", {
    has: page.getByRole("button", { name: "Run Python" }),
  });
  await expect(block).toBeVisible({ timeout: 15_000 });
  await block.getByRole("button", { name: "Run Python" }).click();

  // sum(range(100)) + 7 = 4957 — computed by the interpreter; the literal
  // never appears in the source.
  await expect(block).toContainText("4957", { timeout: 240_000 });
});

test("live-glsl compiles and renders a shader on a WebGL canvas", async ({ page }) => {
  test.setTimeout(60_000);
  await page.keyboard.press("Meta+2");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  // fill() sets the value atomically — pressSequentially would trigger
  // CodeMirror's auto-close-brackets and double the shader's braces.
  await replaceEditorSource(editor, "```live-glsl\nvoid main(){ gl_FragColor = vec4(0.9, 0.2, 0.1, 1.0); }\n```\n");

  const webglAvailable = await page.evaluate(() => {
    const probe = document.createElement("canvas");
    return Boolean(probe.getContext("webgl") ?? probe.getContext("experimental-webgl"));
  });
  console.log(`WebGL context available: ${webglAvailable}`);

  const block = page.locator(".chart-block");
  await expect(block).toHaveCount(1, { timeout: 15_000 });
  await expect(block).toBeVisible({ timeout: 15_000 });
  if (!webglAvailable) {
    await expect(block).toContainText("WebGL is not available in this browser.");
    await expect(block.locator("canvas")).toHaveCount(0);
    return;
  }
  const canvas = block.locator("canvas");
  await expect(canvas).toBeVisible({ timeout: 10_000 });

  // The block calls setError on any compile/link failure (or missing WebGL).
  // A clean render with a sized canvas proves the GLSL pipeline executed.
  await expect(block).not.toContainText(/compile failed|link failed|not available/i, {
    timeout: 10_000,
  });
  const box = await canvas.boundingBox();
  expect(box, "GLSL canvas must have a bounding box").not.toBeNull();
  expect(box!.width).toBeGreaterThan(50);
});
