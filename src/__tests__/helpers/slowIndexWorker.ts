/**
 * A fake index worker for the Z6 /regex/ time-limit tests (review Z6-H1, Z6-M4). It answers through the real
 * protocol and the real handleIndexRequest, in order, and posts `regexStart` when the real core says its regex
 * starts (as src/storage/vaultIndex.worker.ts does). How long a request "runs" follows the real parser: a query
 * whose parse holds a /regex/ runs `regexMs` (or never ends with `hang`), whatever the main thread thinks of it;
 * `slow` delays other ops (a queue in front of the query).
 */
import { parseQuery } from "../../search/queryOps";
import { VaultIndex } from "../../storage/vaultIndexCore";
import { handleIndexRequest } from "../../storage/vaultIndexLocal";
import type { IndexRequest, IndexResponse, WorkerLike } from "../../storage/vaultIndexProtocol";

export interface SlowOptions {
  regexMs?: number;
  hang?: boolean;
  slow?: Partial<Record<IndexRequest["op"], number>>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class SlowWorker implements WorkerLike {
  onmessage: ((e: MessageEvent<IndexResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  readonly index = new VaultIndex();
  terminated = false;
  /** Requests answered, by op. */
  readonly answered: string[] = [];
  private stuck = false;
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly o: SlowOptions = {}) {}
  terminate(): void {
    this.terminated = true;
  }
  private post(res: IndexResponse): void {
    if (!this.terminated) this.onmessage?.({ data: JSON.parse(JSON.stringify(res)) } as MessageEvent<IndexResponse>);
  }
  postMessage(message: IndexRequest): void {
    const req = JSON.parse(JSON.stringify(message)) as IndexRequest;
    if (this.terminated) return;
    this.queue = this.queue.then(async () => {
      if (this.stuck || this.terminated) return;
      const delay = this.o.slow?.[req.op];
      if (delay) await sleep(delay);
      const runsRegex = (req.op === "query" || req.op === "search") && parseQuery(req.query).ops.some((op) => op.kind === "regex") && !parseQuery(req.query).invalid.length;
      const res = await handleIndexRequest(this.index, req, undefined, { onRegexStart: () => this.post({ id: req.id, progress: "regexStart" }) });
      if (runsRegex && this.o.hang) {
        this.stuck = true;
        return;
      }
      if (runsRegex && this.o.regexMs) await sleep(this.o.regexMs);
      this.answered.push(req.op);
      this.post(res);
    });
  }
}
