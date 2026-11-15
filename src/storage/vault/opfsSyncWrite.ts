/**
 * The main-thread side of the OPFS write worker (./vault-io.worker.ts,
 * W11.Q10): every OPFS note write is sent there and saved with sync access
 * handles, atomically (./vaultIoFs.ts). Part of the OPFS vault backend
 * (./opfs.ts), loaded on the first write.
 *
 * When the engine has no sync access handles (or no `move()` for the atomic
 * rename) the worker says so once; `syncWriteOpfs` then throws
 * SyncWriteUnsupported and the backend keeps using `createWritable` on the
 * main thread. Engines without `createWritable` (Safari before 26) still
 * write through the worker, in place if they cannot rename.
 */
import { errorFromAnswer, SyncWriteUnsupported, type WriteAnswer, type WriteRequest } from "./vaultIoFs";

export { SyncWriteUnsupported };

let worker: Worker | null = null;
/** Has this worker ever answered? A worker that fails before its first answer could not start (blocked, unsupported). */
let answered = false;
let nextId = 0;
const pending = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL("./vault-io.worker.ts", import.meta.url), { type: "module", name: "lumen-vault-io" });
  w.onmessage = (e: MessageEvent<WriteAnswer>) => {
    answered = true;
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve();
    else p.reject(e.data.unsupported ? new SyncWriteUnsupported(e.data.message) : errorFromAnswer(e.data));
  };
  w.onerror = (e) => {
    e.preventDefault();
    // A worker that never started (its script blocked or not loadable) is "unsupported": the main thread writes instead.
    const err = answered ? new Error(e.message || "OPFS write worker failed") : new SyncWriteUnsupported(`the worker did not start (${e.message || "error"})`);
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    worker = null;
  };
  worker = w;
  return w;
}

/** The bytes of a note, as an ArrayBuffer the worker can take over. */
export async function toBytes(data: string | Blob | ArrayBuffer | Uint8Array): Promise<ArrayBuffer> {
  if (typeof data === "string") return new TextEncoder().encode(data).buffer as ArrayBuffer;
  if (data instanceof Blob) return await data.arrayBuffer();
  if (data instanceof Uint8Array) return data.slice().buffer as ArrayBuffer;
  return data.slice(0);
}

/** Write `data` to the OPFS file at `parts` (relative to the OPFS root), in the worker. */
export async function syncWriteOpfs(parts: string[], data: string | Blob | ArrayBuffer | Uint8Array, opts: { inPlaceIfNoMove?: boolean } = {}): Promise<void> {
  if (typeof Worker === "undefined") throw new SyncWriteUnsupported("Worker");
  const bytes = await toBytes(data);
  const id = ++nextId;
  const done = new Promise<void>((resolve, reject) => pending.set(id, { resolve, reject }));
  const msg: WriteRequest = { id, parts, bytes, inPlaceIfNoMove: opts.inPlaceIfNoMove };
  getWorker().postMessage(msg, [bytes]);
  return done;
}
