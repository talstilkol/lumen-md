import { test, expect } from "@playwright/test";

// TEMPORARY CI probe for fix/livejs-worker-csp; removed before review.
// Fails on purpose so CI shows the per-engine results in its annotations.
test("PROBE: dynamic import from workers in the opaque-origin runner", async ({ page, browserName }) => {
  const routed: string[] = [];
  await page.context().route(/\.lumen-e2e\.test\//, (route) => {
    routed.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 200, contentType: "text/javascript", body: "export default 1;" });
  });
  await page.addInitScript(() => localStorage.setItem("lumen-tour-done", "1"));
  await page.goto("/");
  const result = await page.evaluate(
    () =>
      new Promise((res) => {
        addEventListener("message", (e) => e.data && e.data.probe && res(e.data.probe));
        const f = document.createElement("iframe");
        f.setAttribute("sandbox", "allow-scripts");
        f.src = "/__probe/frame.html";
        document.body.append(f);
        setTimeout(() => res({ timeout: true }), 60_000);
      }),
  );
  expect(JSON.stringify({ browserName, result, routed: routed.sort() }, null, 1)).toBe("PROBE");
});
