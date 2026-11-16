import { test, expect, type Page } from "@playwright/test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Plans W10.B1 and W10.B2, in all three engines.
 *
 * W10.B2: the gallery's "verified" badge comes only from an Ed25519
 * signature that checks out against a trusted key (src/plugins/registryTrust.ts).
 * A registry entry that says `verified: true` about itself, one signed by a
 * key nobody trusted, and one whose bundle was changed by one byte after
 * signing all show "unverified"; only the intact, signed, trusted one gets
 * the badge.
 *
 * W10.B1: nothing is "installed" without a package and a check. A legacy
 * registry.json entry shows "not available" instead of an install button,
 * and an example plugin whose code was changed after the safety scan is
 * refused with a visible message (src/plugins/runtime/SandboxedPlugins.tsx)
 * and does not run.
 */

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const SPKI = publicKey.export({ type: "spki", format: "der" }).toString("base64");
const FP = createHash("sha256").update(Buffer.from(SPKI, "base64")).digest("hex");
const other = generateKeyPairSync("ed25519");
const OTHER_FP = createHash("sha256").update(other.publicKey.export({ type: "spki", format: "der" })).digest("hex");

const BUNDLE = Buffer.from("// sample bundle for e2e/plugin-trust.spec.ts\nexport const answer = 42;\n");
const SIG = sign(null, BUNDLE, privateKey).toString("base64");
const OTHER_SIG = sign(null, BUNDLE, other.privateKey).toString("base64");
const TAMPERED = Buffer.from(BUNDLE);
TAMPERED[TAMPERED.length - 3] ^= 0x01; // "42" → "43"

const entry = (id: string, name: string, extra: Record<string, unknown>) => ({ id, name, author: "e2e", description: `${name} (e2e)`, version: "1.0.0", ...extra });
const REGISTRY = {
  plugins: [
    entry("e2e-self-declared", "Self declared", { url: "/e2e-bundles/self.js", verified: true }),
    entry("e2e-unknown-key", "Unknown key", { url: "/e2e-bundles/unknown.js", signature: OTHER_SIG, signedBy: OTHER_FP }),
    entry("e2e-tampered", "Tampered bundle", { url: "/e2e-bundles/tampered.js", signature: SIG, signedBy: FP }),
    entry("e2e-good", "Signed and intact", { url: "/e2e-bundles/good.js", signature: SIG, signedBy: FP }),
  ],
};

async function openGallery(page: Page) {
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.locator('[role="dialog"][aria-modal="true"]').filter({ has: page.locator("input") });
  await palette.waitFor({ timeout: 8000 });
  await palette.locator("input").first().fill("Plugin Gallery");
  await expect(palette.locator('[role="option"][aria-selected="true"]')).toContainText(/Plugin Gallery/i, { timeout: 8000 });
  await page.keyboard.press("Enter");
  const gallery = page.locator('[role="dialog"][aria-labelledby="plugin-gallery-title"]');
  await expect(gallery).toBeVisible({ timeout: 15_000 });
  return gallery;
}

/** The user trusts our test key, the way the trusted-keys screen stores it (idb-keyval, src/plugins/signing.ts). */
const trustTestKey = (page: Page) =>
  page.evaluate(
    ({ fp, spki }) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("keyval-store");
        req.onupgradeneeded = () => req.result.createObjectStore("keyval");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const tx = req.result.transaction("keyval", "readwrite");
          tx.objectStore("keyval").put({ [fp]: spki }, "lumen.plugins.trusted-keys");
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
    { fp: FP, spki: SPKI },
  );

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
  });
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 15_000 });
});

test("W10.B2: only a signed, intact bundle from a trusted key gets the verified badge", async ({ page }) => {
  await trustTestKey(page);
  await page.route("**/plugins/registry.json", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(REGISTRY) }));
  const served: string[] = [];
  await page.route("**/e2e-bundles/*.js", async (r) => {
    const name = path.basename(new URL(r.request().url()).pathname);
    served.push(name);
    // The good one last, so the other checks are done when its badge appears.
    if (name === "good.js") await new Promise((res) => setTimeout(res, 750));
    await r.fulfill({ contentType: "text/javascript", body: name === "tampered.js" ? TAMPERED : BUNDLE });
  });

  const gallery = await openGallery(page);
  const card = (name: string) => gallery.getByTestId("plugin-card").filter({ hasText: name });
  await expect(card("Signed and intact").getByTestId("plugin-verified-badge")).toBeVisible({ timeout: 15_000 });
  // An unsigned entry downloads nothing; the three signed ones are each checked once.
  expect(served.sort()).toEqual(["good.js", "tampered.js", "unknown.js"]);
  await expect(gallery.getByTestId("plugin-verified-badge")).toHaveCount(1);
  for (const name of ["Self declared", "Unknown key", "Tampered bundle"]) {
    await expect(card(name).getByTestId("plugin-verified-badge")).toHaveCount(0);
    await expect(card(name).getByTestId("plugin-trust")).not.toHaveText(await card("Signed and intact").getByTestId("plugin-trust").innerText());
  }
  // W10.B1: no legacy entry offers an install, signed or not.
  for (const p of REGISTRY.plugins) await expect(card(p.name).getByTestId("plugin-unavailable")).toBeVisible();
});

test("W10.B1: an example plugin whose code changed after the scan is refused, visibly, and does not run", async ({ page }) => {
  const examples = path.join(process.cwd(), "public", "plugins", "examples");
  const index = JSON.parse(readFileSync(path.join(examples, "index.json"), "utf8")) as { plugins: Array<{ id: string; versions: Array<{ path: string }> }> };
  const target = index.plugins[0];
  const dir = target.versions[target.versions.length - 1].path;
  const manifest = JSON.parse(readFileSync(path.join(examples, dir, "lumen-plugin.json"), "utf8")) as { id: string; name: string; main: string };
  const original = readFileSync(path.join(examples, dir, manifest.main));
  let tamperedServed = 0;
  await page.route(`**/plugins/examples/${dir}/${manifest.main}`, (r) => {
    tamperedServed++;
    return r.fulfill({ contentType: "text/javascript", body: Buffer.concat([original, Buffer.from("\n// one changed line\n")]) });
  });

  const gallery = await openGallery(page);
  const card = gallery.locator(`[data-testid="sandboxed-plugin-card"][data-plugin="${manifest.id}"]`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByRole("button", { name: /Install/ }).click();
  await page.getByTestId("plugin-install-dialog").getByRole("button", { name: "Install and allow" }).click();
  const alert = page.getByTestId("toasts-alert");
  await expect(alert).toContainText(manifest.name, { timeout: 15_000 });
  await expect(alert).toContainText(/not installed|could not install|cannot be installed/i);
  expect(tamperedServed).toBeGreaterThan(0);
  await expect(card.getByTestId("plugin-installed")).toHaveCount(0);
  await expect(page.locator(`[data-plugin-panel="${manifest.id}"]`)).toHaveCount(0);
});
