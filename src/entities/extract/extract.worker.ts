/// <reference lib="webworker" />
/**
 * The entity extraction worker (plan W12.E2): extraction runs here, off
 * the main thread, one note at a time with a yield between notes, over the
 * paragraphs whose hash changed. DictaBERT-NER is used only when it is
 * already cached on this device (W11.H11's `entitiesIfCached`, which never
 * starts a download); otherwise the rules run alone and the reply says
 * `rules-only`, which the UI shows.
 */
import "../../ai/workerLedgerInstall"; // first: what this worker fetches reaches the privacy ledger (plan 2.4, W10.D22)
import { extractEntities, type NerModel } from "./run";
import type { ExtractRequest, ExtractReply } from "./protocol";

async function hebrewNer(): Promise<NerModel | null> {
  try {
    const { entitiesIfCached, NER_MODEL_ID } = await import("../../ai/piiNer");
    const run = await entitiesIfCached();
    if (!run) return null;
    return { id: NER_MODEL_ID, version: "q8", scheme: "nemo", run: async (text) => (await run(text)).map((e) => ({ start: e.start, end: e.end, text: e.text, label: e.label, score: e.score })) };
  } catch {
    // why: no model, no OPFS or no ONNX runtime in this worker — the rules still run
    return null;
  }
}

const yieldNow = () => new Promise<void>((r) => setTimeout(r, 0));

self.onmessage = async (e: MessageEvent<ExtractRequest>) => {
  const req = e.data;
  const ner = req.useModel ? await hebrewNer() : null;
  const seen = new Map(Object.entries(req.seen ?? {}).map(([k, v]) => [k, new Set(v)]));
  const res = await extractEntities({ notes: req.notes, seen, known: req.known, ner, tick: yieldNow });
  const reply: ExtractReply = { id: req.id, mode: res.mode, proposals: res.proposals, seen: Object.fromEntries([...res.seen].map(([k, v]) => [k, [...v]])), paragraphs: res.paragraphs };
  (self as unknown as Worker).postMessage(reply);
};
