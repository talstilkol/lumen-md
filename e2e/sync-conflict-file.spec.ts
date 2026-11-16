import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { opfsWritable, vaultOrSkip } from "./_opfs";
import { fakeWebdav } from "../src/__tests__/helpers/fakeServers/webdav";

/**
 * Plan W11.S6 — "conflict file" mode, per device, like Obsidian 1.9.7 and
 * Syncthing, in two browsers sharing one mock WebDAV server (wired as in
 * sync-explained.spec.ts):
 *   • device B chooses "keep a conflict file" in its sync rules; when both
 *     devices changed a note, B's round asks nothing: the note takes A's
 *     version and B's own version is kept next to it as
 *     `<name>.sync-conflict-<YYYYMMDD-HHMMSS>-<device>.md`;
 *   • B's version is also in the note's history (lumen-history in IndexedDB);
 *   • the choice is B's only: A's browser never gets it and the vault on the
 *     server holds no trace of it.
 * The content of every history version is checked by the unit test
 * src/__tests__/syncConflictFile.test.ts against the real history store.
 */
const DAV = "http://127.0.0.1:8787/dav/tal/Lumen/";
const PASS = "a long passphrase for the e2e vault";
const MODE_KEY = "lumen.sync.conflictMode.v1"; // src/sync/e2ee/conflictMode.ts

const run = (page: Page, id: string) => page.evaluate((cmd) => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: cmd } })), id);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, DELETE, PROPFIND, MKCOL, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, If-Match, If-None-Match, Depth",
  "Access-Control-Expose-Headers": "ETag",
};

async function wire(context: BrowserContext, server: ReturnType<typeof fakeWebdav>) {
  await context.route("http://127.0.0.1:8787/dav/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const res = await server.handle({
      method: req.method(),
      url: new URL(req.url()),
      headers: new Headers(await req.allHeaders()),
      body: new Uint8Array(req.postDataBuffer() ?? Buffer.alloc(0)),
    });
    await route.fulfill({
      status: res.status,
      headers: { ...CORS, ...(res.headers ?? {}) },
      body: res.body === undefined ? "" : typeof res.body === "string" ? res.body : Buffer.from(res.body),
    });
  });
}

function writeNote(page: Page, path: string, text: string) {
  return page.evaluate(
    async ([p, t]) => {
      const root = await navigator.storage.getDirectory();
      const w = await (await root.getFileHandle(p, { create: true })).createWritable();
      await w.write(t);
      await w.close();
    },
    [path, text] as const,
  );
}

/** Every top-level file of the vault, with its text. */
function rootFiles(page: Page) {
  return page.evaluate(async () => {
    const out: Record<string, string> = {};
    const root = await navigator.storage.getDirectory();
    for await (const [name, h] of (root as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (h.kind === "file" && !name.startsWith("__")) out[name] = await (await (h as FileSystemFileHandle).getFile()).text();
    }
    return out;
  });
}

/** How many history rows the note has (src/storage/history.ts: DB lumen-history, store snapshots). */
function historyRows(page: Page, name: string) {
  return page.evaluate(
    (n) =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open("lumen-history");
        req.onerror = () => resolve(0);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("snapshots")) return resolve(0);
          const all = db.transaction("snapshots", "readonly").objectStore("snapshots").getAll();
          all.onsuccess = () => resolve((all.result as Array<{ name: string }>).filter((r) => r.name === n || r.name.endsWith(`|${n}`)).length);
          all.onerror = () => resolve(0);
        };
      }),
    name,
  );
}

async function open(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem("lumen-tour-done", "1"));
  await page.addInitScript(() => localStorage.setItem("lumen-flags", JSON.stringify({ "sync.e2ee": true })));
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toContainText("Welcome to", { timeout: 15_000 });
  return page;
}

async function connect(page: Page) {
  await page.bringToFront();
  await run(page, "sync.open");
  const panel = page.getByRole("dialog", { name: "Sync" });
  await expect(panel.getByText("Where to keep the encrypted vault")).toBeVisible({ timeout: 15_000 });
  await panel.getByLabel("Folder address").fill(DAV);
  await panel.getByLabel("User name").fill("tal");
  await panel.getByLabel("Password or app password").fill("app-password");
  await panel.getByRole("button", { name: "Connect" }).click();
  return panel;
}

test("conflict-file mode keeps both versions and the history, on this device only", async ({ browser, browserName }) => {
  const server = fakeWebdav({ baseUrl: DAV, username: "tal", password: "app-password" });
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  await wire(ctxA, server);
  await wire(ctxB, server);
  const a = await open(ctxA);
  const b = await open(ctxB);
  vaultOrSkip(await opfsWritable(a), browserName);

  await writeNote(a, "shared.md", "# shared\n\nבסיס");
  const pa = await connect(a);
  await pa.getByLabel("Passphrase", { exact: true }).fill(PASS);
  await pa.getByLabel("Repeat the passphrase").fill(PASS);
  await pa.getByRole("button", { name: "Encrypt and sync" }).click();
  await expect(pa.getByTestId("sync-result")).toContainText(/1 up, 0 down/, { timeout: 30_000 });

  const pb = await connect(b);
  await pb.getByLabel("Passphrase", { exact: true }).fill(PASS);
  await pb.getByRole("button", { name: "Unlock" }).click();
  await expect(pb.getByTestId("sync-result")).toContainText(/0 up, 1 down/, { timeout: 30_000 });

  // B, and only B, keeps conflict files.
  await pb.getByText("What syncs on this device").click();
  await pb.getByTestId("sync-conflict-mode").selectOption("file");
  await pb.getByRole("button", { name: "Save" }).click();
  await expect(pb.getByText("Saved. Applies from the next sync.")).toBeVisible();
  expect(await b.evaluate((k) => localStorage.getItem(k), MODE_KEY)).toBe("file");

  await writeNote(a, "shared.md", "# shared\n\nfrom A");
  await writeNote(b, "shared.md", "# shared\n\nfrom B שלום");
  await a.bringToFront();
  await pa.getByRole("button", { name: "Sync now" }).click();
  await expect(pa.getByRole("button", { name: "Sync now" })).toBeEnabled({ timeout: 30_000 });
  const before = await historyRows(b, "shared.md");
  await b.bringToFront();
  await pb.getByRole("button", { name: "Sync now" }).click();
  await expect(pb.getByRole("button", { name: "Sync now" })).toBeEnabled({ timeout: 30_000 });

  // No question was asked: file mode never opens the conflict dialog.
  await expect(b.getByRole("dialog", { name: /Sync conflict/ })).toHaveCount(0);
  const files = await rootFiles(b);
  expect(files["shared.md"]).toBe("# shared\n\nfrom A");
  const copies = Object.keys(files).filter((n) => /^shared\.sync-conflict-\d{8}-\d{6}-[^.]+\.md$/.test(n));
  expect(copies, JSON.stringify(Object.keys(files))).toHaveLength(1);
  expect(files[copies[0]]).toBe("# shared\n\nfrom B שלום");
  // The overwritten version went to the note's history first.
  await expect.poll(() => historyRows(b, "shared.md"), { timeout: 10_000 }).toBeGreaterThan(before);

  // The next round uploads the conflict file like any new file; A gets it and keeps merging.
  await pb.getByRole("button", { name: "Sync now" }).click();
  await expect(pb.getByRole("button", { name: "Sync now" })).toBeEnabled({ timeout: 30_000 });
  await a.bringToFront();
  await pa.getByRole("button", { name: "Sync now" }).click();
  await expect(pa.getByRole("button", { name: "Sync now" })).toBeEnabled({ timeout: 30_000 });
  await expect.poll(async () => Object.keys(await rootFiles(a)).filter((n) => n.includes(".sync-conflict-")).length, { timeout: 15_000 }).toBe(1);
  expect(await a.evaluate((k) => localStorage.getItem(k), MODE_KEY)).toBeNull();
  for (const [path, f] of server.files) {
    expect(path).not.toContain("conflictMode");
    expect(Buffer.from(f.data).toString("utf8")).not.toContain(MODE_KEY);
  }

  await ctxA.close();
  await ctxB.close();
});
