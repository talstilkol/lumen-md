import { test, expect, type Page } from "@playwright/test";
import { vaultOrSkip } from "./_opfs";

/**
 * Plan W1.12 — the calendar and the big table of a `.base`, in the running app:
 *
 *  - calendar drag round-trip: a note dragged with the mouse to another day
 *    changes only its date property on disk; dragged back, the file is byte
 *    for byte what it was (every other line, comment and CRLF kept);
 *  - 10,000 rows: the table virtualizes (only a window of rows in the DOM)
 *    and scrolls at ≥ 55 fps (asserted on a GPU; reported under software
 *    rendering, as e2e/perf-vault.spec.ts does; @nightly: the "perf"
 *    project). The filter half (< 100 ms over 10,000 rows) is timed on the
 *    evaluator itself, without the file watcher's debounce, in
 *    src/__tests__/basesRelations.test.ts.
 */

async function writeFiles(page: Page, files: Record<string, string>): Promise<boolean> {
  return page.evaluate(async (all) => {
    try {
      const root = await navigator.storage.getDirectory();
      const probe = (await root.getFileHandle("__probe", { create: true })) as FileSystemFileHandle & { createWritable?: unknown };
      await root.removeEntry("__probe");
      if (typeof probe.createWritable !== "function") return false;
      for (const [path, text] of Object.entries(all)) {
        const parts = path.split("/");
        const name = parts.pop()!;
        let dir = root;
        for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
        const w = await (await dir.getFileHandle(name, { create: true }) as unknown as { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable();
        await w.write(text);
        await w.close();
      }
      return true;
    } catch {
      return false;
    }
  }, files);
}

async function readFile(page: Page, path: string): Promise<string> {
  return page.evaluate(async (p) => {
    const parts = p.split("/");
    const name = parts.pop()!;
    let dir = await navigator.storage.getDirectory();
    for (const x of parts) dir = await dir.getDirectoryHandle(x);
    return (await (await dir.getFileHandle(name)).getFile()).text();
  }, path);
}

async function embed(page: Page, base: string) {
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await editor.fill(["# Board", "", `![[${base}]]`, ""].join("\n"));
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
  });
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toContainText("Welcome to", { timeout: 15_000 });
});

const CALENDAR = ["filters:", '  and:', '    - file.inFolder("Events")', "views:", "  - type: calendar", "    name: Due", "    date: due", ""].join("\n");
/** A note whose front matter has a comment, quotes, a Hebrew key and CRLF line ends: only `due` may change. */
const LAUNCH = ["---", "# owner: tal", 'title: "Launch"', "due: 2026-03-10", "שלב: בדיקה", "tags: [plan, q1]", "---", "", "The launch. due: 2026-03-10 appears in the body too.", ""].join("\r\n");
const REVIEW = ["---", "due: 2026-03-12", "---", "", "# Review", ""].join("\n");

test("calendar: drag a note to another day and back — only its date changes, then the file is as it was", async ({ page, browserName }) => {
  test.setTimeout(60_000);
  vaultOrSkip(await writeFiles(page, { "Due.base": CALENDAR, "Events/Launch.md": LAUNCH, "Events/Review.md": REVIEW }), browserName);
  await embed(page, "Due.base");
  const cal = page.getByTestId("base-calendar").first();
  await expect(cal).toBeVisible({ timeout: 15_000 });
  const card = cal.locator('[data-path="Events/Launch.md"]');
  await expect(cal.locator('[data-day="2026-03-10"]').locator('[data-path="Events/Launch.md"]')).toBeVisible();

  await card.dragTo(cal.locator('[data-day="2026-03-17"]'));
  await expect(cal.locator('[data-day="2026-03-17"] [data-path="Events/Launch.md"]')).toBeVisible({ timeout: 5_000 });
  await expect.poll(() => readFile(page, "Events/Launch.md"), { timeout: 5_000 }).toBe(LAUNCH.replace("due: 2026-03-10\r\n", "due: 2026-03-17\r\n"));
  // The other note and the body's own "due:" text are untouched.
  expect(await readFile(page, "Events/Review.md")).toBe(REVIEW);

  await cal.locator('[data-day="2026-03-17"] [data-path="Events/Launch.md"]').dragTo(cal.locator('[data-day="2026-03-10"]'));
  await expect(cal.locator('[data-day="2026-03-10"] [data-path="Events/Launch.md"]')).toBeVisible({ timeout: 5_000 });
  await expect.poll(() => readFile(page, "Events/Launch.md"), { timeout: 5_000 }).toBe(LAUNCH);
});

const ROWS = 10_000;
const TABLE = ["filters:", "  and:", '    - file.inFolder("Rows")', "views:", "  - type: table", "    name: All", "    order: [file.name, n, stage]", ""].join("\n");

test("table: 10,000 rows virtualize and scroll at ≥ 55 fps", { tag: "@nightly" }, async ({ page, browserName }) => {
  test.setTimeout(600_000);
  const ok = await page.evaluate(async (n) => {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle("Rows", { create: true });
      const write = async (i: number) => {
        const w = await (await dir.getFileHandle(`r${i}.md`, { create: true }) as unknown as { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable();
        await w.write(`---\nn: ${i}\nstage: ${["todo", "doing", "done"][i % 3]}\n---\n\n# ${i % 4 ? "Row" : "שורה"} ${i}\n`);
        await w.close();
      };
      for (let i = 0; i < n; i += 250) await Promise.all(Array.from({ length: Math.min(250, n - i) }, (_, k) => write(i + k)));
      return true;
    } catch {
      return false;
    }
  }, ROWS);
  vaultOrSkip(ok && (await writeFiles(page, { "Rows.base": TABLE })), browserName);
  await page.reload();
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 30_000 });
  await embed(page, "Rows.base");

  const scroller = page.getByTestId("base-table-scroll").first();
  await expect(scroller).toHaveAttribute("data-virtual", "true", { timeout: 120_000 });
  await expect(page.getByTestId("base-count").first()).toContainText("10", { timeout: 120_000 });
  // Virtualized: a window of rows in the DOM, not 10,000.
  expect(await scroller.locator("tbody tr").count()).toBeLessThan(300);

  const result = await scroller.evaluate(async (el) => {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    const renderer = gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
    const max = el.scrollHeight - el.clientHeight;
    let frames = 0;
    const start = performance.now();
    while (performance.now() - start < 3000) {
      el.scrollTop = ((frames * 240) % max) | 0;
      await new Promise((r) => requestAnimationFrame(r));
      frames++;
    }
    return { fps: frames / ((performance.now() - start) / 1000), renderer, rendered: el.querySelectorAll("tbody tr").length };
  });
  test.info().annotations.push({ type: "perf", description: `10,000-row table scroll: ${Math.round(result.fps)} fps (${result.renderer}), ${result.rendered} rows in the DOM` });
  expect(result.rendered).toBeLessThan(300);
  if (!/swiftshader|llvmpipe|software/i.test(result.renderer)) expect(result.fps).toBeGreaterThanOrEqual(55);
});
