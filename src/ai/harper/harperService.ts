/**
 * W13.W10 — the client side of the Harper worker: one worker, started on
 * the first English check, requests by id, an AbortSignal per request.
 * `harperLints` resolves to null when harper.js is not installed in this
 * build (the editor keeps its other English checks).
 */
import type { GrammarMatch } from "../grammar";
import { detectLanguage } from "../../text/langId";
import { englishSpans, toGrammarMatches, toSuggestions, type LintData } from "../../agents/writing/harper/harperEngine";
import type { WorkerReply, WorkerRequest } from "../../agents/writing/harper/harperWorkerCore";

/** The language id this host gives the engine (the engine itself loads no package: W1's static check). */
const englishGuess = (run: string) => detectLanguage(run, { prefer: ["en"] });
import type { WritingSuggestion } from "../../agents/writing/suggestionShape";

type Post = (req: WorkerRequest) => void;

let worker: Worker | null = null;
let missing = false;
let seq = 0;
const pending = new Map<number, (r: WorkerReply) => void>();

let transport: Post | null = null;
/** Test hook: route requests to `send` instead of a worker (null: back to the worker). */
export function __setHarperTransport(send: Post | null): void {
  transport = send;
  missing = false;
}

function post(): Post | null {
  if (transport) return transport;
  if (missing || typeof Worker === "undefined") return null;
  if (!worker) {
    try {
      worker = new Worker(new URL("./harper.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (e: MessageEvent<WorkerReply>) => {
        pending.get(e.data.id)?.(e.data);
        pending.delete(e.data.id);
      };
      // The worker could not start (its module or harper.js is not in this build): the same as not installed.
      worker.onerror = () => {
        missing = true;
        for (const [id, done] of pending) done({ type: "not-installed", id });
        pending.clear();
        worker?.terminate();
        worker = null;
      };
    } catch {
      missing = true;
      return null;
    }
  }
  return (req) => worker!.postMessage(req);
}

/** Lints of one English text, or null when Harper is not installed. Rejects with AbortError on abort. */
export function harperLints(text: string, opts: { signal?: AbortSignal; send?: Post } = {}): Promise<{ lints: LintData[]; version: string } | null> {
  const send = opts.send ?? post();
  if (!send) return Promise.resolve(null);
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      pending.delete(id);
      reject(opts.signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    if (opts.signal?.aborted) return onAbort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    pending.set(id, (r) => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (r.type === "lints") resolve({ lints: r.lints, version: r.version });
      else if (r.type === "not-installed") {
        missing = true;
        resolve(null);
      } else reject(new Error(`Harper: ${r.error}`));
    });
    send({ type: "lint", id, text });
  });
}

/** Test hook: deliver a worker reply. */
export const __deliver = (r: WorkerReply): void => {
  pending.get(r.id)?.(r);
  pending.delete(r.id);
};

/** Harper's suggestions for the English runs of `text` (empty when Harper is not installed). */
export async function harperSuggestions(text: string, opts: { signal?: AbortSignal; send?: Post } = {}): Promise<WritingSuggestion[]> {
  const out: WritingSuggestion[] = [];
  for (const span of englishSpans(text, 3, englishGuess)) {
    const part = text.slice(span.from, span.to);
    const r = await harperLints(part, opts);
    if (!r) return [];
    out.push(...toSuggestions(part, span.from, r.lints, r.version));
  }
  return out;
}

/** For the grammar engine (ai/grammar.ts): Harper's findings as GrammarMatch, [] when not installed or on failure. */
export async function harperGrammarMatches(text: string, signal?: AbortSignal): Promise<GrammarMatch[]> {
  try {
    return toGrammarMatches(await harperSuggestions(text, { signal }));
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    return [];
  }
}
