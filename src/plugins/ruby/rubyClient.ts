/**
 * One Ruby worker shared by every live-ruby block on the page: the 30 MB
 * module compiles once per session, and each run still gets a fresh VM.
 * A timeout or Stop terminates it; the next Run starts a new worker.
 */
let worker: Worker | null = null;
let seq = 0;

export function rubyWorker(): Worker {
  worker ??= new Worker(new URL("./ruby.worker.ts", import.meta.url), { type: "module" });
  return worker;
}

/** Event dispatched on a worker right before it is terminated. */
export const RUBY_KILLED_EVENT = "lumen-ruby-killed";

/**
 * Terminate the shared worker (only if it is still `target`, when given).
 * Blocks with a run in flight on it hear RUBY_KILLED_EVENT first.
 */
export function killRubyWorker(target?: Worker): void {
  if (!worker || (target && target !== worker)) return;
  const w = worker;
  worker = null;
  w.dispatchEvent(new Event(RUBY_KILLED_EVENT));
  w.terminate();
}

export function nextRubyRunId(): number {
  return ++seq;
}

// Runs take turns on the shared worker: a run posts its code, and arms its
// timers, only once every earlier run has finished. So a queued block's
// Stop or load timeout never terminates another block's run.
let tail: Promise<void> = Promise.resolve();

/** Wait for your turn; call `release` (idempotent) when the run is over. */
export function rubyTurn(): { ready: Promise<void>; release: () => void } {
  let done!: () => void;
  const mine = new Promise<void>((r) => (done = r));
  const ready = tail;
  tail = tail.then(() => mine);
  let released = false;
  return {
    ready,
    release: () => {
      if (!released) {
        released = true;
        done();
      }
    },
  };
}
