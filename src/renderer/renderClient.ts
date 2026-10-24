/**
 * The main-thread side of the render worker (plan 8.1). Loaded lazily by
 * pipeline.ts, so neither this file nor the worker's URL is on the
 * startup path.
 *
 * One worker serves every preview; it is started on the first render
 * and let go after a few minutes without work (the chunk stays cached,
 * so the next start is cheap). Where a worker cannot run — no `Worker`,
 * the script failing to load, a reply that never comes — the same
 * Markdown → HAST code runs on the main thread instead, so the preview
 * never depends on the worker being available.
 */
import type { Root as HastRoot } from "hast";
import type { HastOptions } from "./hastPipeline";
import type { RenderRequest, RenderResponse } from "./renderProtocol";

const IDLE_MS = 5 * 60_000;
/** A render that takes longer than this is assumed lost (a crashed worker); the request is redone in-thread. */
const TIMEOUT_MS = 60_000;

interface Pending {
  resolve: (hast: HastRoot) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const pending = new Map<number, Pending>();

function failAll(reason: string): void {
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error(reason));
  }
  pending.clear();
}

function stopWorker(): void {
  worker?.terminate();
  worker = null;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    const w = new Worker(new URL("./render.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<RenderResponse>) => {
      const res = e.data;
      const p = pending.get(res.id);
      if (!p) return; // superseded or timed out
      pending.delete(res.id);
      clearTimeout(p.timer);
      if (res.error !== undefined) p.reject(new Error(res.error));
      else p.resolve(res.hast);
      touch();
    };
    w.onerror = () => {
      // The script could not load or the worker crashed: this page gives
      // up on the worker and renders on the main thread from now on.
      workerBroken = true;
      stopWorker();
      failAll("render worker failed");
    };
    worker = w;
    return w;
  } catch {
    workerBroken = true;
    return null;
  }
}

function touch(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (pending.size === 0) stopWorker();
  }, IDLE_MS);
}

async function renderInThread(text: string, opts: HastOptions): Promise<HastRoot> {
  const { renderToHast } = await import("./hastPipeline");
  return renderToHast(text, opts);
}

/** Markdown → HAST, in the worker when there is one. */
export function renderHast(text: string, opts: HastOptions): Promise<HastRoot> {
  const w = getWorker();
  if (!w) return renderInThread(text, opts);
  const id = ++seq;
  const req: RenderRequest = { id, text, raw: opts.raw };
  return new Promise<HastRoot>((resolve, reject) => {
    const timer = setTimeout(() => {
      // One lost reply is enough to stop trusting this worker: every
      // request in flight, this one included, is redone on the main thread.
      workerBroken = true;
      stopWorker();
      failAll("render worker timed out");
    }, TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    w.postMessage(req);
    touch();
  }).catch((e: Error) => {
    // A worker that broke under this request: render here instead. A
    // genuine error from the pipeline (a reply with `error`) is rethrown.
    if (workerBroken && !worker) return renderInThread(text, opts);
    throw e;
  });
}

/** For tests: forget the worker and start again. */
export function __resetRenderClient(): void {
  stopWorker();
  workerBroken = false;
  failAll("reset");
}
