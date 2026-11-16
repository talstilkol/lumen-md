import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { opfsWritable, vaultOrSkip } from "./_opfs";
import { fakeWebdav } from "../src/__tests__/helpers/fakeServers/webdav";

/**
 * Plan W11.S10 — unlock with a passkey through WebAuthn PRF, with a
 * simulated authenticator, in every engine:
 *   • where the browser reports "extension:prf", device A adds a passkey;
 *   • a clean profile with the same passkey (as a password manager syncs it)
 *     unlocks the vault with it, no passphrase, and gets the note;
 *   • removing the passkey there revokes it: the next clean profile can't
 *     unlock with it;
 *   • where the browser reports no PRF, the option isn't shown at all.
 * The authenticator is a page script (below): PublicKeyCredential's
 * getClientCapabilities and navigator.credentials, with the PRF output
 * HMAC-SHA-256(secret, SHA-256("WebAuthn PRF" ‖ 0x00 ‖ salt)) as WebAuthn L3
 * §10.1.4 defines it. A real passkey in Chrome and Safari is W11.M11.
 */
const DAV = "http://127.0.0.1:8787/dav/tal/Lumen/";
const PASS = "a long passphrase for the e2e vault";
const SECRET = "the passkey's own secret, never seen by the app";

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

/** A simulated platform authenticator with PRF, one credential, in this context's pages. */
async function authenticator(context: BrowserContext, opts: { prf: boolean; secret: string }) {
  await context.addInitScript(({ prf, secret }) => {
    const enc = new TextEncoder();
    const rawId = enc.encode("lumen-e2e-passkey-1").buffer;
    const key = crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const bytes = (b: BufferSource) => new Uint8Array(b instanceof ArrayBuffer ? b : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    async function evalPrf(salt: BufferSource): Promise<ArrayBuffer> {
      const label = enc.encode("WebAuthn PRF");
      const s = bytes(salt);
      const input = new Uint8Array(label.length + 1 + s.length);
      input.set(label, 0);
      input.set(s, label.length + 1);
      const hashed = await crypto.subtle.digest("SHA-256", input);
      return crypto.subtle.sign("HMAC", await key, hashed);
    }
    const cred = (first: ArrayBuffer | undefined, made: boolean) => ({
      id: "bHVtZW4tZTJlLXBhc3NrZXktMQ",
      rawId,
      type: "public-key",
      response: {},
      authenticatorAttachment: "platform",
      getClientExtensionResults: () => ({ prf: made ? { enabled: true, ...(first ? { results: { first } } : {}) } : { results: { first } } }),
    });
    const pkc = (window as unknown as { PublicKeyCredential?: object }).PublicKeyCredential;
    if (pkc) Object.defineProperty(pkc, "getClientCapabilities", { configurable: true, value: async () => ({ "extension:prf": prf, userVerifyingPlatformAuthenticator: true }) });
    (window as unknown as { __passkeyCalls: string[] }).__passkeyCalls = [];
    const calls = (window as unknown as { __passkeyCalls: string[] }).__passkeyCalls;
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: {
        async create(o: CredentialCreationOptions) {
          calls.push("create");
          const salt = (o.publicKey?.extensions as { prf?: { eval?: { first?: BufferSource } } } | undefined)?.prf?.eval?.first;
          return cred(salt ? await evalPrf(salt) : undefined, true);
        },
        async get(o: CredentialRequestOptions) {
          calls.push("get");
          const salt = (o.publicKey?.extensions as { prf?: { eval?: { first?: BufferSource } } } | undefined)?.prf?.eval?.first;
          return cred(salt ? await evalPrf(salt) : undefined, false);
        },
      },
    });
  }, opts);
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

test("a PRF passkey unlocks a clean profile, and a removed one no longer does", async ({ browser, browserName }) => {
  test.setTimeout(4 * 60_000);
  const server = fakeWebdav({ baseUrl: DAV, username: "tal", password: "app-password" });

  const ctxA = await browser.newContext();
  await wire(ctxA, server);
  await authenticator(ctxA, { prf: true, secret: SECRET });
  const a = await open(ctxA);
  vaultOrSkip(await opfsWritable(a), browserName);
  await writeNote(a, "kept.md", "# מפתח גישה\n\nopened by a passkey");
  const pa = await connect(a);
  await pa.getByLabel("Passphrase", { exact: true }).fill(PASS);
  await pa.getByLabel("Repeat the passphrase").fill(PASS);
  await pa.getByRole("button", { name: "Encrypt and sync" }).click();
  await expect(pa.getByTestId("sync-result")).toContainText(/1 up, 0 down/, { timeout: 30_000 });
  const setupA = pa.getByTestId("passkey-setup");
  await setupA.getByRole("button", { name: "Add a passkey" }).click();
  await expect(setupA.getByText("Passkey 1")).toBeVisible({ timeout: 30_000 });
  await expect(setupA.getByRole("alert")).toHaveCount(0);
  expect(await a.evaluate(() => (window as unknown as { __passkeyCalls: string[] }).__passkeyCalls)).toContain("create");
  await ctxA.close();

  // A browser without PRF: no passkey button on the unlock screen.
  const ctxN = await browser.newContext();
  await wire(ctxN, server);
  await authenticator(ctxN, { prf: false, secret: SECRET });
  const n = await open(ctxN);
  const pn = await connect(n);
  await expect(pn.getByText("A vault is already there. Enter its passphrase.")).toBeVisible({ timeout: 15_000 });
  await expect(pn.getByRole("button", { name: "Unlock with a passkey" })).toHaveCount(0);
  await ctxN.close();

  // A clean profile, the same passkey: unlocked without the passphrase.
  const ctxB = await browser.newContext();
  await wire(ctxB, server);
  await authenticator(ctxB, { prf: true, secret: SECRET });
  const b = await open(ctxB);
  const pb = await connect(b);
  await pb.getByRole("button", { name: "Unlock with a passkey" }).click();
  await expect.poll(() => readNote(b, "kept.md"), { timeout: 60_000 }).toBe("# מפתח גישה\n\nopened by a passkey");

  // Revoke it there.
  const setupB = pb.getByTestId("passkey-setup");
  await expect(setupB.getByText("Passkey 1")).toBeVisible({ timeout: 15_000 });
  await setupB.getByRole("button", { name: "Remove" }).click();
  await expect(setupB.getByText("Passkey 1")).toHaveCount(0, { timeout: 30_000 });
  await ctxB.close();

  // The next clean profile: the removed passkey opens nothing.
  const ctxC = await browser.newContext();
  await wire(ctxC, server);
  await authenticator(ctxC, { prf: true, secret: SECRET });
  const c = await open(ctxC);
  const pc = await connect(c);
  await pc.getByRole("button", { name: "Unlock with a passkey" }).click();
  await expect(pc.getByRole("alert").first()).toBeVisible({ timeout: 30_000 });
  expect(await readNote(c, "kept.md")).toBeNull();
  await ctxC.close();
});
