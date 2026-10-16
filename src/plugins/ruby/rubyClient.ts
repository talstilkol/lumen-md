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
