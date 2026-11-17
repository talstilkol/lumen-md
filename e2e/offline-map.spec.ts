import { test, expect, type Page } from "@playwright/test";
import { vaultOrSkip } from "./_opfs";
import { buildArchive, israelTile } from "../src/__tests__/helpers/pmtilesFixture";

/**
 * Plan W13.G3 — the offline map. A regional PMTiles basemap is in the vault
 * (`.lumen/maps/israel.pmtiles`, built here with the test fixture); a note
 * has a ```map block over Tel Aviv. With airplane mode on:
 *   - not one request leaves for a tile server (every tile host is counted);
 *   - the map shows its background from the file (the offline layer's
 *     canvases have pixels), with Hebrew labels.
 * Runs on the Mac (a real browser and the dev server): W13.G13.
 */

const TILE_HOSTS = /tile\.openstreetmap\.org|protomaps|tiles?\./;

async function seed(page: Page, archive: number[]): Promise<boolean> {
  return page.evaluate(async (bytes) => {
    try {
      const root = await navigator.storage.getDirectory();
      const write = async (dir: FileSystemDirectoryHandle, name: string, data: Uint8Array | string) => {
        const fh = await dir.getFileHandle(name, { create: true });
        const w = await (fh as unknown as { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable();
        await w.write(data as BlobPart);
        await w.close();
      };
      const lumen = await root.getDirectoryHandle(".lumen", { create: true });
      const maps = await lumen.getDirectoryHandle("maps", { create: true });
      await write(maps, "israel.pmtiles", Uint8Array.from(bytes));
      await write(root, "מפה.md", "# מפה\n\n```map\ncenter: [32.08, 34.78]\nzoom: 7\nmarkers:\n  - { lat: 32.08, lng: 34.78, label: תל אביב }\n```\n");
      localStorage.setItem("lumen.map.offline", "1");
      return true;
    } catch {
      return false;
    }
  }, archive);
}

test("offline map: in airplane mode the map draws from the vault's PMTiles file and asks no tile server", async ({ page, browserName }) => {
  const tileRequests: string[] = [];
  await page.context().route(TILE_HOSTS, (route) => {
    tileRequests.push(route.request().url());
    return route.abort();
  });
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.setItem("lumen-md", JSON.stringify({ state: { locale: "he", mode: "preview", showWorkspace: true }, version: 0 }));
  });
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 15_000 });
  const bytes = Array.from(await buildArchive(new Map([["7/76/52", israelTile()]]), { gzipDirs: true, metadata: { attribution: "© OpenStreetMap contributors (ODbL)" } }));
  vaultOrSkip(await seed(page, bytes), browserName);

  // Airplane mode on (it reloads the page with its CSP in place).
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: "privacy.airplane" } })));
  await page.waitForLoadState("load");
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 15_000 });

  const tree = page.locator("aside.file-tree");
  if (!(await tree.isVisible())) await page.evaluate(() => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: "view.workspace" } })));
  await tree.locator(".file-tree-name", { hasText: "מפה.md" }).first().click();

  const basemap = page.locator(".lumen-offline-basemap canvas").first();
  await expect(basemap).toBeVisible({ timeout: 15_000 });
  // The tile has pixels (land, sea, labels), drawn from the file.
  const inked = await basemap.evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  });
  expect(inked).toBeGreaterThan(1000);
  expect(tileRequests).toEqual([]);
});
