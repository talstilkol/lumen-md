/** Messages to and from the entity extraction worker (W12.E2). */
import type { Entity } from "../model";
import type { EntityProposal } from "../store";

export interface ExtractRequest {
  id: number;
  notes: Array<{ path: string; content: string }>;
  /** Per note, the paragraph hashes already processed. */
  seen?: Record<string, string[]>;
  known?: Entity[];
  /** Use a cached local NER model when there is one. */
  useModel: boolean;
}

export interface ExtractReply {
  id: number;
  mode: "rules-only" | "rules+ner";
  proposals: EntityProposal[];
  seen: Record<string, string[]>;
  paragraphs: { scanned: number; skipped: number };
}

/** Run one request in a worker; resolves with its reply. */
export function extractInWorker(worker: Pick<Worker, "postMessage" | "addEventListener" | "removeEventListener">, req: ExtractRequest): Promise<ExtractReply> {
  return new Promise((resolve) => {
    const on = (e: Event) => {
      const r = (e as MessageEvent<ExtractReply>).data;
      if (r?.id !== req.id) return;
      worker.removeEventListener("message", on);
      resolve(r);
    };
    worker.addEventListener("message", on);
    worker.postMessage(req);
  });
}

export const newExtractWorker = (): Worker => new Worker(new URL("./extract.worker.ts", import.meta.url), { type: "module" });
