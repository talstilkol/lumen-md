/**
 * The index core answering protocol requests (./vaultIndexProtocol.ts):
 * the index worker's message handler, and the in-thread engine used where
 * there is no Worker (or after it died). A lazy chunk of the page.
 */

import { VaultIndex } from "./vaultIndexCore";
import { engineOver, type IndexEngine, type IndexRequest, type IndexResponse, type RestoredNote } from "./vaultIndexProtocol";
import { loadSnapshot, saveSnapshot } from "./indexSnapshot";
import { summarize } from "./noteSummary";

/** Index the listed notes the snapshot holds unchanged; their summaries for the main thread. */
async function restoreInto(index: VaultIndex, vault: string, listing: { path: string; name: string; modified: number }[]): Promise<RestoredNote[]> {
  const snap = await loadSnapshot(vault);
  if (!snap) return [];
  const out: RestoredNote[] = [];
  for (const e of listing) {
    const s = snap.get(e.path);
    if (!s || !e.modified || s.modified !== e.modified) continue;
    index.upsert({ path: e.path, name: e.name, content: s.content, modified: s.modified });
    out.push({ path: e.path, name: e.name, modified: s.modified, ...summarize(s.content) });
  }
  return out;
}

export { VaultIndex };

/** Apply one request to `index`. Never throws: a failure is an `ok: false` answer. */
export function handleIndexRequest(index: VaultIndex, req: IndexRequest): IndexResponse | Promise<IndexResponse> {
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
      case "move": {
        let n = 0;
        for (const m of req.moves) if (index.move(m.from, m.to, m.name)) n++;
        return { id: req.id, ok: true, result: n };
      }
      case "snapshotSave":
        return saveSnapshot(req.vault, index.notes()).then(
          () => ({ id: req.id, ok: true as const, result: index.size }),
          (err: unknown) => ({ id: req.id, ok: false as const, error: String(err) }),
        );
      case "snapshotRestore":
        return restoreInto(index, req.vault, req.listing).then(
          (result) => ({ id: req.id, ok: true as const, result }),
          (err: unknown) => ({ id: req.id, ok: false as const, error: String(err) }),
        );
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
      const res = await handleIndexRequest(index, { ...body, id: ++id } as IndexRequest);
      if (!res.ok) throw new Error(res.error);
      return res.result;
    },
    () => index.clear(),
  );
}

