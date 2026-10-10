import { test, expect } from "@playwright/test";

const PYODIDE_ASSETS = [
  "/pyodide/pyodide.js",
  "/pyodide/pyodide-lock.json",
  "/pyodide/python_stdlib.zip",
  "/pyodide/pyodide.asm.wasm",
  "/pyodide/pyodide.asm.mjs",
];

test("live Python runs on first offline use after service worker install", async ({
  page,
  context,
}) => {
  test.skip(!process.env.PLAYWRIGHT_BASE_URL, "requires the production service worker");
  test.setTimeout(240_000);

  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
  });
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  await expect.poll(async () =>
    page.evaluate(async (paths) => {
      const requests = (await Promise.all(
        (await caches.keys()).map(async (name) => (await caches.open(name)).keys()),
      )).flat();
      const cachedPaths = new Set(requests.map((request) => new URL(request.url).pathname));
      return paths.map((path) => cachedPaths.has(path));
    }, PYODIDE_ASSETS),
  ).toEqual(PYODIDE_ASSETS.map(() => true));

  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  expect(await page.evaluate(() =>
    performance.getEntriesByType("resource").filter((entry) => entry.name.includes("/pyodide/")).length,
  )).toBe(0);

  await context.setOffline(true);
  await page.reload();
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  const editor = page.locator(".cm-content").first();
  await expect(editor).toBeVisible();
  const source = "```live-python\nprint(sum(range(100)) + 7)\n```";
  await editor.fill(source);
  await expect.poll(async () => {
    const lines = await editor.locator(".cm-line").allTextContents();
    return lines[0] === "" ? lines.slice(1) : lines;
  }).toEqual(source.split("\n"));

  const block = page.locator(".chart-block", {
    has: page.getByRole("button", { name: "Run Python" }),
  });
  await expect(block).toBeVisible({ timeout: 15_000 });
  await block.getByRole("button", { name: "Run Python" }).click();
  await expect(block).toContainText("4957", { timeout: 180_000 });
});
