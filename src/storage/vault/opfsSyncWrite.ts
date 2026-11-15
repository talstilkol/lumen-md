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
 *
 * The #856 follow-up: reads go to the same worker. `readOpfsBatched` gathers
 * the reads asked for in the same turn (up to READ_BATCH) into one message,
 * and the worker answers with all their bytes in one transferred buffer.
 */
import { errorFromAnswer, splitRead, SyncWriteUnsupported, type ReadAnswer, type ReadRequest, type WriteAnswer, type WriteRequest } from "./vaultIoFs";

export { SyncWriteUnsupported };

let worker: Worker | null = null;
/** Has this worker ever answered? A worker that fails before its first answer could not start (blocked, unsupported). */
let answered = false;
let nextId = 0;
const pending = new Map<number, { resolve: (a: WriteAnswer | ReadAnswer) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL("./vault-io.worker.ts", import.meta.url), { type: "module", name: "lumen-vault-io" });
  w.onmessage = (e: MessageEvent<WriteAnswer | ReadAnswer>) => {
    answered = true;
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data);
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
  const done = new Promise<void>((resolve, reject) => pending.set(id, { resolve: () => resolve(), reject }));
  const msg: WriteRequest = { id, op: "write", parts, bytes, inPlaceIfNoMove: opts.inPlaceIfNoMove };
  getWorker().postMessage(msg, [bytes]);
  return done;
}

/** Read the OPFS files at `paths` in the worker, in one message. null: not read there (the caller reads it itself). */
export async function syncReadOpfs(paths: string[][]): Promise<Array<Uint8Array | null>> {
  if (typeof Worker === "undefined") throw new SyncWriteUnsupported("Worker");
  const id = ++nextId;
  const done = new Promise<WriteAnswer | ReadAnswer>((resolve, reject) => pending.set(id, { resolve, reject }));
  const msg: ReadRequest = { id, op: "read", paths };
  getWorker().postMessage(msg);
  const a = await done;
  if (!a.ok || !("op" in a) || a.op !== "read") throw new Error("the OPFS worker gave no read answer");
  return splitRead(a.data, a.lengths);
}

/** At most this many files in one read message. */
export const READ_BATCH = 256;
let queued: Array<{ parts: string[]; resolve: (b: Uint8Array | null) => void; reject: (e: Error) => void }> = [];
let flushScheduled = false;

function flushReads(): void {
  flushScheduled = false;
  const all = queued;
  queued = [];
  for (let i = 0; i < all.length; i += READ_BATCH) {
    const batch = all.slice(i, i + READ_BATCH);
    syncReadOpfs(batch.map((q) => q.parts)).then(
      (out) => batch.forEach((q, k) => q.resolve(out[k])),
      (e: Error) => batch.forEach((q) => q.reject(e)),
    );
  }
}

/**
 * One file's bytes through the worker, batched with the other reads asked
 * for before the next task (a folder opened, the search index built). Rejects
 * with SyncWriteUnsupported when the worker cannot run here.
 */
export function readOpfsBatched(parts: string[]): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    queued.push({ parts, resolve, reject });
    if (queued.length >= READ_BATCH) flushReads();
    else if (!flushScheduled) {
      flushScheduled = true;
      setTimeout(flushReads, 0);
    }
  });
}
