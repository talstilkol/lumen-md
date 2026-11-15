/**
 * The iframe plugin host (src/plugins/sandbox.ts) on shutdown, run in a real
 * sandboxed iframe (Chromium runner). A plugin whose cleanup throws used to
 * be swallowed by an empty catch in the boot page, and the host had already
 * stopped listening; now the host logs why the cleanup failed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { spawnPluginSandbox } from "../plugins/sandbox";
import { log } from "../lib/logger";

const moduleUrl = (code: string) => "data:text/javascript," + encodeURIComponent(code);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => vi.restoreAllMocks());

describe.runIf(typeof window !== "undefined" && typeof window.postMessage === "function" && !/happy-?dom/i.test(navigator.userAgent))("plugin iframe shutdown", () => {
  it("logs a cleanup that throws, then removes the frame", async () => {
    const errors = vi.spyOn(log, "error");
    const h = await spawnPluginSandbox({
      id: "t.throws",
      url: moduleUrl(`export default function activate() { return () => { throw new Error("boom"); }; }`),
      allowedMethods: [],
      onCall: async () => null,
    });
    await wait(200); // the module's activate() has run and stored its cleanup
    h.destroy();
    await wait(300);
    expect(errors.mock.calls.map((c) => c.join(" "))).toContain("[plugin:t.throws] plugin cleanup failed: Error: boom");
    expect(h.iframe.isConnected).toBe(false);
  });

  it("a clean shutdown logs nothing", async () => {
    const errors = vi.spyOn(log, "error");
    const h = await spawnPluginSandbox({ id: "t.ok", url: moduleUrl(`export default function activate() { return () => {}; }`), allowedMethods: [], onCall: async () => null });
    await wait(200);
    h.destroy();
    await wait(300);
    expect(errors).not.toHaveBeenCalled();
    expect(h.iframe.isConnected).toBe(false);
  });
});
