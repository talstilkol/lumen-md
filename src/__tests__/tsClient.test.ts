/**
 * The TypeScript worker client recovers from a worker that failed to load:
 * pending calls reject and the next call starts a fresh worker.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

class FakeWorker {
  static created: FakeWorker[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminate = vi.fn();
  posted: unknown[] = [];
  constructor() {
    FakeWorker.created.push(this);
  }
  postMessage(m: unknown) {
    this.posted.push(m);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.created = [];
});

describe("tsClient", () => {
  it("drops a failed worker so the next request retries", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.resetModules();
    const { tsClient } = await import("../lsp/tsClient");
    const first = tsClient.check([{ id: "block-0", code: "x", tsx: false }]);
    expect(FakeWorker.created).toHaveLength(1);
    const w1 = FakeWorker.created[0];
    w1.onerror!({ message: "Failed to fetch worker chunk" } as ErrorEvent);
    await expect(first).rejects.toThrow(/Failed to fetch/);
    expect(w1.terminate).toHaveBeenCalled();

    const second = tsClient.check([{ id: "block-0", code: "x", tsx: false }]);
    expect(FakeWorker.created).toHaveLength(2);
    const w2 = FakeWorker.created[1];
    const { id } = w2.posted[0] as { id: number };
    w2.onmessage!({ data: { id, ok: true, result: [] } } as MessageEvent);
    await expect(second).resolves.toEqual([]);
    tsClient.dispose();
  });
});
