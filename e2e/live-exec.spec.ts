import { test, expect } from "@playwright/test";

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
  // The welcome doc is seeded after mount. Wait for it, so the tests'
  // select-all + type replaces it instead of racing it (WebKit typed into a
  // half-seeded doc and the block swallowed welcome text).
  await expect(page.locator(".cm-content").first()).toContainText("Welcome to", { timeout: 15_000 });
});

test("live-sql executes a real query via sql.js WASM", async ({ page }) => {
  test.setTimeout(120_000);
  await page.keyboard.press("Meta+2"); // split: source + preview
  const editor = page.locator(".cm-content").first();
  await editor.click();
  // Use a SELECT-all + type so the async-seeded welcome doc can't survive
  // alongside our block, and a value (1763) that appears nowhere else.
  await editor.press("ControlOrMeta+a");
  await editor.fill("```live-sql\nSELECT 1000 + 763 AS answer;\n```\n");

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
  await editor.press("ControlOrMeta+a");
  await editor.fill("```live-python\nprint(sum(range(100)) + 7)\n```\n");

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
  await editor.fill("```live-glsl\nvoid main(){ gl_FragColor = vec4(0.9, 0.2, 0.1, 1.0); }\n```\n");

  // The block renders an error view WITHOUT a canvas when WebGL is missing
  // or the shader fails; assert on the error text first so a failure says
  // which one it was instead of just "no canvas".
  const anyGlsl = page.locator(".chart-block", { hasText: /GLSL/ }).first();
  await expect(anyGlsl).toBeVisible({ timeout: 15_000 });
  await expect(anyGlsl).not.toContainText("GLSL error", { timeout: 5_000 }).catch(async (err: Error) => {
    // Say what the browser offers, so "no WebGL" is distinguishable from a bug.
    const env = await page.evaluate(() => {
      const c = document.createElement("canvas");
      const msgs: string[] = [];
      c.addEventListener("webglcontextcreationerror", (e) => msgs.push((e as WebGLContextEvent).statusMessage));
      const gl1 = !!c.getContext("webgl");
      const gl2 = !!document.createElement("canvas").getContext("webgl2");
      return `webgl=${gl1} webgl2=${gl2} reasons=[${msgs.join(" | ")}] ua=${navigator.userAgent}`;
    });
    throw new Error(`${err.message.split("\n")[0]}\nblock: ${await anyGlsl.innerText()}\nenv: ${env}`);
  });
  const block = page.locator(".chart-block", { has: page.locator("canvas") });
  await expect(block).toBeVisible({ timeout: 15_000 });
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

test("live-lua executes real Lua via wasmoon WASM in a worker", async ({ page }) => {
  test.setTimeout(120_000);
  await page.keyboard.press("Meta+2");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await editor.fill("```live-lua\nlocal s = 0\nfor i = 1, 100 do s = s + i end\nprint(s + 13)\n```\n");

  // Diagnostics: Firefox/WebKit CI runs stalled at "Running…" without the
  // hard-kill timer ever firing, and job logs aren't reachable — so a failure
  // must carry what the page saw (console, page errors, worker lifecycle,
  // whether the main thread still answers) in its own message.
  const diag: string[] = [];
  page.on("console", (m) => diag.push(`console.${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => diag.push(`pageerror: ${e.message}`));
  page.on("worker", (w) => {
    diag.push(`worker started: ${w.url()}`);
    w.on("close", () => diag.push(`worker closed: ${w.url()}`));
  });
  page.on("requestfailed", (r) => diag.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ""}`));

  const block = page.locator('[data-testid="live-lua"]');
  await expect(block).toBeVisible({ timeout: 15_000 });
  await block.getByRole("button", { name: "Run" }).click();

  // 5050 + 13 = 5063 — computed by the Lua VM, never present in the source.
  try {
    await expect(block).toContainText("5063", { timeout: 60_000 });
  } catch (err) {
    const alive = await Promise.race([
      page.evaluate(() => "main thread responsive").catch((e: Error) => `evaluate failed: ${e.message}`),
      new Promise<string>((r) => setTimeout(() => r("main thread BLOCKED (evaluate timed out)"), 5_000)),
    ]);
    const state = await block.getAttribute("data-state", { timeout: 2_000 }).catch(() => "?");
    const text = await block.innerText({ timeout: 2_000 }).catch(() => "?");
    const blocks = await block.count();
    const doc = await editor.innerText({ timeout: 2_000 }).catch(() => "?");
    throw new Error(
      `live-lua never printed 5063. blocks=${blocks} data-state=${state}; ${alive}\nblock: ${text.slice(0, 400)}\n` +
        `editor: ${doc.slice(0, 300)}\n` +
        diag.slice(-40).join("\n") +
        `\n--- ${(err as Error).message.split("\n")[0]}`,
    );
  }
});

test("live-r executes real R via webR and draws a plot", async ({ page }) => {
  test.setTimeout(240_000);
  await page.keyboard.press("Meta+2");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await editor.fill("```live-r\nx <- 1:100\ncat(sum(x) + 37, \"\\n\")\nplot(x, x^2)\n```\n");

  const diag: string[] = [];
  page.on("console", (m) => diag.push(`console.${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => diag.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => diag.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ""}`));

  const block = page.locator('[data-testid="live-r"]');
  await expect(block).toBeVisible({ timeout: 15_000 });
  await block.getByRole("button", { name: "Run" }).click();

  // 5050 + 37 = 5087 — computed by R, never present in the source.
  try {
    await expect(block).toContainText("5087", { timeout: 200_000 });
  } catch (err) {
    const state = await block.getAttribute("data-state").catch(() => "?");
    const text = await block.innerText().catch(() => "?");
    throw new Error(`live-r never printed 5087. data-state=${state}\nblock: ${text.slice(0, 400)}\n${diag.slice(-25).join("\n")}\n${String(err)}`);
  }
  await expect(block.locator("canvas")).toHaveCount(1);
  await expect(block).toHaveAttribute("data-state", "success");
});

test("live-ruby executes real Ruby via ruby.wasm in a sandboxed worker", async ({ page }) => {
  test.setTimeout(240_000);
  await page.keyboard.press("Meta+2");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.press("ControlOrMeta+a");
  // The JS bridge is refused (the worker is sandboxed); the rest runs.
  await editor.fill(
    '```live-ruby\nputs (1..100).sum + 41\nbegin\n  require "js"\nrescue LoadError => e\n  puts "blocked: #{e.message[0, 13]}"\nend\n[1, 2].map { _1 * 3 }\n```\n',
  );

  const diag: string[] = [];
  page.on("console", (m) => diag.push(`console.${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => diag.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => diag.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ""}`));

  const block = page.locator('[data-testid="live-ruby"]');
  await expect(block).toBeVisible({ timeout: 15_000 });
  await block.getByRole("button", { name: "Run" }).click();

  // 5050 + 41 = 5091 — computed by Ruby, never present in the source.
  try {
    await expect(block).toContainText("5091", { timeout: 200_000 });
  } catch (err) {
    const state = await block.getAttribute("data-state").catch(() => "?");
    const text = await block.innerText().catch(() => "?");
    throw new Error(`live-ruby never printed 5091. data-state=${state}\nblock: ${text.slice(0, 400)}\n${diag.slice(-25).join("\n")}\n${String(err)}`);
  }
  await expect(block).toContainText("blocked: The JS bridge");
  await expect(block).toContainText("=> [3, 6]");
  await expect(block).toHaveAttribute("data-state", "success");

  // A runaway loop is killed by the page and the next Run works again.
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await editor.fill("```live-ruby timeout=1500\nloop {}\n```\n\n```live-ruby\nputs 6 * 7\n```\n");
  const [looping, after] = [block.nth(0), block.nth(1)];
  await looping.getByRole("button", { name: "Run" }).click();
  await expect(looping).toHaveAttribute("data-state", "timeout", { timeout: 60_000 });
  await after.getByRole("button", { name: "Run" }).click();
  await expect(after).toContainText("42", { timeout: 120_000 });
});
