/**
 * Render worker (plan 8.1): Markdown → HAST off the main thread. Each
 * message is one request; the reply carries the tree (positions stripped)
 * or the error. Requests are handled in order, one at a time — a newer
 * request for the same preview supersedes an older one on the main side,
 * which drops the stale reply.
 */
import { handleRenderRequest, type RenderRequest } from "./renderProtocol";

let queue: Promise<unknown> = Promise.resolve();

self.onmessage = (e: MessageEvent<RenderRequest>) => {
  const req = e.data;
  queue = queue.then(async () => {
    const res = await handleRenderRequest(req);
    (self as unknown as Worker).postMessage(res);
  });
};
