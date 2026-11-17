/**
 * Runs the clusters-and-gaps analysis (W13.G8) in a worker when the browser
 * has one (review-13 L4: about 1 s for 10,000 notes on the main thread),
 * else on this thread (tests, a CSP that blocks workers), with the same
 * result. A newer call does not cancel an older one; the panel ignores a
 * result it no longer waits for.
 */
import { analyzeClusters, type AnalyzeOptions, type ClusterAnalysis, type GapInput } from "./clusterGaps";

/** What crosses to the worker: plain data only (no `vectors` callback). */
export type WorkerAnalyzeOptions = Omit<AnalyzeOptions, "vectors">;

export interface ClusterRequest {
  id: number;
  input: GapInput;
  opts: WorkerAnalyzeOptions;
}
export type ClusterResponse = { id: number; analysis: ClusterAnalysis; error?: undefined } | { id: number; error: string; analysis?: undefined };

let worker: Worker | null = null;
let nextId = 1;

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === "undefined") return null;
  try {
    worker = new Worker(new URL("./clusterGaps.worker.ts", import.meta.url), { type: "module" });
    return worker;
  } catch {
    return null;
  }
}

let lastRunWhere: "worker" | "thread" | null = null;
/** Where the last analysis ran ("worker" or "thread"): for tests and the perf receipt. */
export function lastClusterRunWhere(): "worker" | "thread" | null {
  return lastRunWhere;
}

export function analyzeClustersOffThread(input: GapInput, opts: WorkerAnalyzeOptions = {}, run: { inThread?: boolean } = {}): Promise<ClusterAnalysis> {
  const w = run.inThread ? null : getWorker();
  const here = () => {
    lastRunWhere = "thread";
    return analyzeClusters(input, opts);
  };
  if (!w) return new Promise((resolve, reject) => setTimeout(() => {
    try {
      resolve(here());
    } catch (e) {
      reject(e);
    }
  }, 0));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const done = () => {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
    };
    const onMessage = (e: MessageEvent<ClusterResponse>) => {
      if (e.data.id !== id) return;
      done();
      if (e.data.error !== undefined) return reject(new Error(e.data.error));
      lastRunWhere = "worker";
      resolve(e.data.analysis);
    };
    const onError = (e: ErrorEvent) => {
      done();
      worker?.terminate();
      worker = null;
      // The worker failed to start (e.g. blocked by the page's CSP): analyse here instead.
      try {
        resolve(here());
      } catch {
        reject(e.error ?? new Error(e.message));
      }
    };
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    w.postMessage({ id, input: { nodes: input.nodes.map((n) => ({ id: n.id, label: n.label, text: n.text })), edges: input.edges.map((e) => ({ source: e.source, target: e.target })) }, opts } satisfies ClusterRequest);
  });
}
