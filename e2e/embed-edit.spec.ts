import { test, expect, type Page } from "@playwright/test";
import { vaultOrSkip } from "./_opfs";

/**
 * Plan W12.U1 — edit an embedded block in place, in the live preview:
 *   • `![[Source#^blk]]` shows an edit control; saving changes only that
 *     block in Source.md (its `^blk` marker stays), the host note is not
 *     touched, and the embed re-renders from the source;
 *   • Undo puts Source.md back byte for byte;
 *   • a circular embed and an embed nested inside another are not offered
 *     for editing.
 * The pure range logic and the component are unit-tested in
 * src/__tests__/embedEditInPlace.test.tsx.
 */

const SOURCE = "# Source\n\nfirst paragraph stays\n\nהבלוק לעריכה, בעברית ^blk\n\nlast paragraph stays\n";
const HOST = "# Host\n\n![[Source#^blk]]\n\n![[Outer#^out]]\n\n![[Loop A]]\n";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
  });
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toContainText("Welcome to", { timeout: 15_000 });
});

async function seed(page: Page, files: Record<string, string>): Promise<boolean> {
  return page.evaluate(async (files) => {
    try {
      const root = await navigator.storage.getDirectory();
      for (const [name, data] of Object.entries(files)) {
        const fh = (await root.getFileHandle(name, { create: true })) as unknown as {
          createWritable?: () => Promise<{ write(d: string): Promise<void>; close(): Promise<void> }>;
        };
        if (typeof fh.createWritable !== "function") return false;
        const w = await fh.createWritable();
        await w.write(data);
        await w.close();
      }
      return true;
    } catch {
      return false;
    }
  }, files);
}

function read(page: Page, name: string) {
  return page.evaluate(async (n) => {
    const root = await navigator.storage.getDirectory();
    return (await (await root.getFileHandle(n)).getFile()).text();
  }, name);
}

test("editing an embedded block changes only the source, and Undo restores it", async ({ page, browserName }) => {
  const ok = await seed(page, {
    "Source.md": SOURCE,
    "Outer.md": "outer block with ![[Source#^blk]] inside ^out\n",
    "Loop A.md": "A body\n\n![[Loop B]]",
    "Loop B.md": "B body\n\n![[Loop A]]",
  });
  vaultOrSkip(ok, browserName);
  await page.evaluate(() => window.dispatchEvent(new Event("lumen-workspace-changed")));

  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await editor.fill(HOST);

  const preview = page.locator("[data-preview-root]").first();
  const embed = preview.locator('.lumen-embed[data-embed-target="Source#^blk"][data-embed-depth="1"]');
  await expect(embed).toContainText("הבלוק לעריכה", { timeout: 10_000 });

  // Only the top-level block embed is editable: not the one nested in Outer, not the loop.
  await expect(preview.locator('.lumen-embed[data-embed-depth="2"] .lumen-embed-edit-open')).toHaveCount(0);
  await expect(preview.locator('[data-embed-status="cycle"]')).toBeVisible();
  await expect(preview.locator('.lumen-embed[data-embed-target="Loop A"] .lumen-embed-edit-open')).toHaveCount(0);

  await embed.getByRole("button", { name: "Edit this block in Source" }).click();
  const box = embed.getByRole("textbox", { name: "Editing the source: Source" });
  await expect(box).toHaveValue("הבלוק לעריכה, בעברית");
  await box.fill("הבלוק אחרי עריכה");
  await embed.getByRole("button", { name: "Save" }).click();
  await expect(embed.getByRole("status")).toContainText("Saved in Source");

  const after = SOURCE.replace("הבלוק לעריכה, בעברית ^blk", "הבלוק אחרי עריכה ^blk");
  await expect.poll(() => read(page, "Source.md")).toBe(after);
  await expect(embed).toContainText("הבלוק אחרי עריכה", { timeout: 10_000 });
  // The host note is untouched.
  await expect(editor).toContainText("![[Source#^blk]]");
  expect(await editor.textContent()).not.toContain("אחרי עריכה");

  // Undo: the source is back, byte for byte, and so is the embed.
  await embed.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => read(page, "Source.md")).toBe(SOURCE);
  await expect(embed).toContainText("הבלוק לעריכה, בעברית", { timeout: 10_000 });
});
