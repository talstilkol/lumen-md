/// <reference lib="webworker" />
/**
 * W13.W10 — the Harper worker: lints English text with harper.js loaded
 * from the app's own origin (see ./harperWorkerCore). No other network.
 */
import "../workerLedgerInstall"; // first: what this worker fetches reaches the privacy ledger (plan 2.4, W10.D22)
import { HARPER_PATH, createHarperHost, type HarperModule, type WorkerRequest } from "../../agents/writing/harper/harperWorkerCore";

const base = new URL(import.meta.env?.BASE_URL ?? "/", self.location.origin);
const handle = createHarperHost(() => import(/* @vite-ignore */ new URL(HARPER_PATH, base).href) as Promise<HarperModule>);

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  void handle(e.data).then((reply) => (self as unknown as Worker).postMessage(reply));
};
