/**
 * W11.Q11: the browser side of scripts/perf/opfs-bench.mjs. Bundled by the
 * script with esbuild and loaded in a page of each engine. Exposes
 * `window.opfsBench` (the benchmark) and `window.opfsSelftest` (the real
 * worker's atomic save, end to end).
 */
import { errorFromAnswer, splitRead, type ReadAnswer, type ReadRequest, type WriteAnswer, type WriteRequest } from "../../src/storage/vault/vaultIoFs";
// The app's batch size for worker reads (src/storage/vault/opfsSyncWrite.ts).
import { READ_BATCH } from "../../src/storage/vault/opfsSyncWrite";
// @ts-expect-error — plain .mjs module without type declarations
import { fileAt as fileAtJs } from "./opfs-bench-files.mjs";

const fileAt = fileAtJs as (pool: string, spans: number[], i: number) => { path: string; text: string };

declare global {
  interface Window {
    opfsBench(opts: { pool: string; spans: number[]; concurrency: number }): Promise<unknown>;
    opfsSelftest(): Promise<unknown>;
  }
}

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, (a: WriteAnswer | ReadAnswer) => void>();
function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker("./vault-io.worker.js", { type: "module" });
  worker.onmessage = (e: MessageEvent<WriteAnswer | ReadAnswer>) => {
    pending.get(e.data.id)?.(e.data);
    pending.delete(e.data.id);
  };
  return worker;
}
function workerWrite(parts: string[], text: string): Promise<void> {
  const bytes = new TextEncoder().encode(text).buffer as ArrayBuffer;
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, (a) => (a.ok ? resolve() : reject(errorFromAnswer(a))));
    const msg: WriteRequest = { id, op: "write", parts, bytes };
    getWorker().postMessage(msg, [bytes]);
  });
}
/** The app's worker read: one message per batch of paths, the bytes back in one transferred buffer. */
function workerRead(paths: string[][]): Promise<Array<Uint8Array | null>> {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, (a) => (a.ok && "op" in a && a.op === "read" ? resolve(splitRead(a.data, a.lengths)) : reject(a.ok ? new Error("no read answer") : errorFromAnswer(a))));
    const msg: ReadRequest = { id, op: "read", paths };
    getWorker().postMessage(msg);
  });
}

async function clearOpfs(): Promise<void> {
  const root = await navigator.storage.getDirectory();
  for await (const [name] of (root as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) await root.removeEntry(name, { recursive: true });
}

/** Run `fn(0 … count-1)` with `n` in flight. */
async function pool(count: number, n: number, fn: (i: number) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < count) await fn(i++);
  }));
}

/** The phase, for the driver: a crash report names the phase it happened in (W11.Q11). */
const phase = (name: string) => console.log(`opfs-bench phase: ${name}`);

/** Chromium's JS heap in MB (null elsewhere): the page's peak is reported per phase. */
const heapMB = (): number | null => {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return m ? Math.round(m.usedJSHeapSize / 1024 / 1024) : null;
};

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    indexedDB.deleteDatabase("opfs-bench");
    const r = indexedDB.open("opfs-bench", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("notes");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const tx = (db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void) =>
  new Promise<unknown>((resolve, reject) => {
    const t = db.transaction("notes", mode);
    const req = fn(t.objectStore("notes"));
    t.oncomplete = () => resolve(req ? (req as IDBRequest).result : undefined);
    t.onerror = () => reject(t.error);
  });

/** Main-thread long tasks while `fn` runs. */
async function withLongTasks<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number; longTasks: number; longestMs: number }> {
  const seen: number[] = [];
  let po: PerformanceObserver | null = null;
  try {
    po = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) seen.push(e.duration);
    });
    po.observe({ type: "longtask", buffered: false });
  } catch {
    po = null; // why: Firefox and WebKit have no longtask entries; the report says null
  }
  const t = performance.now();
  const value = await fn();
  const ms = performance.now() - t;
  await new Promise((r) => setTimeout(r, 50));
  po?.disconnect();
  return { value, ms: Math.round(ms), longTasks: po ? seen.filter((d) => d > 50).length : -1, longestMs: po ? Math.round(Math.max(0, ...seen)) : -1 };
}

window.opfsBench = async ({ pool: text, spans, concurrency }) => {
  // The files are cut from one copy of the pool on demand (W11.Q11: 28 MB of
  // file texts in one page.evaluate message crashed the 10k page in L8), and
  // every read below keeps a running count, never the texts.
  const count = spans.length / 2;
  const file = (i: number) => fileAt(text, spans, i);
  const heap: Record<string, number | null> = {};
  const step = async <T,>(name: string, fn: () => Promise<T>) => {
    phase(name);
    const r = await withLongTasks(fn);
    heap[name] = heapMB();
    return r;
  };
  phase("clear");
  await clearOpfs();
  const root = await navigator.storage.getDirectory();
  const opfsWrite = await step("opfsWrite", () => pool(count, concurrency, (i) => { const f = file(i); return workerWrite(f.path.split("/"), f.text); }));
  const opfsRead = await step("opfsRead", async () => {
    let bytes = 0;
    for (let i = 0; i < count; i++) {
      let dir: FileSystemDirectoryHandle = root;
      const parts = file(i).path.split("/");
      for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
      bytes += (await (await (await dir.getFileHandle(parts[parts.length - 1])).getFile()).text()).length;
    }
    return bytes;
  });
  // The #856 follow-up: the same files through the worker, READ_BATCH per message, as readAllNotes does.
  const dec = new TextDecoder();
  const opfsReadWorker = await step("opfsReadWorker", async () => {
    let bytes = 0;
    let missing = 0;
    for (let i = 0; i < count; i += READ_BATCH) {
      const batch: string[][] = [];
      for (let k = i; k < Math.min(count, i + READ_BATCH); k++) batch.push(file(k).path.split("/"));
      for (const b of await workerRead(batch)) {
        if (b) bytes += dec.decode(b).length;
        else missing++;
      }
    }
    if (missing) throw new Error(`${missing} files not read through the worker`);
    return bytes;
  });
  phase("idbOpen");
  const db = await idb();
  const idbWrite = await step("idbWrite", () => pool(count, concurrency, (i) => { const f = file(i); return tx(db, "readwrite", (s) => s.put(f.text, f.path)).then(() => undefined); }));
  const idbRead = await step("idbRead", async () => {
    let bytes = 0;
    for (let i = 0; i < count; i++) bytes += String(await tx(db, "readonly", (s) => s.get(file(i).path))).length;
    return bytes;
  });
  // getAll in pages of READ_BATCH × 4 keys: the whole store in one array was the run's largest allocation.
  const idbReadAll = await step("idbReadAll", async () => {
    let bytes = 0;
    let after: IDBValidKey | null = null;
    for (;;) {
      const range: IDBKeyRange | undefined = after === null ? undefined : IDBKeyRange.lowerBound(after, true);
      const keys = (await tx(db, "readonly", (s) => s.getAllKeys(range, READ_BATCH * 4))) as IDBValidKey[];
      if (!keys.length) break;
      const last = keys[keys.length - 1];
      const vals = (await tx(db, "readonly", (s) => s.getAll(IDBKeyRange.bound(keys[0], last)))) as string[];
      for (const v of vals) bytes += v.length;
      after = last;
    }
    return bytes;
  });
  db.close();
  phase("clear");
  await clearOpfs();
  phase("done");
  // opfsRead: the main thread, one file at a time (the path before the follow-up); opfsReadWorker: the worker, batched.
  return { opfsWrite, opfsRead, opfsReadWorker, idbWrite, idbRead, idbReadAll, readBatch: READ_BATCH, heapMB: heap };
};

window.opfsSelftest = async () => {
  await clearOpfs();
  const out: Record<string, unknown> = {};
  await workerWrite(["notes", "a.md"], "first");
  await workerWrite(["notes", "a.md"], "שלום, second");
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle("notes");
  out.content = await (await (await dir.getFileHandle("a.md")).getFile()).text();
  const names: string[] = [];
  for await (const [n] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) names.push(n);
  out.names = names.sort();
  // The worker read path: the note, a missing one, and a folder name.
  const read = await workerRead([["notes", "a.md"], ["notes", "missing.md"], ["notes"]]);
  out.workerRead = read.map((b) => (b ? new TextDecoder().decode(b) : null));
  await clearOpfs();
  return out;
};
