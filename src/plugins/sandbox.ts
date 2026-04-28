/**
 * Sandboxed plugin host — runs untrusted plugin code inside a separate
 * cross-origin iframe and brokers a small set of API calls over
 * `postMessage`.
 *
 * Why an iframe (not just a Worker):
 *   • A sandboxed iframe with `sandbox="allow-scripts"` (no
 *     `allow-same-origin`) gives the plugin code its own origin, so it
 *     can't read our cookies, OPFS, or DOM. Workers share the parent
 *     origin and have access to IndexedDB, fetch with credentials, etc.
 *   • The plugin can still render UI by sending us serializable
 *     descriptors — we materialise them as React nodes in the host. That
 *     means plugins describe widgets, they don't draw them, so a buggy
 *     plugin can't paint over the editor.
 *   • Outbound HTTP requests from the plugin go through us — we can
 *     enforce a per-plugin allowlist before forwarding.
 *
 * Wire format (every message includes `type` + `id`):
 *
 *   host → plugin:  { type: "init", api: ["registerBlock", "registerCommand", ...] }
 *                   { type: "response", id, ok, value? | error? }
 *                   { type: "shutdown" }
 *
 *   plugin → host:  { type: "ready" }
 *                   { type: "call", id, method: string, args: unknown[] }
 *                   { type: "block", id, source, meta }   (request to render a block)
 *
 * Plugin authors don't deal with this directly — `create-lumen-plugin`
 * ships a small bridge that fakes a normal `LumenPluginAPI` on top.
 */

import { log } from "../lib/logger";

export interface PluginHandle {
  id: string;
  iframe: HTMLIFrameElement;
  destroy(): void;
}

export interface SandboxOptions {
  /** Plugin id — used in error messages and as the key for permissions. */
  id: string;
  /** ESM module URL (https or data:). The iframe imports it dynamically. */
  url: string;
  /** Methods the plugin can call on the host. Anything else is rejected. */
  allowedMethods: readonly string[];
  /** Resolve calls coming from the plugin. */
  onCall: (method: string, args: unknown[]) => Promise<unknown>;
}

const SANDBOX_FLAGS = "allow-scripts"; // intentionally NO allow-same-origin

/** Build the inline HTML the iframe loads. Imports the plugin URL via ESM. */
function bootHtml(pluginUrl: string): string {
  // We embed the URL via JSON.stringify so quotes are escaped correctly.
  const escapedUrl = JSON.stringify(pluginUrl);
  return `<!doctype html><html><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https: data:; connect-src https:;" />
</head><body><script type="module">
let nextId = 1;
const pending = new Map();
function call(method, ...args) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    parent.postMessage({ type: "call", id, method, args }, "*");
  });
}
window.addEventListener("message", (e) => {
  const msg = e.data;
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "response") {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.ok ? p.resolve(msg.value) : p.reject(new Error(msg.error || "plugin call failed"));
    return;
  }
  if (msg.type === "shutdown") {
    if (window.__lumenCleanup) try { window.__lumenCleanup(); } catch {}
    parent.postMessage({ type: "shutdown-ack" }, "*");
  }
});
const api = new Proxy({}, { get: (_, method) => (...args) => call(String(method), ...args) });
parent.postMessage({ type: "ready" }, "*");
import(${escapedUrl}).then((mod) => {
  const activate = mod.default ?? mod.activate;
  if (typeof activate !== "function") {
    parent.postMessage({ type: "error", message: "plugin module must export default activate(api)" }, "*");
    return;
  }
  try {
    const cleanup = activate(api);
    if (typeof cleanup === "function") window.__lumenCleanup = cleanup;
  } catch (err) {
    parent.postMessage({ type: "error", message: String(err) }, "*");
  }
}).catch((err) => {
  parent.postMessage({ type: "error", message: "plugin import failed: " + err.message }, "*");
});
</script></body></html>`;
}

/**
 * Spawn a sandboxed iframe and wire its message bus to the supplied
 * `onCall`. Resolves with a handle the caller can `destroy()` to unload.
 */
export function spawnPluginSandbox(opts: SandboxOptions): Promise<PluginHandle> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", SANDBOX_FLAGS);
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText = "position:fixed;left:-9999px;width:0;height:0;border:0";
    iframe.srcdoc = bootHtml(opts.url);
    let ready = false;

    const onMessage = async (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow) return; // foreign frames
      const msg = e.data as { type: string; id?: number; method?: string; args?: unknown[]; message?: string };
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "ready") {
        ready = true;
        resolve({
          id: opts.id,
          iframe,
          destroy() {
            iframe.contentWindow?.postMessage({ type: "shutdown" }, "*");
            window.removeEventListener("message", onMessage);
            // Give the plugin one tick to clean up before yanking the frame.
            setTimeout(() => iframe.remove(), 50);
          },
        });
        return;
      }
      if (msg.type === "error") {
        log.error(`[plugin:${opts.id}]`, msg.message);
        if (!ready) reject(new Error(msg.message ?? "plugin failed to load"));
        return;
      }
      if (msg.type === "call" && typeof msg.id === "number" && typeof msg.method === "string") {
        if (!opts.allowedMethods.includes(msg.method)) {
          iframe.contentWindow?.postMessage(
            { type: "response", id: msg.id, ok: false, error: `method not allowed: ${msg.method}` },
            "*",
          );
          return;
        }
        try {
          const value = await opts.onCall(msg.method, msg.args ?? []);
          iframe.contentWindow?.postMessage({ type: "response", id: msg.id, ok: true, value }, "*");
        } catch (err) {
          iframe.contentWindow?.postMessage(
            { type: "response", id: msg.id, ok: false, error: (err as Error).message },
            "*",
          );
        }
      }
    };

    window.addEventListener("message", onMessage);
    document.body.appendChild(iframe);

    // Hard timeout — if the plugin never posts "ready" in 5s, give up.
    setTimeout(() => {
      if (!ready) {
        window.removeEventListener("message", onMessage);
        iframe.remove();
        reject(new Error("plugin sandbox timed out waiting for ready"));
      }
    }, 5000);
  });
}
