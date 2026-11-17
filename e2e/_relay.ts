import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { E2E_COLLAB_PORT } from "../scripts/test-tiers.mjs";

/**
 * The persistent collab server (sync-server/collab-server.mjs) as a local
 * relay for multi-browser specs: Node, no docker, a temporary SQLite folder,
 * on the one port the e2e page's CSP names. WebRTC signaling points at a
 * closed port, so everything the browsers share goes through the relay.
 * The same setup as e2e/collab-persist.spec.ts.
 */

export const RELAY_ACCESS_KEY = "e2e-collab-access-key";
const SECRET = "e2e-collab-token-secret-0123456789abcdef";

export interface Relay {
  proc: ChildProcess;
  url: string;
  dataDir: string;
}

export function startRelay(dataDir: string): Promise<Relay> {
  const proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "sync-server/collab-server.mjs"], {
    env: { ...process.env, PORT: String(E2E_COLLAB_PORT), HOST: "127.0.0.1", COLLAB_DATA_DIR: dataDir, COLLAB_ACCESS_KEY: RELAY_ACCESS_KEY, COLLAB_TOKEN_SECRET: SECRET, COLLAB_DEBOUNCE_MS: "100" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`relay did not start:\n${out}`)), 15_000);
    const onData = (d: Buffer) => {
      out += d.toString();
      const m = out.match(/listening on :(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve({ proc, url: `ws://127.0.0.1:${m[1]}`, dataDir });
      }
    };
    proc.stdout!.on("data", onData);
    proc.stderr!.on("data", onData);
    proc.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`relay exited (${code}):\n${out}`));
    });
  });
}

/** SIGTERM: the relay stores every room before it exits. */
export function stopRelay(r: Relay): Promise<void> {
  if (r.proc.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    r.proc.once("exit", () => resolve());
    r.proc.kill("SIGTERM");
  });
}

/** A fresh browser context on the app, pointed at the relay. */
export async function openOnRelay(browser: Browser, relayUrl: string, path = "/"): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  await ctx.addInitScript(
    ({ ws, key }) => {
      localStorage.setItem("lumen-tour-done", "1");
      localStorage.setItem("lumen.collab.ws", ws);
      localStorage.setItem("lumen.collab.wsToken", key);
      localStorage.setItem("lumen.collab.signaling", "ws://127.0.0.1:9");
    },
    { ws: relayUrl, key: RELAY_ACCESS_KEY },
  );
  const page = await ctx.newPage();
  await page.goto(path);
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 15_000 });
  return { ctx, page };
}
