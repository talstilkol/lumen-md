/**
 * Main-thread client for the TypeScript worker. The worker (and with it the
 * compiler download) is created on first use.
 */
import type { BlockInput, TsCompletion, TsDiagnostic } from "./tsService";

export interface TsClient {
  check(blocks: BlockInput[]): Promise<TsDiagnostic[]>;
  complete(blocks: BlockInput[], block: string, pos: number): Promise<TsCompletion[]>;
  dispose(): void;
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./tsCheck.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data.result);
    else p.reject(new Error(e.data.error ?? "TypeScript worker error"));
  };
  worker.onerror = (e) => {
    // A worker that failed to load or crashed never answers again: drop it
    // so the next request starts a fresh one (e.g. once back online).
    const failed = worker;
    worker = null;
    failed?.terminate();
    for (const p of pending.values()) p.reject(new Error(e.message || "TypeScript worker failed"));
    pending.clear();
  };
  return worker;
}

function call<T>(msg: Record<string, unknown>): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    ensureWorker().postMessage({ id, ...msg });
  });
}

export const tsClient: TsClient = {
  check: (blocks) => call<TsDiagnostic[]>({ type: "check", blocks }),
  complete: (blocks, block, pos) => call<TsCompletion[]>({ type: "complete", blocks, block, pos }),
  dispose() {
    worker?.terminate();
    worker = null;
    for (const p of pending.values()) p.reject(new Error("TypeScript worker stopped"));
    pending.clear();
  },
};
