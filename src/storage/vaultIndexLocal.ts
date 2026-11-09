/**
 * The index core answering protocol requests (./vaultIndexProtocol.ts):
 * the index worker's message handler, and the in-thread engine used where
 * there is no Worker (or after it died). A lazy chunk of the page.
 */

import { VaultIndex } from "./vaultIndexCore";
import { engineOver, type IndexEngine, type IndexRequest, type IndexResponse } from "./vaultIndexProtocol";

export { VaultIndex };

/** Apply one request to `index`. Never throws: a failure is an `ok: false` answer. */
export function handleIndexRequest(index: VaultIndex, req: IndexRequest): IndexResponse {
  try {
    switch (req.op) {
      case "upsert":
        for (const f of req.files) index.upsert(f);
        return { id: req.id, ok: true, result: req.files.length };
      case "remove": {
        let n = 0;
        for (const p of req.paths) if (index.remove(p)) n++;
        return { id: req.id, ok: true, result: n };
      }
      case "clear":
        index.clear();
        return { id: req.id, ok: true, result: 0 };
      case "search":
        return { id: req.id, ok: true, result: index.search(req.query, req.opts) };
      case "backlinks":
        return { id: req.id, ok: true, result: index.backlinks(req.target) };
      case "stats":
        return { id: req.id, ok: true, result: index.stats() };
    }
  } catch (err) {
    return { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** The index in this thread. */
export function localEngine(index: VaultIndex): IndexEngine {
  let id = 0;
  return engineOver(
    "local",
    async (body) => {
      const res = handleIndexRequest(index, { ...body, id: ++id } as IndexRequest);
      if (!res.ok) throw new Error(res.error);
      return res.result;
    },
    () => index.clear(),
  );
}

