/**
 * The index build's progress for the status bar (plan W13.V6): "Indexing
 * 3,200 / 10,000", shown while a large vault is read and gone when it is
 * done. The workspace opens at once; the index fills in behind it.
 *
 * The reader (workspaceIndexRead.mapLimit) reports a batch of reads; a
 * second batch while one runs adds to the total. Listeners hear at most one
 * update per percent, so a 100k vault does not re-render the bar 100k times.
 */
export interface IndexProgress {
  done: number;
  total: number;
}

/** Batches smaller than this finish too fast to be worth a status. */
export const PROGRESS_MIN = 200;

let state: IndexProgress | null = null;
let lastNotified = -1;
const listeners = new Set<() => void>();

const notify = () => {
  for (const l of listeners) l();
};

export function indexProgress(): IndexProgress | null {
  return state;
}

export function subscribeIndexProgress(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

let active = 0;

export interface ProgressBatch {
  tick(): void;
  end(): void;
}

/** A batch of `total` reads starts; tick each, end once (whatever was not ticked counts as done). */
export function startIndexProgress(total: number): ProgressBatch {
  active++;
  state = state ? { done: state.done, total: state.total + total } : { done: 0, total };
  lastNotified = -1;
  notify();
  let ticked = 0;
  let ended = false;
  const advance = (n: number) => {
    if (!state) return;
    state = { done: Math.min(state.total, state.done + n), total: state.total };
    const pct = Math.floor((state.done * 100) / Math.max(1, state.total));
    if (pct !== lastNotified) {
      lastNotified = pct;
      notify();
    }
  };
  return {
    tick() {
      if (ended || ticked >= total) return;
      ticked++;
      advance(1);
    },
    end() {
      if (ended) return;
      ended = true;
      advance(total - ticked);
      active--;
      if (active === 0) {
        state = null;
        notify();
      }
    },
  };
}
