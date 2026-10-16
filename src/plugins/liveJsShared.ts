/**
 * Per-document shared LiveJS workers (```live-js shared```).
 *
 * All `shared` blocks of one document talk to the same worker, so the
 * worker's global scope (and every top-level binding the blocks declare —
 * see ./liveJsScope) survives across runs and across blocks. Runs are queued
 * so blocks execute one at a time, in the order they were started.
 *
 * Isolation and timeouts are unchanged from regular live-js: the worker is a
 * dedicated, DOM-less blob: worker with no network-import support, and a run
 * that exceeds its timeout kills the worker — which also resets the scope.
 */

export type LogLevel = "log" | "info" | "warn" | "error";

export interface WorkerMessage {
  type: "log" | "done";
  runId: number;
  level?: LogLevel;
  parts?: string[];
  /** Set on the `done` sent when the worker timed itself out (and closed). */
  timedOut?: boolean;
}

export interface WorkerRunPayload {
  type: "run";
  runId: number;
  source: string;
  timeoutMs: number;
}

/** The subset of `Worker` the registry uses (lets tests inject a fake). */
export interface WorkerLike {
  postMessage(msg: WorkerRunPayload): void;
  addEventListener(type: "message", fn: (e: MessageEvent) => void): void;
  addEventListener(type: "error", fn: (e: ErrorEvent) => void): void;
  terminate(): void;
}

export interface RunHandlers {
  onLog: (level: LogLevel, parts: string[]) => void;
  /** `reason` is "done", "timeout" (worker killed, scope lost) or "reset". */
  onEnd: (reason: "done" | "timeout" | "reset") => void;
}

export interface RunHandle {
  /** Stop listening (the run itself keeps going inside the shared worker). */
  detach: () => void;
}

interface QueuedRun {
  runId: number;
  source: string;
  timeoutMs: number;
  handlers: RunHandlers | null;
}

/** Grace period after the worker's own timeout before the host kills it. */
const HOST_TIMEOUT_GRACE_MS = 200;

class SharedScope {
  private worker: WorkerLike | null = null;
  private queue: QueuedRun[] = [];
  private current: QueuedRun | null = null;
  private hostTimer: ReturnType<typeof setTimeout> | null = null;
  refs = 0;
  disposeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly makeWorker: () => WorkerLike | null,
    private readonly nextRunId: () => number,
  ) {}

  run(source: string, timeoutMs: number, handlers: RunHandlers): RunHandle | null {
    if (!this.ensureWorker()) return null;
    const item: QueuedRun = { runId: this.nextRunId(), source, timeoutMs, handlers };
    this.queue.push(item);
    this.pump();
    return {
      detach: () => {
        item.handlers = null;
        // Not started yet → drop it from the queue entirely.
        const idx = this.queue.indexOf(item);
        if (idx !== -1) this.queue.splice(idx, 1);
      },
    };
  }

  /** Drop the worker (and with it every global); pending runs end as "reset". */
  reset(reason: "reset" | "timeout" = "reset") {
    if (this.hostTimer) clearTimeout(this.hostTimer);
    this.hostTimer = null;
    const pending = [...(this.current ? [this.current] : []), ...this.queue];
    this.current = null;
    this.queue = [];
    this.worker?.terminate();
    this.worker = null;
    for (const r of pending) r.handlers?.onEnd(reason);
  }

  get alive(): boolean {
    return this.worker !== null;
  }

  private ensureWorker(): boolean {
    if (this.worker) return true;
    const w = this.makeWorker();
    if (!w) return false;
    w.addEventListener("message", (e: MessageEvent) => this.onMessage(w, e.data as WorkerMessage));
    w.addEventListener("error", (e: ErrorEvent) => {
      // Keep worker errors from surfacing as page errors.
      e.preventDefault?.();
      if (w !== this.worker) return;
      this.current?.handlers?.onLog("error", [e.message ?? "Worker error"]);
    });
    this.worker = w;
    return true;
  }

  private onMessage(w: WorkerLike, msg: WorkerMessage) {
    if (w !== this.worker || !msg || !this.current || msg.runId !== this.current.runId) return;
    const run = this.current;
    if (msg.type === "log") {
      if (msg.level && msg.parts) run.handlers?.onLog(msg.level, msg.parts);
      return;
    }
    if (msg.type === "done") {
      if (this.hostTimer) clearTimeout(this.hostTimer);
      this.hostTimer = null;
      this.current = null;
      if (msg.timedOut) {
        // The worker closed itself — its scope is gone.
        run.handlers?.onEnd("timeout");
        this.reset("reset");
        return;
      }
      run.handlers?.onEnd("done");
      this.pump();
    }
  }

  private pump() {
    if (this.current || !this.worker) return;
    const next = this.queue.shift();
    if (!next) return;
    this.current = next;
    this.worker.postMessage({
      type: "run",
      runId: next.runId,
      source: next.source,
      timeoutMs: next.timeoutMs,
    });
    this.hostTimer = setTimeout(() => {
      // The worker didn't even report its own timeout — kill it.
      const run = this.current;
      this.current = null;
      run?.handlers?.onEnd("timeout");
      this.reset("reset");
    }, next.timeoutMs + HOST_TIMEOUT_GRACE_MS);
  }
}

/** How long an unused scope is kept alive (survives re-mounts on edit). */
export const SHARED_SCOPE_IDLE_MS = 5 * 60_000;

export class SharedScopeRegistry {
  private scopes = new Map<string, SharedScope>();
  private runCounter = 0;

  constructor(private readonly makeWorker: () => WorkerLike | null) {}

  private get(key: string): SharedScope {
    let s = this.scopes.get(key);
    if (!s) {
      s = new SharedScope(this.makeWorker, () => ++this.runCounter);
      this.scopes.set(key, s);
    }
    return s;
  }

  /** Register interest in a scope; returns a release function. */
  acquire(key: string): () => void {
    const s = this.get(key);
    s.refs++;
    if (s.disposeTimer) clearTimeout(s.disposeTimer);
    s.disposeTimer = null;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      s.refs--;
      if (s.refs > 0) return;
      s.disposeTimer = setTimeout(() => {
        if (s.refs > 0) return;
        s.reset();
        this.scopes.delete(key);
      }, SHARED_SCOPE_IDLE_MS);
    };
  }

  run(key: string, source: string, timeoutMs: number, handlers: RunHandlers): RunHandle | null {
    return this.get(key).run(source, timeoutMs, handlers);
  }

  /** Throw the scope's globals away (the next run starts a fresh worker). */
  reset(key: string) {
    this.scopes.get(key)?.reset();
  }

  /** Test helper: whether the scope currently has a live worker. */
  isAlive(key: string): boolean {
    return this.scopes.get(key)?.alive ?? false;
  }
}

/**
 * Parse a live-js fence's meta for the shared-scope flag.
 * `shared` → the document's default scope; `shared=name` → a named scope.
 */
export function sharedScopeName(meta: string | undefined): string | null {
  const m = /(?:^|\s)shared(?:=([\w-]+))?(?=\s|$)/.exec(meta ?? "");
  if (!m) return null;
  return m[1] ?? "default";
}
