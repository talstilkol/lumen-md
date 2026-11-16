/// <reference lib="webworker" />
/**
 * The render worker (plan 8.1): Markdown → HAST off the main thread —
 * unified / remark / rehype, Shiki and KaTeX — with the request protocol of
 * ./renderProtocol.ts. The handler is ./renderWorkerCore.ts; the window side
 * is ./renderClient.ts.
 */
import "../ai/workerLedgerInstall"; // first: what this worker fetches reaches the privacy ledger (plan 2.4, W10.D22)
import { createRenderHandler } from "./renderWorkerCore";
import type { RenderRequest } from "./renderProtocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const handler = createRenderHandler();

scope.onmessage = (e: MessageEvent<RenderRequest>) => {
  void handler.handle(e.data).then((reply) => {
    if (reply) scope.postMessage(reply);
  });
};
