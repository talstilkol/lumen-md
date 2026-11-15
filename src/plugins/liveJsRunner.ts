/**
 * live-js runner — the page inside the live-js block's hidden iframe
 * (`sandbox="allow-scripts"`, no same-origin: an opaque origin with no
 * access to the app's IndexedDB, localStorage, cookies, tokens or DOM; in
 * production its own CSP also sets `connect-src 'none'`).
 *
 * It starts one blob: worker running the live-js runtime and relays
 * messages both ways. The user's code runs in that worker — never in this
 * page — so it can only talk to this relay, and the app validates every
 * relayed message (shape and run id) before showing it.
 *
 * Not a Vite entry: scripts/build-runners.mjs bundles it into
 * public/runners/livejs-runner.js, a classic script whose sha256 is the only
 * script source the page's CSP allows (plan W10.D1). Rebuild after a change.
 */
import { WORKER_SOURCE } from "./liveJsWorkerSource";
import { RUNNER_CHANNEL, type RunnerToApp } from "./liveJsChannel";

const post = (msg: RunnerToApp) => parent.postMessage(msg, "*");

let worker: Worker | null = null;
try {
  const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "application/javascript;charset=utf-8" }));
  worker = new Worker(url, { type: "classic" });
  worker.addEventListener("message", (e: MessageEvent) => post({ channel: RUNNER_CHANNEL, kind: "message", data: e.data }));
  worker.addEventListener("error", (e: ErrorEvent) => {
    e.preventDefault();
    post({ channel: RUNNER_CHANNEL, kind: "error", message: String(e.message || "Worker error") });
  });
} catch {
  worker = null;
}

window.addEventListener("message", (e: MessageEvent) => {
  if (e.source !== parent) return;
  const msg = e.data as { channel?: string; data?: unknown } | null;
  if (!msg || msg.channel !== RUNNER_CHANNEL) return;
  worker?.postMessage(msg.data);
});

post(worker ? { channel: RUNNER_CHANNEL, kind: "ready" } : { channel: RUNNER_CHANNEL, kind: "unavailable" });
