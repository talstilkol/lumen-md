import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { opfsWritable, vaultOrSkip } from "./_opfs";
import { fakeWebdav } from "../src/__tests__/helpers/fakeServers/webdav";

/**
 * Plan W11.S9 — the recovery kit, end to end:
 *   • device A turns on a recovery key: 24 words on screen, the printable PDF
 *     downloads without a request and without a file in the vault, and three
 *     words typed back turn it on;
 *   • then 10 times in a row a clean profile (a new browser context, nothing
 *     in storage) opens the vault with only the words and a new passphrase,
 *     and gets the note.
 * The WebDAV server is the in-memory mock of sync-explained.spec.ts.
 */
const DAV = "http://127.0.0.1:8787/dav/tal/Lumen/";
const PASS = "a long passphrase for the e2e vault";
const ROUNDS = 10;

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

function rootNames(page: Page) {
  return page.evaluate(async () => {
    const out: string[] = [];
    const root = await navigator.storage.getDirectory();
    for await (const [name] of (root as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) out.push(name);
    return out;
  });
}

function readNote(page: Page, path: string) {
  return page.evaluate(async (p) => {
    try {
      const root = await navigator.storage.getDirectory();
      return await (await (await root.getFileHandle(p)).getFile()).text();
    } catch {
      return null;
    }
  }, path);
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

test("the 24 recovery words open the vault in a clean profile, 10 times out of 10", async ({ browser, browserName }) => {
  test.setTimeout(10 * 60_000);
  const server = fakeWebdav({ baseUrl: DAV, username: "tal", password: "app-password" });
  const ctxA = await browser.newContext({ acceptDownloads: true });
  await wire(ctxA, server);
  const a = await open(ctxA);
  vaultOrSkip(await opfsWritable(a), browserName);

  await writeNote(a, "kept.md", "# נשמר\n\nthe note the words bring back");
  const pa = await connect(a);
  await pa.getByLabel("Passphrase", { exact: true }).fill(PASS);
  await pa.getByLabel("Repeat the passphrase").fill(PASS);
  await pa.getByRole("button", { name: "Encrypt and sync" }).click();
  await expect(pa.getByTestId("sync-result")).toContainText(/1 up, 0 down/, { timeout: 30_000 });

  // Set up the recovery key: the words appear once.
  const kit = pa.getByTestId("recovery-kit");
  await kit.getByRole("button", { name: "Set up a recovery key" }).click();
  const items = kit.getByTestId("recovery-words").locator("li");
  await expect(items).toHaveCount(24);
  const words = (await items.allTextContents()).map((w) => w.trim());
  expect(new Set(words).size).toBeGreaterThan(1);

  // The PDF: a download made on this device; no request off this origin, nothing added to the vault.
  const filesBefore = server.files.size;
  const namesBefore = (await rootNames(a)).sort();
  const requests: string[] = [];
  const origin = new URL(a.url()).origin;
  // Its own lazy chunk may load from this origin; anything else is a leak.
  const onRequest = (r: { url(): string }) => {
    if (!/^(blob|data):/.test(r.url()) && new URL(r.url()).origin !== origin) requests.push(r.url());
  };
  a.on("request", onRequest);
  const [download] = await Promise.all([a.waitForEvent("download"), kit.getByRole("button", { name: "Download the printable kit (PDF)" }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  a.off("request", onRequest);
  expect(requests).toEqual([]);
  expect((await rootNames(a)).sort()).toEqual(namesBefore);
  expect(server.files.size).toBe(filesBefore);

  // Three words typed back turn it on.
  await kit.getByRole("button", { name: "I wrote them down" }).click();
  const labels = kit.locator("form label");
  await expect(labels).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    const label = labels.nth(i);
    const n = Number(/(\d+)/.exec((await label.textContent()) ?? "")?.[1]);
    expect(n).toBeGreaterThanOrEqual(1);
    await label.locator("input").fill(words[n - 1]);
  }
  await kit.getByRole("button", { name: "Turn on the recovery key" }).click();
  await expect(kit.getByTestId("recovery-done")).toBeVisible({ timeout: 30_000 });
  await ctxA.close();

  // A forgotten passphrase, ten clean profiles: the words alone open the vault.
  for (let round = 1; round <= ROUNDS; round++) {
    const ctx = await browser.newContext();
    await wire(ctx, server);
    const page = await open(ctx);
    const panel = await connect(page);
    await expect(panel.getByText("A vault is already there. Enter its passphrase.")).toBeVisible({ timeout: 15_000 });
    await panel.getByRole("button", { name: "Forgot the passphrase?" }).click();
    const form = panel.getByTestId("recovery-restore");
    await form.getByLabel("The 24 recovery words").fill(words.join(" "));
    await form.getByLabel("New passphrase").fill(`${PASS} ${round}`);
    await form.getByLabel("Repeat the passphrase").fill(`${PASS} ${round}`);
    await form.getByRole("button", { name: "Restore" }).click();
    await expect(form.getByRole("alert")).toHaveCount(0);
    await expect.poll(() => readNote(page, "kept.md"), { timeout: 60_000, message: `round ${round}` }).toBe("# נשמר\n\nthe note the words bring back");
    await ctx.close();
  }
});
