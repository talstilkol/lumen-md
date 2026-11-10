/// <reference lib="webworker" />
/**
 * The vault index worker (plan 8.4): holds the search / backlinks index
 * (./vaultIndexCore.ts) off the main thread. The main thread reads the
 * notes through the VaultBackend and sends their text here; queries come
 * back as plain results. See ./vaultIndexProtocol.ts.
 */
import { VaultIndex } from "./vaultIndexCore";
import { handleIndexRequest } from "./vaultIndexLocal";
import type { IndexRequest } from "./vaultIndexProtocol";

const index = new VaultIndex();

// W2.22 — after a batch of changes, build the chunks' search texts while
// the worker is idle, so the first query after opening a large vault scans
// instead of folding 100,000 notes.
let prepareTimer: ReturnType<typeof setTimeout> | null = null;

// Requests run one after another: a snapshot restore finishes before the
// upserts sent after it (W2.22: some requests are asynchronous now).
let queue: Promise<void> = Promise.resolve();

self.onmessage = (e: MessageEvent<IndexRequest>) => {
  const req = e.data;
  queue = queue.then(async () => (self as unknown as Worker).postMessage(await handleIndexRequest(index, req))).catch(() => {});
  if (req.op === "upsert" || req.op === "remove" || req.op === "move" || req.op === "snapshotRestore") {
    if (prepareTimer) clearTimeout(prepareTimer);
    prepareTimer = setTimeout(() => {
      prepareTimer = null;
      queue = queue.then(() => index.prepare());
    }, 200);
  }
};
